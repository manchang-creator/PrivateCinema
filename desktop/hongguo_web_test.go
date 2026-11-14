package main

// 纯逻辑 + 本地 httptest 单测：不访问真实 hongguoduanju.com，也不碰 SDK。
// 覆盖：字段映射、series_id 校验、标题兜底、去重、分页元信息、失败路径（必须返回错误以便回退）。

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

const hgWebFixture = `{
  "pageNum": 1,
  "totalCount": 214,
  "totalPages": 22,
  "hasMore": true,
  "searchList": [
    {
      "name": "持械入宋：第一季",
      "video_data": {
        "series_id": "7671966197985856536",
        "series_title": "持械入宋：第一季",
        "series_cover": "https://p6-novel.byteimg.com/novel-pic/3edbd9c6~tplv-shrink:640:0.image",
        "episode_cnt": 100,
        "episode_right_text": "全100集",
        "create_time": "1786268827",
        "category_list": [{"category_id":"755","name":"脑洞"},{"category_id":"37","name":"穿越"}]
      }
    },
    {
      "name": "无封面条目",
      "video_data": {
        "series_id": "7497644625327637054",
        "series_title": "无封面条目",
        "series_cover": "",
        "cover": "https://p3-novel.byteimg.com/novel-pic/fallback.image",
        "episode_right_text": ""
      }
    },
    {
      "name": "重复条目",
      "video_data": {
        "series_id": "7671966197985856536",
        "series_title": "持械入宋：第一季",
        "series_cover": "https://p6-novel.byteimg.com/novel-pic/dup.image"
      }
    },
    {
      "name": "广告位",
      "video_data": {}
    },
    {
      "name": "非数字 id",
      "video_data": {"series_id": "abc123456", "series_title": "脏数据"}
    },
    {
      "name": "标题只在 item 上",
      "video_data": {"series_id": "7611111111111111111", "episode_cnt": 12}
    }
  ]
}`

func TestHGWebCardsMapping(t *testing.T) {
	var resp hgWebSearchResp
	if err := mustUnmarshal(t, hgWebFixture, &resp); err != nil {
		t.Fatalf("夹具解析失败：%v", err)
	}
	cards := hgWebCards(resp.SearchList)

	if len(cards) != 3 {
		t.Fatalf("期望 3 张卡（去重 + 过滤脏数据），实际 %d：%+v", len(cards), cards)
	}

	first := cards[0]
	if first.ID != "7671966197985856536" {
		t.Fatalf("ID = %q", first.ID)
	}
	if first.Title != "持械入宋：第一季" {
		t.Fatalf("Title = %q", first.Title)
	}
	if first.PosterURL != "https://p6-novel.byteimg.com/novel-pic/3edbd9c6~tplv-shrink:640:0.image" {
		t.Fatalf("PosterURL = %q", first.PosterURL)
	}
	if first.Remarks != "全100集" {
		t.Fatalf("Remarks = %q", first.Remarks)
	}
	if first.Kind != KindSeries {
		t.Fatalf("Kind = %q", first.Kind)
	}
	if first.Year != 2026 {
		t.Fatalf("Year = %d（create_time=1786268827 应为 2026）", first.Year)
	}
	if got := strings.Join(first.Genres, "/"); got != "脑洞/穿越" {
		t.Fatalf("Genres = %q", got)
	}

	// series_cover 为空时回退 cover
	if cards[1].PosterURL != "https://p3-novel.byteimg.com/novel-pic/fallback.image" {
		t.Fatalf("cover 回退失效：%q", cards[1].PosterURL)
	}
	if cards[1].Remarks != "" {
		t.Fatalf("Remarks 应为空，实际 %q", cards[1].Remarks)
	}

	// series_title 为空时回退 item.name
	if cards[2].Title != "标题只在 item 上" {
		t.Fatalf("标题兜底失效：%q", cards[2].Title)
	}
	if cards[2].Remarks != "共 12 集" {
		t.Fatalf("episode_cnt 兜底失败：%q", cards[2].Remarks)
	}
}

func TestHGWebKindAnime(t *testing.T) {
	var resp hgWebSearchResp
	fixture := `{"searchList":[{"video_data":{"series_id":"7600000000000000001","series_title":"漫剧集","category_list":[{"name":"漫剧"}]}}]}`
	if err := mustUnmarshal(t, fixture, &resp); err != nil {
		t.Fatalf("夹具解析失败：%v", err)
	}
	cards := hgWebCards(resp.SearchList)
	if len(cards) != 1 || cards[0].Kind != KindAnime {
		t.Fatalf("漫剧应映射为 KindAnime，实际 %+v", cards)
	}
}

func TestHGWebYearBadInput(t *testing.T) {
	for _, in := range []string{"", "0", "-5", "abc"} {
		if got := hgWebYear(in); got != 0 {
			t.Fatalf("hgWebYear(%q) = %d, want 0", in, got)
		}
	}
}

// 空 video_data 全被过滤后必须返回错误，让 remoteSearch 回退 SDK。
func TestHongguoWebSearchEmptyIsError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"searchList":[{"video_data":{}}]}`))
	}))
	defer srv.Close()

	page, err := hongguoWebSearchURL(srv.URL, "推荐", 1)
	if err == nil {
		t.Fatalf("空结果应返回错误，实际 page=%+v", page)
	}
}

func TestHongguoWebSearchHTTPError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "blocked", http.StatusForbidden)
	}))
	defer srv.Close()

	if _, err := hongguoWebSearchURL(srv.URL, "推荐", 1); err == nil {
		t.Fatal("403 应返回错误")
	}
}

func TestHongguoWebSearchPaging(t *testing.T) {
	var gotQuery string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotQuery = r.URL.RawQuery
		if r.Header.Get("Referer") == "" || r.Header.Get("User-Agent") == "" {
			t.Errorf("缺少 Referer/User-Agent 头")
		}
		_, _ = w.Write([]byte(hgWebFixture))
	}))
	defer srv.Close()

	page, err := hongguoWebSearchURL(srv.URL, "  推荐  ", 3)
	if err != nil {
		t.Fatalf("请求失败：%v", err)
	}
	if page.Page != 3 {
		t.Fatalf("Page = %d", page.Page)
	}
	// totalPages=22 且 page=3 → 还有更多
	if !page.HasMore {
		t.Fatal("HasMore 应为 true")
	}
	for _, want := range []string{"aid=8662", "page=3", "query=%E6%8E%A8%E8%8D%90"} {
		if !strings.Contains(gotQuery, want) {
			t.Fatalf("query 缺少 %q：%s", want, gotQuery)
		}
	}
}

func mustUnmarshal(t *testing.T, raw string, out any) error {
	t.Helper()
	return json.Unmarshal([]byte(raw), out)
}

// 真实网络验收（默认跳过，LIVE=1 打开）：跑 4 个关键词，统计封面命中率。
// 这是换源的量化指标来源：目标 ≥95%。
func TestLiveHongguoWebCoverRate(t *testing.T) {
	if os.Getenv("LIVE") != "1" {
		t.Skip("set LIVE=1 to run live network smoke tests")
	}
	keywords := []string{"推荐", "爱情", "总裁", "重生"}
	total, covered := 0, 0
	for _, kw := range keywords {
		page, err := hongguoWebSearch(kw, 1)
		if err != nil {
			t.Fatalf("%s 搜索失败：%v", kw, err)
		}
		hit := 0
		for _, card := range page.Cards {
			if strings.TrimSpace(card.PosterURL) != "" {
				hit++
			}
		}
		t.Logf("%s：%d 条，%d 条有封面", kw, len(page.Cards), hit)
		total += len(page.Cards)
		covered += hit
	}
	if total == 0 {
		t.Fatal("没有取到任何结果")
	}
	rate := float64(covered) / float64(total) * 100
	t.Logf("合计 %d 条，封面命中率 %.1f%%", total, rate)
	if rate < 95 {
		t.Fatalf("封面命中率 %.1f%% 低于 95%%", rate)
	}
}

// 上游 totalCount 是字符串（实测 "176"），pageNum/totalPages 是数字：两者都要能解析。
func TestHGWebPagingTolerantTypes(t *testing.T) {
	var resp hgWebSearchResp
	raw := `{"pageNum":2,"totalCount":"176","totalPages":18,"hasMore":true,
	  "searchList":[{"video_data":{"series_id":"7600000000000000002","series_title":"某剧","series_cover":"https://p3-novel.byteimg.com/a.image"}}]}`
	if err := mustUnmarshal(t, raw, &resp); err != nil {
		t.Fatalf("解析失败：%v", err)
	}
	if int(resp.TotalCount) != 176 {
		t.Fatalf("totalCount 字符串解析失败：%d", resp.TotalCount)
	}
	if hgNumber(resp.TotalPages) != 18 || hgNumber(resp.PageNum) != 2 {
		t.Fatalf("分页字段解析失败：pages=%v page=%v", resp.TotalPages, resp.PageNum)
	}

	// 乱值不应导致整体解析失败
	var junk hgWebSearchResp
	if err := mustUnmarshal(t, `{"totalCount":"abc"}`, &junk); err != nil {
		t.Fatalf("脏 totalCount 不应导致解析失败：%v", err)
	}
	if int(junk.TotalCount) != 0 {
		t.Fatalf("脏 totalCount 应归零，实际 %d", junk.TotalCount)
	}
}

// 回退契约：网页源不可用时 remoteSearch 必须落到 SDK 路径而不是直接把错误抛给前端。
// 这里只验证「网页源报错 → 进入回退分支」这一判断本身，不真的打 SDK（离线）。
func TestHongguoWebErrorTriggersFallbackBranch(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "upstream changed", http.StatusNotFound)
	}))
	defer srv.Close()

	res, err := hongguoWebSearchURL(srv.URL, "推荐", 1)
	if err == nil {
		t.Fatal("404 必须返回错误，否则 remoteSearch 不会回退")
	}
	if len(res.Cards) != 0 {
		t.Fatalf("出错时不应带卡片：%+v", res.Cards)
	}
}

package main

// ==================== 红果：网页站搜索源（hongguoduanju.com）====================
// 背景：官方 SDK（openhongguo）搜索返回的封面是带 x-expires 的签名 URL，且部分条目在
// 上游就是残缺记录（详情接口返回 content_gone），导致搜索结果里约 20% 的卡片没有封面。
// 网页站 hongguoduanju.com 的搜索接口返回的封面是 CDN 静态地址（byteimg.com，无签名、
// 长期有效），实测采样 40 条 0 条缺封面。
//
// 因此红果的「搜索」改为优先走本文件，失败（网络错误 / 非 2xx / 改版解析不出卡片）时
// 由 remote.go 静默回退到 SDK，不做单点故障。
//
// 说明：接口地址与字段名来自对公开网页接口的实测，本文件为独立 Go 实现。

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// ==================== 常量 ====================

const (
	hgWebBase    = "https://hongguoduanju.com"
	hgWebSearch  = hgWebBase + "/api/search/result"
	hgWebSiteAID = "8662"
	// hgWebPageSize 是上游每页固定返回条数（实测 10），仅用于 HasMore 估算兜底。
	hgWebPageSize = 10
)

// hgWebHTTPClient 网页源专用客户端。红果网页接口响应快，10s 足够；超时即回退 SDK。
var hgWebHTTPClient = &http.Client{Timeout: 10 * time.Second}

// hgWebUserAgent 用桌面 Chrome UA：网页接口对非浏览器 UA 更容易返回空/风控页。
const hgWebUserAgent = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"

// hgWebSeriesIDRe series_id 必须是纯数字且有一定长度，避免把广告位/推荐位混进结果。
var hgWebSeriesIDRe = regexp.MustCompile(`^\d{6,}$`)

// ==================== 原始报文 ====================

// hgWebVideoData 对应 searchList[].video_data。
// 有的条目 video_data 为空对象（广告/推荐位），此时忽略该条目。
type hgWebVideoData struct {
	SeriesID         string `json:"series_id"`
	SeriesTitle      string `json:"series_title"`
	SeriesIntro      string `json:"series_intro"`
	SeriesCover      string `json:"series_cover"`
	Cover            string `json:"cover"`
	EpisodeCnt       int    `json:"episode_cnt"`
	EpisodeRightText string `json:"episode_right_text"`
	CreateTime       string `json:"create_time"`
	CategoryList     []struct {
		Name string `json:"name"`
	} `json:"category_list"`
	Tags []struct {
		Name string `json:"name"`
	} `json:"tags"`
}

type hgWebSearchItem struct {
	Name string         `json:"name"`
	Data hgWebVideoData `json:"video_data"`
}

type hgWebSearchResp struct {
	SearchList []hgWebSearchItem `json:"searchList"`
	// 注意：实测 totalCount 是字符串（"176"），pageNum / totalPages 是数字，
	// hasMore 是布尔。用 json.Number + 容错解析，避免上游哪天改类型就整体解析失败。
	PageNum    json.Number `json:"pageNum"`
	TotalCount hgFlexInt   `json:"totalCount"`
	TotalPages json.Number `json:"totalPages"`
	HasMore    bool        `json:"hasMore"`
}

// hgFlexInt 容错整数：接受 JSON 数字或数字字符串，其它一律视为 0。
type hgFlexInt int

func (v *hgFlexInt) UnmarshalJSON(raw []byte) error {
	text := strings.Trim(strings.TrimSpace(string(raw)), `"`)
	if text == "" || text == "null" {
		*v = 0
		return nil
	}
	n, err := strconv.ParseFloat(text, 64)
	if err != nil {
		*v = 0
		return nil
	}
	*v = hgFlexInt(n)
	return nil
}

// hgNumber 把 json.Number 转 int，失败返回 0。
func hgNumber(n json.Number) int {
	if n == "" {
		return 0
	}
	v, err := strconv.Atoi(n.String())
	if err != nil {
		return 0
	}
	return v
}

// ==================== 请求 ====================

// hgWebEndpoint 返回搜索结果接口地址；测试里替换 base 指向 httptest。
var hgWebEndpoint = hgWebSearch

// hongguoWebSearch 走网页站搜索：返回同构的 RemoteBrowsePage。
func hongguoWebSearch(keyword string, page int) (RemoteBrowsePage, error) {
	return hongguoWebSearchURL(hgWebEndpoint, keyword, page)
}

// hongguoWebSearchURL 是 hongguoWebSearch 的实现，endpoint 可注入（测试用）。
func hongguoWebSearchURL(endpointBase, keyword string, page int) (RemoteBrowsePage, error) {
	q := strings.TrimSpace(keyword)
	if q == "" {
		return RemoteBrowsePage{Cards: make([]RemoteCard, 0), Page: 1, HasMore: false}, nil
	}
	if page < 1 {
		page = 1
	}

	// 与 SDK 路径共用同一个进程内最小间隔限流，避免两条链路叠加速度。
	ctx, cancel := context.WithTimeout(context.Background(), hgWebHTTPClient.Timeout)
	defer cancel()
	throttleHongguo(ctx)

	query := url.Values{}
	query.Set("aid", hgWebSiteAID)
	query.Set("query", q)
	query.Set("page", strconv.Itoa(page))
	endpoint := endpointBase + "?" + query.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return RemoteBrowsePage{}, fmt.Errorf("红果网页搜索构造请求失败：%v", err)
	}
	req.Header.Set("User-Agent", hgWebUserAgent)
	req.Header.Set("Accept", "application/json, text/plain, */*")
	req.Header.Set("Accept-Language", "zh-CN,zh;q=0.9")
	req.Header.Set("Referer", hgWebBase+"/")

	resp, err := hgWebHTTPClient.Do(req)
	if err != nil {
		return RemoteBrowsePage{}, fmt.Errorf("红果网页搜索请求失败：%v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return RemoteBrowsePage{}, fmt.Errorf("红果网页搜索失败：HTTP %d", resp.StatusCode)
	}

	// 上游会返回 MB 级 JSON（含剧集点赞/收藏等字段）；8MB 上限足够，且防异常大包。
	body, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return RemoteBrowsePage{}, fmt.Errorf("红果网页搜索读取响应失败：%v", err)
	}
	var raw hgWebSearchResp
	if err := json.Unmarshal(body, &raw); err != nil {
		return RemoteBrowsePage{}, fmt.Errorf("红果网页搜索响应解析失败：%v", err)
	}

	cards := hgWebCards(raw.SearchList)
	if len(cards) == 0 {
		// 宁可返回错误让上层回退 SDK，也不要把「解析不出东西」当成「真的没有结果」。
		return RemoteBrowsePage{}, errors.New("红果网页搜索未解析到结果")
	}

	// 分页元信息优先用上游字段；缺失时按「本页满页」估算。
	totalPages := hgNumber(raw.TotalPages)
	totalCount := int(raw.TotalCount)
	hasMore := raw.HasMore
	if totalPages > 0 {
		hasMore = page < totalPages
	} else if totalCount > 0 {
		hasMore = page*hgWebPageSize < totalCount
	}

	return RemoteBrowsePage{Cards: cards, Page: page, HasMore: hasMore}, nil
}

// ==================== 归一化 ====================

// hgWebCards 把网页搜索结果映射成前端卡片：校验 id、去空标题、按 id 去重。
func hgWebCards(items []hgWebSearchItem) []RemoteCard {
	cards := make([]RemoteCard, 0, len(items))
	seen := make(map[string]struct{}, len(items))
	for _, item := range items {
		data := item.Data
		id := strings.TrimSpace(data.SeriesID)
		if id == "" || !hgWebSeriesIDRe.MatchString(id) {
			continue
		}
		title := strings.TrimSpace(data.SeriesTitle)
		if title == "" {
			title = strings.TrimSpace(item.Name)
		}
		if title == "" {
			continue
		}
		if _, dup := seen[id]; dup {
			continue
		}
		seen[id] = struct{}{}

		cards = append(cards, RemoteCard{
			ID:        id,
			Title:     title,
			Kind:      hgWebKind(data),
			Year:      hgWebYear(data.CreateTime),
			Area:      "",
			Genres:    hgWebGenres(data),
			Remarks:   hgWebRemarks(data),
			PosterURL: hgWebCover(data),
		})
	}
	return cards
}

// hgWebCover 封面取 series_cover，缺失时退回 cover，再不行留空（前端走兜底 UI）。
func hgWebCover(data hgWebVideoData) string {
	if u := strings.TrimSpace(data.SeriesCover); u != "" {
		return u
	}
	return strings.TrimSpace(data.Cover)
}

// hgWebRemarks 「全100集」/「更新至43集」优先用上游文案；缺失时用 episode_cnt 拼。
func hgWebRemarks(data hgWebVideoData) string {
	if text := strings.TrimSpace(data.EpisodeRightText); text != "" {
		return text
	}
	if data.EpisodeCnt > 0 {
		return fmt.Sprintf("共 %d 集", data.EpisodeCnt)
	}
	return ""
}

// hgWebGenres 分类标签取 category_list（网页接口比 SDK 的单一 category 更细），
// 缺失时退 tags，最多 4 个。
func hgWebGenres(data hgWebVideoData) []string {
	names := make([]string, 0, len(data.CategoryList)+len(data.Tags))
	for _, c := range data.CategoryList {
		names = append(names, c.Name)
	}
	if len(names) == 0 {
		for _, t := range data.Tags {
			names = append(names, t.Name)
		}
	}
	return dedupeLimit(names, 4)
}

// hgWebKind 网页接口没有 contentType 字段，红果站内容以真人短剧为主，统一按剧集处理
// （SDK 路径同理：除电影/漫剧外一律 Series）。
func hgWebKind(data hgWebVideoData) MediaKind {
	for _, c := range data.CategoryList {
		if strings.Contains(c.Name, "漫剧") {
			return KindAnime
		}
	}
	return KindSeries
}

// hgWebYear create_time 是 unix 秒字符串；解析不出来就返回 0（前端不显示年份）。
func hgWebYear(createTime string) int {
	ts, err := strconv.ParseInt(strings.TrimSpace(createTime), 10, 64)
	if err != nil || ts <= 0 {
		return 0
	}
	return time.Unix(ts, 0).Year()
}

// logHongguoWebFallback 记录一次网页源失败后回退 SDK 的原因（便于事后定位改版）。
func logHongguoWebFallback(keyword string, err error) {
	log.Printf("[hongguo] 网页搜索失败，回退 SDK：keyword=%q err=%v", keyword, err)
}

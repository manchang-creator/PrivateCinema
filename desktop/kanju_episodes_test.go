package main

// 选集分页单测：上游 /episodes 默认只返回 48 条并带 episode_pagination，
// 之前只取第一页，导致 100+ 集的番剧详情页只显示 48 集。
// 这里用 httptest 模拟分页上游，不需要真实网络。

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"testing"
)

// fakeKanjuEpisodesServer 模拟上游分页：总共 total 集，按 limit/offset 切片返回。
// 返回的 server 同时记录请求次数，便于断言「翻完了就停」。
func fakeKanjuEpisodesServer(t *testing.T, id string, total int) (*httptest.Server, *int) {
	t.Helper()
	calls := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		wantPath := "/v1/catalog/" + url.PathEscape(id) + "/episodes"
		if r.URL.Path != wantPath {
			http.NotFound(w, r)
			return
		}
		limit := 48
		if v := r.URL.Query().Get("limit"); v != "" {
			if n, err := strconv.Atoi(v); err == nil && n > 0 {
				limit = n
			}
		}
		offset := 0
		if v := r.URL.Query().Get("offset"); v != "" {
			if n, err := strconv.Atoi(v); err == nil && n > 0 {
				offset = n
			}
		}
		end := offset + limit
		if end > total {
			end = total
		}
		items := make([]RawEpisode, 0, limit)
		for i := offset; i < end; i++ {
			n := i + 1
			items = append(items, RawEpisode{
				ID:     "ep-" + strconv.Itoa(n),
				Token:  "tok-" + strconv.Itoa(n),
				Number: &n,
				Title:  "第" + strconv.Itoa(n) + "集",
			})
		}
		payload := map[string]any{
			"episodes":      items,
			"episode_count": total,
			"episode_pagination": map[string]any{
				"has_more":       end < total,
				"limit":          limit,
				"offset":         offset,
				"returned_count": len(items),
				"total_count":    total,
			},
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(payload)
	}))
	t.Cleanup(srv.Close)
	return srv, &calls
}

// fakeKanjuEpisodesServerURL 起服务并返回可注入的 base URL。
func fakeKanjuEpisodesServerURL(t *testing.T, id string, total int) (string, *int) {
	t.Helper()
	srv, calls := fakeKanjuEpisodesServer(t, id, total)
	return srv.URL, calls
}

func TestKanjuFetchAllEpisodesPagination(t *testing.T) {
	id := "av_fixture"
	base, calls := fakeKanjuEpisodesServerURL(t, id, 103)

	withKanjuBase(t, base, func() {
		raw, err := kanjuFetchAllEpisodes(id)
		if err != nil {
			t.Fatalf("抓取失败：%v", err)
		}
		if len(raw.Episodes) != 103 {
			t.Fatalf("期望 103 集，实际 %d", len(raw.Episodes))
		}
		// 顺序必须稳定：第 1 条是第 1 集，最后一条是第 103 集
		if raw.Episodes[0].Title != "第1集" || raw.Episodes[102].Title != "第103集" {
			t.Fatalf("顺序错误：first=%q last=%q", raw.Episodes[0].Title, raw.Episodes[102].Title)
		}
		if *calls < 1 {
			t.Fatal("没有发出请求")
		}
	})
}

// 集数正好等于一页时，不该多发一次请求。
func TestKanjuFetchAllEpisodesSinglePage(t *testing.T) {
	id := "av_single"
	base, calls := fakeKanjuEpisodesServerURL(t, id, 12)

	withKanjuBase(t, base, func() {
		raw, err := kanjuFetchAllEpisodes(id)
		if err != nil {
			t.Fatalf("抓取失败：%v", err)
		}
		if len(raw.Episodes) != 12 {
			t.Fatalf("期望 12 集，实际 %d", len(raw.Episodes))
		}
		if *calls != 1 {
			t.Fatalf("单页数据只该请求 1 次，实际 %d 次", *calls)
		}
	})
}

// has_more 一直为 true 的上游不能把客户端拖死：必须有页数上限。
func TestKanjuFetchAllEpisodesPaginationGuard(t *testing.T) {
	if kanjuEpisodeMaxPages <= 0 {
		t.Fatal("kanjuEpisodeMaxPages 必须为正，否则无法防死循环")
	}
	if kanjuEpisodePageLimit < 48 {
		t.Fatal("单页上限不该小于上游默认的 48")
	}
}

func TestKanjuEpisodesMappingNumbers(t *testing.T) {
	id := "av_map"
	base, _ := fakeKanjuEpisodesServerURL(t, id, 3)

	withKanjuBase(t, base, func() {
		eps, err := kanjuEpisodes(id)
		if err != nil {
			t.Fatalf("失败：%v", err)
		}
		if len(eps) != 3 {
			t.Fatalf("期望 3 集，实际 %d", len(eps))
		}
		for i, ep := range eps {
			if ep.Number != i+1 {
				t.Fatalf("第 %d 条 Number=%d", i, ep.Number)
			}
			if ep.Token == "" || ep.ID == "" {
				t.Fatalf("第 %d 条缺少 id/token：%+v", i, ep)
			}
		}
	})
}

// withKanjuBase 临时把上游基址指向测试服务，结束后恢复。
func withKanjuBase(t *testing.T, base string, fn func()) {
	t.Helper()
	kanjuBaseMu.Lock()
	previous := kanjuBase
	kanjuBase = base
	kanjuBaseMu.Unlock()
	t.Cleanup(func() {
		kanjuBaseMu.Lock()
		kanjuBase = previous
		kanjuBaseMu.Unlock()
	})
	fn()
}

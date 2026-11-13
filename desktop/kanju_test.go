package main

import (
	"reflect"
	"testing"
)

// 编译期锁定对外导出函数的签名，防止被意外改动。
var (
	_ func() (RemoteHomeData, error)               = kanjuHome
	_ func(string, int) (RemoteBrowsePage, error)  = kanjuBrowse
	_ func(string, int) (RemoteBrowsePage, error)  = kanjuSearch
	_ func(string) (RemoteDetail, error)           = kanjuDetail
	_ func(string) ([]RemoteEpisode, error)        = kanjuEpisodes
	_ func(string, string) (RemotePlayback, error) = kanjuResolve
)

// TestKanjuBuildQuery 验证 query 拼接的插入顺序与转义（不触发任何网络）。
func TestKanjuBuildQuery(t *testing.T) {
	cases := []struct {
		name   string
		params []kanjuQueryParam
		want   string
	}{
		{
			name:   "nil",
			params: nil,
			want:   "",
		},
		{
			name:   "empty",
			params: []kanjuQueryParam{},
			want:   "",
		},
		{
			name: "home 顺序 scope,mode,sections,cards",
			params: []kanjuQueryParam{
				{key: "scope", value: "public"},
				{key: "mode", value: "preview"},
				{key: "sections", value: 6},
				{key: "cards", value: 12},
			},
			want: "?scope=public&mode=preview&sections=6&cards=12",
		},
		{
			name: "browse 顺序 page,limit,intent,kind",
			params: []kanjuQueryParam{
				{key: "page", value: 2},
				{key: "limit", value: 24},
				{key: "intent", value: "latest_catalog"},
				{key: "kind", value: "movie"},
			},
			want: "?page=2&limit=24&intent=latest_catalog&kind=movie",
		},
		{
			name: "特殊字符转义",
			params: []kanjuQueryParam{
				{key: "q", value: "a b&c=d/e?f"},
				{key: "page", value: 1},
			},
			want: "?q=a+b%26c%3Dd%2Fe%3Ff&page=1",
		},
		{
			name: "跳过空串与 nil",
			params: []kanjuQueryParam{
				{key: "a", value: ""},
				{key: "b", value: nil},
				{key: "c", value: "x"},
			},
			want: "?c=x",
		},
		{
			name:   "数字 0 保留",
			params: []kanjuQueryParam{{key: "page", value: 0}},
			want:   "?page=0",
		},
		{
			name:   "UTF-8 百分号转义",
			params: []kanjuQueryParam{{key: "q", value: "中文"}},
			want:   "?q=%E4%B8%AD%E6%96%87",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := kanjuBuildQuery(tc.params); got != tc.want {
				t.Fatalf("kanjuBuildQuery()=%q want %q", got, tc.want)
			}
		})
	}
}

// TestKanjuDeriveUrlKind 验证直链类型推断。
func TestKanjuDeriveUrlKind(t *testing.T) {
	cases := []struct {
		url      string
		declared string
		want     string
	}{
		{"http://x/a.m3u8", "", "hls"},
		{"http://x/a.m3u8?token=1", "", "hls"},
		{"http://x/a.m3u8#frag", "", "hls"},
		{"http://x/a.M3U8", "", "hls"}, // 大小写不敏感
		{"http://x/a.mp4", "", "mp4"},
		{"http://x/path.with.m3u8.ext/a", "", "mp4"}, // .m3u8 后必须紧跟结尾或 ? #
		{"", "hls", "hls"},                           // 声明优先
		{"", "m3u8", "hls"},
		{"http://x/a.m3u8", "mp4", "mp4"}, // 声明 mp4 覆盖后缀
		{"", "", "mp4"},                   // 默认 mp4
	}
	for _, tc := range cases {
		if got := kanjuDeriveUrlKind(tc.url, tc.declared); got != tc.want {
			t.Errorf("kanjuDeriveUrlKind(%q,%q)=%q want %q", tc.url, tc.declared, got, tc.want)
		}
	}
}

// TestKanjuMapKind 验证内容类型归一化。
func TestKanjuMapKind(t *testing.T) {
	cases := map[string]MediaKind{
		"movie":       KindMovie,
		"documentary": KindMovie,
		"anime":       KindAnime,
		"variety":     KindVariety,
		"sports":      KindVariety,
		"series":      KindSeries,
		"short_drama": KindSeries,
		"tv":          KindSeries,
		"":            KindSeries, // 缺省
		"unknown":     KindSeries, // 未知
	}
	for in, want := range cases {
		if got := kanjuMapKind(in); got != want {
			t.Errorf("kanjuMapKind(%q)=%q want %q", in, got, want)
		}
	}
}

// TestKanjuMapCard 验证卡片归一化与默认值填充。
func TestKanjuMapCard(t *testing.T) {
	got := kanjuMapCard(RawCard{
		ID:          "m1",
		Title:       "示例",
		ContentKind: "anime",
		Year:        2024,
		Area:        "日本",
		Genres:      []string{"热血"},
		PosterURL:   "http://img/p.jpg",
		Remarks:     "更新至12集",
	})
	want := RemoteCard{
		ID:        "m1",
		Title:     "示例",
		Kind:      KindAnime,
		Year:      2024,
		Area:      "日本",
		Genres:    []string{"热血"},
		Remarks:   "更新至12集",
		PosterURL: "http://img/p.jpg",
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("kanjuMapCard full=%+v want %+v", got, want)
	}

	// 缺省字段：nil genres → 空切片；空 content_kind → series。
	minimal := kanjuMapCard(RawCard{ID: "m2", Title: "x"})
	if minimal.Kind != KindSeries {
		t.Errorf("default kind=%q want series", minimal.Kind)
	}
	if minimal.Genres == nil || len(minimal.Genres) != 0 {
		t.Errorf("default genres=%v want non-nil empty", minimal.Genres)
	}
	if minimal.Year != 0 || minimal.Area != "" || minimal.Remarks != "" || minimal.PosterURL != "" {
		t.Errorf("default zero-value fields wrong: %+v", minimal)
	}
}

// TestKanjuOrderOptions 验证候选线路顺序：指定线路 > 默认选中 > 其余（去重）。
func TestKanjuOrderOptions(t *testing.T) {
	type opt = RawLineOption
	cases := []struct {
		name    string
		options []opt
		lineID  string
		wantIDs []string
	}{
		{
			name: "指定线路优先，其次选中，再去重其余",
			options: []opt{
				{PlaybackSourceID: "A"},
				{PlaybackSourceID: "B", Selected: true},
				{ID: "C"},
			},
			lineID:  "C",
			wantIDs: []string{"C", "B", "A"},
		},
		{
			name: "无指定时选中置顶",
			options: []opt{
				{PlaybackSourceID: "A"},
				{PlaybackSourceID: "B", Selected: true},
				{PlaybackSourceID: "C"},
			},
			lineID:  "",
			wantIDs: []string{"B", "A", "C"},
		},
		{
			name: "按 playback_source_id 去重",
			options: []opt{
				{PlaybackSourceID: "X"},
				{PlaybackSourceID: "X"},
				{ID: "Y"},
			},
			lineID:  "",
			wantIDs: []string{"X", "Y"},
		},
		{
			name: "指定线路不存在时回退",
			options: []opt{
				{PlaybackSourceID: "A"},
				{PlaybackSourceID: "B", Selected: true},
			},
			lineID:  "Z",
			wantIDs: []string{"B", "A"},
		},
		{
			name: "无选中无指定保持原序",
			options: []opt{
				{PlaybackSourceID: "A"},
				{PlaybackSourceID: "B"},
				{PlaybackSourceID: "C"},
			},
			lineID:  "",
			wantIDs: []string{"A", "B", "C"},
		},
		{
			name: "选中项同时被指定时不重复",
			options: []opt{
				{PlaybackSourceID: "B", Selected: true},
				{PlaybackSourceID: "A"},
			},
			lineID:  "B",
			wantIDs: []string{"B", "A"},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ordered := kanjuOrderOptions(tc.options, tc.lineID)
			gotIDs := make([]string, 0, len(ordered))
			for _, o := range ordered {
				gotIDs = append(gotIDs, kanjuCoalesce(o.PlaybackSourceID, o.ID))
			}
			if !reflect.DeepEqual(gotIDs, tc.wantIDs) {
				t.Fatalf("order ids=%v want %v", gotIDs, tc.wantIDs)
			}
		})
	}
}

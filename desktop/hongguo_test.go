package main

// 纯逻辑单测：只覆盖归一化 / 选流 / 取名的纯函数，绝不发网络、不碰 ffmpeg。
// 这些函数只依赖构造的 SDK 结构体零值/字段，便于表驱动测试。

import (
	"testing"
	"time"

	"github.com/beilunyang/openhongguo/sdk/model"
)

func TestMapKind(t *testing.T) {
	cases := []struct {
		name        string
		contentType int
		want        MediaKind
	}{
		{"电影 ContentType=5", 5, KindMovie},
		{"漫剧 ContentType=1004", 1004, KindAnime},
		{"电视剧 ContentType=6", 6, KindSeries},
		{"真人短剧 ContentType=1", 1, KindSeries},
		{"未知 ContentType=0", 0, KindSeries},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := mapKind(tc.contentType); got != tc.want {
				t.Fatalf("mapKind(%d) = %q, want %q", tc.contentType, got, tc.want)
			}
		})
	}
}

func TestCoverOf(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want string
	}{
		{"空串", "", ""},
		{"纯空白", "   ", ""},
		{"去首尾空白", "  https://x/cover.jpg  ", "https://x/cover.jpg"},
		{"正常 URL", "https://x/a.jpg", "https://x/a.jpg"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := coverOf(tc.in); got != tc.want {
				t.Fatalf("coverOf(%q) = %q, want %q", tc.in, got, tc.want)
			}
		})
	}
}

func TestYearOf(t *testing.T) {
	cases := []struct {
		name string
		in   time.Time
		want int
	}{
		{"零值", time.Time{}, 0},
		{"RFC3339 2023", time.Date(2023, 5, 1, 12, 0, 0, 0, time.UTC), 2023},
		{"2024", time.Date(2024, 12, 31, 23, 59, 59, 0, time.UTC), 2024},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := yearOf(tc.in); got != tc.want {
				t.Fatalf("yearOf(%v) = %d, want %d", tc.in, got, tc.want)
			}
		})
	}
}

func TestLabelOf(t *testing.T) {
	cases := []struct {
		name   string
		stream model.Stream
		index  int
		want   string
	}{
		{"清晰度优先", model.Stream{Definition: "720p", Quality: "normal"}, 0, "720p"},
		{"退回画质", model.Stream{Quality: "normal"}, 0, "normal"},
		{"都没有用序号", model.Stream{}, 0, "线路 1"},
		{"序号递增", model.Stream{}, 2, "线路 3"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := labelOf(tc.stream, tc.index); got != tc.want {
				t.Fatalf("labelOf(%+v,%d) = %q, want %q", tc.stream, tc.index, got, tc.want)
			}
		})
	}
}

func TestPickStreamIndex(t *testing.T) {
	mk := func(def, quality string, hls, dash bool) model.Stream {
		return model.Stream{Definition: def, Quality: quality, HLS: hls, Dash: dash}
	}
	mkProtected := func(def string, hls, dash bool) model.Stream {
		return model.Stream{Definition: def, HLS: hls, Dash: dash, Protected: true}
	}

	cases := []struct {
		name    string
		streams []model.Stream
		lineID  string
		want    int
	}{
		{
			name:    "默认优先 480p",
			streams: []model.Stream{mk("360p", "", false, false), mk("480p", "", false, false), mk("720p", "", false, false)},
			want:    1,
		},
		{
			name:    "跳过 hls 的 480p，退到 360p",
			streams: []model.Stream{mk("480p", "", true, false), mk("360p", "", false, false)},
			want:    1,
		},
		{
			name:    "lineID 指向 hg-2",
			streams: []model.Stream{mk("360p", "", false, false), mk("480p", "", false, false), mk("720p", "", false, false)},
			lineID:  "hg-2",
			want:    2,
		},
		{
			name:    "lineID 用清晰度标签",
			streams: []model.Stream{mk("360p", "", false, false), mk("720p", "", false, false)},
			lineID:  "720p",
			want:    1,
		},
		{
			name:    "无匹配清晰度退到首个单文件流",
			streams: []model.Stream{mk("240p", "", false, false), mk("144p", "", false, false)},
			want:    0,
		},
		{
			name:    "全部 hls/dash 退到索引 0",
			streams: []model.Stream{mk("480p", "", true, false), mk("720p", "", false, true)},
			want:    0,
		},
		{
			name:    "lineID 越界忽略后按优先级",
			streams: []model.Stream{mk("360p", "", false, false), mk("480p", "", false, false)},
			lineID:  "hg-9",
			want:    1,
		},
		{
			// 红果并非每集都加密：同一集里明文流能直接播，优先用它，省掉一次 ffmpeg 解密转码。
			name: "明文流优先于加密流",
			streams: []model.Stream{
				mkProtected("360p", false, false),
				mkProtected("480p", false, false),
				mk("480p", "", false, false),
			},
			want: 2,
		},
		{
			name:    "全加密时仍按清晰度优先级",
			streams: []model.Stream{mkProtected("360p", false, false), mkProtected("480p", false, false)},
			want:    1,
		},
		{
			// HLS 默认也走解密转码（hongguoResolve 会拒绝 manifest），所以这里不为了「明文」
			// 去挑一条同样要 ffmpeg 的 hls，仍按单文件优先。
			name:    "明文 hls 与单文件加密时仍选单文件",
			streams: []model.Stream{mkProtected("480p", false, false), mk("720p", "", true, false)},
			want:    0,
		},
		{
			name:    "全加密且全是 manifest 时退回索引 0",
			streams: []model.Stream{mkProtected("480p", true, false), mkProtected("720p", false, true)},
			want:    0,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := pickStreamIndex(tc.streams, tc.lineID); got != tc.want {
				t.Fatalf("pickStreamIndex(%v,%q) = %d, want %d", tc.streams, tc.lineID, got, tc.want)
			}
		})
	}
}

func TestHongguoNormalize(t *testing.T) {
	// 详情次要信息行：分类 / 标签 / 演员。
	series := model.Series{
		SeriesSummary: model.SeriesSummary{
			ID:           "s1",
			Title:        "示例剧",
			EpisodeCount: 12,
			Category:     "都市",
			CoverURL:     "  https://x/cover.jpg  ",
		},
		Rows: []model.InfoRow{
			{Kind: model.InfoCategory, Text: "末世·悬疑"},
			{Kind: model.InfoTags, Text: "爽文/逆袭"},
			{Kind: model.InfoTwoActors, Text: "演员·张三 李四"},
			{Kind: model.InfoTwoActors, Text: "演员：张三 王五"},
			{Kind: model.InfoScore, Text: "9.0"}, // 不参与 genres/actors
		},
	}

	genres := genresFromRows(series)
	wantGenres := []string{"都市", "末世", "悬疑", "爽文", "逆袭"}
	if len(genres) != len(wantGenres) {
		t.Fatalf("genres = %v, want %v", genres, wantGenres)
	}
	for i := range wantGenres {
		if genres[i] != wantGenres[i] {
			t.Fatalf("genres = %v, want %v", genres, wantGenres)
		}
	}

	actors := actorsFromRows(series)
	wantActors := []string{"张三", "李四", "王五"} // 去重后
	if len(actors) != len(wantActors) {
		t.Fatalf("actors = %v, want %v", actors, wantActors)
	}
	for i := range wantActors {
		if actors[i] != wantActors[i] {
			t.Fatalf("actors = %v, want %v", actors, wantActors)
		}
	}

	card := mapSummary(series.SeriesSummary)
	if card.Kind != KindSeries {
		t.Fatalf("card.Kind = %q, want series", card.Kind)
	}
	if card.Remarks != "共 12 集" {
		t.Fatalf("card.Remarks = %q", card.Remarks)
	}
	if card.PosterURL != "https://x/cover.jpg" {
		t.Fatalf("card.PosterURL = %q", card.PosterURL)
	}
	if len(card.Genres) != 1 || card.Genres[0] != "都市" {
		t.Fatalf("card.Genres = %v", card.Genres)
	}
}

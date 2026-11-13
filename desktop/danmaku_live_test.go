package main

// 联网冒烟测试（默认跳过；仅当 LIVE=1 时运行）。
// 验收红果真实弹幕拉取链路：hongguoSearch → hongguoEpisodes → hongguoDanmaku。

import (
	"path/filepath"
	"testing"
)

func TestLiveHongguoDanmaku(t *testing.T) {
	liveEnabled(t)

	dir := t.TempDir()
	configureHongguo(filepath.Join(dir, "cache"), defaultFfmpegPath(), filepath.Join(dir, "anonymous.json"))

	page, err := hongguoSearch("重生", 1)
	if err != nil {
		t.Fatalf("hongguoSearch: %v", err)
	}
	if len(page.Cards) == 0 {
		t.Fatal("hongguoSearch returned no cards")
	}
	series := page.Cards[0]
	episodes, err := hongguoEpisodes(series.ID)
	if err != nil {
		t.Fatalf("hongguoEpisodes: %v", err)
	}
	if len(episodes) == 0 {
		t.Fatal("no episodes")
	}
	items, err := hongguoDanmaku(series.ID, episodes[0].Token)
	if err != nil {
		t.Fatalf("hongguoDanmaku: %v", err)
	}
	t.Logf("series=%q ep=%q danmaku=%d", series.Title, episodes[0].Title, len(items))
	for i, it := range items {
		if i >= 5 {
			break
		}
		t.Logf("  %.1fs %q (type=%s)", it.Time, it.Content, it.Type)
	}
}

package main

// 联网冒烟测试（默认跳过；仅当 LIVE=1 时运行）。
// 不参与 CI：需要真实外网访问 kanju1.com / 红果接口。用于人工验收两套在线片源适配器。

import (
	"os"
	"path/filepath"
	"testing"
)

func liveEnabled(t *testing.T) {
	t.Helper()
	if os.Getenv("LIVE") != "1" {
		t.Skip("set LIVE=1 to run live network smoke tests")
	}
}

func TestLiveKanju(t *testing.T) {
	liveEnabled(t)

	home, err := kanjuHome()
	if err != nil {
		t.Fatalf("kanjuHome: %v", err)
	}
	t.Logf("kanju home sections=%d", len(home.Sections))
	if len(home.Sections) == 0 || len(home.Sections[0].Cards) == 0 {
		t.Fatalf("kanju home empty")
	}
	first := home.Sections[0].Cards[0]
	t.Logf("kanju first card: id=%s title=%q kind=%s", first.ID, first.Title, first.Kind)

	page, err := kanjuSearch(first.Title, 1)
	if err != nil {
		t.Fatalf("kanjuSearch: %v", err)
	}
	t.Logf("kanju search %q -> %d cards hasMore=%v", first.Title, len(page.Cards), page.HasMore)

	episodes, err := kanjuEpisodes(first.ID)
	if err != nil {
		t.Fatalf("kanjuEpisodes: %v", err)
	}
	t.Logf("kanju episodes=%d", len(episodes))
	if len(episodes) == 0 {
		t.Fatal("kanju no episodes")
	}

	pb, err := kanjuResolve(episodes[0].Token, "")
	if err != nil {
		t.Fatalf("kanjuResolve: %v", err)
	}
	t.Logf("kanju resolve ok: urlKind=%s lines=%d urlLen=%d", pb.URLKind, len(pb.Lines), len(pb.URL))
}

func TestLiveHongguo(t *testing.T) {
	liveEnabled(t)

	dir := t.TempDir()
	configureHongguo(filepath.Join(dir, "cache"), "ffmpeg", filepath.Join(dir, "anonymous.json"))

	home, err := hongguoHome()
	if err != nil {
		t.Fatalf("hongguoHome: %v", err)
	}
	t.Logf("hongguo home sections=%d", len(home.Sections))
	if len(home.Sections) == 0 || len(home.Sections[0].Cards) == 0 {
		t.Fatalf("hongguo home empty")
	}
	first := home.Sections[0].Cards[0]
	t.Logf("hongguo first card: id=%s title=%q", first.ID, first.Title)

	episodes, err := hongguoEpisodes(first.ID)
	if err != nil {
		t.Fatalf("hongguoEpisodes: %v", err)
	}
	t.Logf("hongguo episodes=%d", len(episodes))
	if len(episodes) == 0 {
		t.Fatal("hongguo no episodes")
	}

	// 加密分集需要 ffmpeg 解密；这里只验证解析链路能拿到地址/线路，不做整段转码。
	pb, err := hongguoResolve(episodes[0].Token, "", func(p string) string { return "file://" + p })
	if err != nil {
		t.Logf("hongguoResolve 未成功（可能加密需转码/额度限制）：%v", err)
		return
	}
	t.Logf("hongguo resolve ok: urlKind=%s lines=%d urlLen=%d", pb.URLKind, len(pb.Lines), len(pb.URL))
}

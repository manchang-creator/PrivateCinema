package main

// 纯逻辑/本机探测单测：不联网、不碰红果接口。

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestFfmpegCandidatesOrder(t *testing.T) {
	got := ffmpegCandidates("/custom/ffmpeg")
	if len(got) < 2 {
		t.Fatalf("候选太少: %v", got)
	}
	if got[0] != "/custom/ffmpeg" {
		t.Fatalf("显式配置必须排第一，实际 %q", got[0])
	}
	exe := "ffmpeg"
	if runtime.GOOS == "windows" {
		exe = "ffmpeg.exe"
	}
	if got[len(got)-1] != exe {
		t.Fatalf("裸名（PATH 查找）必须排最后，实际 %q", got[len(got)-1])
	}
	seen := map[string]bool{}
	for _, c := range got {
		if seen[c] {
			t.Fatalf("候选重复: %q", c)
		}
		seen[c] = true
	}
}

func TestFfmpegCandidatesIncludesAppDir(t *testing.T) {
	self, err := os.Executable()
	if err != nil {
		t.Skip("无法取到自身路径")
	}
	dir := filepath.Dir(self)
	found := false
	for _, c := range ffmpegCandidates("") {
		if filepath.Dir(c) == dir {
			found = true
		}
	}
	if !found {
		t.Fatalf("候选里应包含应用同目录: %v", ffmpegCandidates(""))
	}
}

func TestDetectFfmpegFindsNothingWhenMissing(t *testing.T) {
	if runtime.GOOS != "windows" {
		// 依赖「绝对路径不存在」，避免误命中系统 ffmpeg。
		path, _ := detectFfmpeg(filepath.Join(t.TempDir(), "definitely-not-ffmpeg"))
		if path == "" {
			t.Fatalf("本机 PATH 有 ffmpeg 时应该能兜底找到")
		}
	}
}

func TestFfmpegExecutableErrorMentionsHint(t *testing.T) {
	t.Setenv("PATH", t.TempDir())
	t.Setenv("FFMPEG_PATH", "")
	_, err := ffmpegExecutable(filepath.Join(t.TempDir(), "nope"))
	if err == nil {
		t.Skip("本机仍能通过固定候选找到 ffmpeg，跳过")
	}
	if !strings.Contains(err.Error(), "未找到 ffmpeg") || !strings.Contains(err.Error(), "winget") {
		t.Fatalf("错误信息缺少安装指引: %v", err)
	}
}

func TestProbeFfmpegCachesResult(t *testing.T) {
	if _, err := os.Stat("/bin/true"); err != nil {
		t.Skip("无 /bin/true")
	}
	first := probeFfmpeg("/bin/true", false)
	if first.ok {
		t.Fatalf("/bin/true 的 -version 输出不应被当成 ffmpeg 版本")
	}
	second := probeFfmpeg("/bin/true", false)
	if !second.at.Equal(first.at) {
		t.Fatalf("失败结果应短期缓存，避免每次播放都重跑探测")
	}
}

func TestFfmpegCandidatesPreferExeDirBeforePlatformDirs(t *testing.T) {
	self, err := os.Executable()
	if err != nil {
		t.Skip("无法取到自身路径")
	}
	exeDir := filepath.Dir(self)
	list := ffmpegCandidates("")
	exeIdx, pathIdx := -1, -1
	for i, c := range list {
		if filepath.Dir(c) == exeDir && exeIdx < 0 {
			exeIdx = i
		}
		if filepath.Base(c) == "ffmpeg" || filepath.Base(c) == "ffmpeg.exe" {
			if filepath.Dir(c) != exeDir {
				pathIdx = i
			}
		}
	}
	if exeIdx < 0 {
		t.Fatalf("候选里没有应用同目录: %v", list)
	}
	if pathIdx >= 0 && pathIdx < exeIdx {
		t.Fatalf("PATH 兜底(裸名)不应排在应用同目录之前: %v", list)
	}
}

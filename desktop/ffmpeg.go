package main

// ==================== 外部依赖：ffmpeg 定位 ====================
// 红果加密分集要靠 ffmpeg 解密 + 转码（见 hongguo.go 的 ffmpeg 解密一节）。
// Windows 安装包不带 ffmpeg，而「装了 ffmpeg 但代码看不到」是最常见的报错来源：
//   - Windows 版最常见的安装方式 `winget install ffmpeg` / `choco install ffmpeg`
//     只把它放进用户/系统 PATH，装完不重开应用，正在运行的进程读不到新 PATH；
//   - 便携版/手解压的 ffmpeg 常常就摆在 exe 同目录，却没人把它加进 PATH。
// 因此这里在「PATH + FFMPEG_PATH」之外，再按固定顺序补几个候选位置，并在后台线程里
// 预热一次探测结果，播放时就不用每次重新查找。

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	// ffmpegHintInstall 是给用户看的安装指引（找不到 ffmpeg 时拼进错误信息）。
	ffmpegHintInstall = "Windows：winget install Gyan.FFmpeg 后重开应用，或把 ffmpeg.exe 放到应用同目录；" +
		"macOS：brew install ffmpeg；Linux：apt install ffmpeg。也可用环境变量 FFMPEG_PATH 指定完整路径"
	// ffmpegProbeTimeout 是 `ffmpeg -version` 探测的上限，避免坏掉的 exe 卡住调用方。
	ffmpegProbeTimeout = 8 * time.Second
)

var (
	ffmpegMu    sync.Mutex
	ffmpegCache = map[string]ffmpegProbe{}
)

type ffmpegProbe struct {
	path    string
	version string
	err     error
	at      time.Time
	// ok 表示探测成功（version 非空）。
	ok bool
}

// ffmpegCandidates 返回要依次尝试的 ffmpeg 路径。
// 顺序：显式配置（FFMPEG_PATH / 注入值）→ 应用目录 → 用户常见安装位置 → PATH。
func ffmpegCandidates(configured string) []string {
	var out []string
	seen := map[string]bool{}
	add := func(p string) {
		if p == "" {
			return
		}
		key := strings.ToLower(filepath.Clean(p))
		if seen[key] {
			return
		}
		seen[key] = true
		out = append(out, p)
	}

	if configured != "" {
		add(configured)
	}
	if env := strings.TrimSpace(os.Getenv("FFMPEG_PATH")); env != "" {
		add(env)
	}

	exeName := "ffmpeg"
	if runtime.GOOS == "windows" {
		exeName = "ffmpeg.exe"
	}
	if self, err := os.Executable(); err == nil {
		// 便携版：ffmpeg.exe 就放在应用同目录（或 ffmpeg/bin、resources 下）。
		dir := filepath.Dir(self)
		add(filepath.Join(dir, exeName))
		add(filepath.Join(dir, "bin", exeName))
	}

	switch runtime.GOOS {
	case "windows":
		if local := os.Getenv("LOCALAPPDATA"); local != "" {
			add(filepath.Join(local, "Microsoft", "WinGet", "Links", exeName))
			for _, p := range globVersioned(filepath.Join(local, "Microsoft", "WinGet", "Packages"), "Gyan.FFmpeg*", "ffmpeg-*", "bin", exeName) {
				add(p)
			}
			add(filepath.Join(local, "Programs", "ffmpeg", "bin", exeName))
		}
		if pf := os.Getenv("ProgramFiles"); pf != "" {
			add(filepath.Join(pf, "ffmpeg", "bin", exeName))
			for _, p := range globVersioned(pf, "ffmpeg*", "bin", exeName) {
				add(p)
			}
		}
		add(`C:\ffmpeg\bin\` + exeName)
	case "darwin":
		add("/opt/homebrew/bin/ffmpeg")
		add("/usr/local/bin/ffmpeg")
	default:
		add("/usr/bin/ffmpeg")
		add("/usr/local/bin/ffmpeg")
		add("/snap/bin/ffmpeg")
	}

	// 最后才用裸名交给 exec.LookPath，命中当前进程的 PATH。
	add(exeName)
	return out
}

// globVersioned 按「父目录下多级通配」展开候选，结果按路径排序保证稳定。
func globVersioned(root string, pattern ...string) []string {
	if len(pattern) == 0 {
		return nil
	}
	parts := append([]string{root}, pattern...)
	matches, err := filepath.Glob(filepath.Join(parts...))
	if err != nil {
		return nil
	}
	sort.Strings(matches)
	return matches
}

// probeFfmpeg 跑一次 `ffmpeg -version` 确认可执行；带进程内缓存。
func probeFfmpeg(path string, force bool) ffmpegProbe {
	ffmpegMu.Lock()
	if !force {
		if cached, ok := ffmpegCache[path]; ok && (cached.ok || time.Since(cached.at) < 30*time.Second) {
			ffmpegMu.Unlock()
			return cached
		}
	}
	ffmpegMu.Unlock()

	probe := runFfmpegProbe(path)

	ffmpegMu.Lock()
	ffmpegCache[path] = probe
	ffmpegMu.Unlock()
	return probe
}

func runFfmpegProbe(path string) ffmpegProbe {
	probe := ffmpegProbe{path: path, at: time.Now()}
	resolved, err := exec.LookPath(path)
	if err != nil {
		probe.err = err
		return probe
	}
	probe.path = resolved

	done := make(chan struct{})
	var out []byte
	var runErr error
	go func() {
		defer close(done)
		out, runErr = exec.Command(resolved, "-version").Output()
	}()
	select {
	case <-done:
	case <-time.After(ffmpegProbeTimeout):
		probe.err = errFfmpegProbeTimeout
		return probe
	}
	if runErr != nil {
		probe.err = runErr
		return probe
	}
	// 只取第一行（形如 "ffmpeg version 7.1.1-full_build-www.gyan.dev ..."）。
	line := string(out)
	if idx := strings.IndexAny(line, "\r\n"); idx >= 0 {
		line = line[:idx]
	}
	probe.version = strings.TrimSpace(line)
	probe.ok = probe.version != ""
	return probe
}

type ffmpegProbeError string

func (e ffmpegProbeError) Error() string { return string(e) }

const errFfmpegProbeTimeout = ffmpegProbeError("ffmpeg -version 探测超时")

// detectFfmpeg 返回第一个能跑起来的 ffmpeg，以及探测失败的原因摘要。
func detectFfmpeg(configured string) (string, string) {
	candidates := ffmpegCandidates(configured)
	var reasons []string
	for _, cand := range candidates {
		p := probeFfmpeg(cand, false)
		if p.ok {
			return p.path, ""
		}
		if cand != "ffmpeg" && cand != "ffmpeg.exe" {
			reasons = append(reasons, filepath.Base(filepath.Dir(cand))+"/"+filepath.Base(cand)+": "+p.err.Error())
		}
	}
	if len(reasons) > 4 {
		reasons = reasons[len(reasons)-4:]
	}
	return "", strings.Join(reasons, "；")
}

// warmFfmpeg 在后台预热探测，让第一次播放不用等 `-version`。
func warmFfmpeg(configured string) {
	go func() { _, _ = detectFfmpeg(configured) }()
}

// ffmpegVersion 返回某个 ffmpeg 的版本行（设置页/诊断用；探测失败返回空串）。
func ffmpegVersion(path string) string {
	if path == "" {
		return ""
	}
	return probeFfmpeg(path, false).version
}

// ==================== 对外：ffmpeg 诊断 ====================

// FfmpegStatus 是设置页/排障用的环境诊断结果。
// 之所以要有这个通道：Windows 用户最常见的失败就是「装了 ffmpeg 但应用没看到」，
// 报错只有一句话很难定位；这里把探测过的候选、版本、建议一次性吐给界面。
type FfmpegStatus struct {
	// Available 表示找到了能跑的 ffmpeg。
	Available bool `json:"available"`
	// Path 是最终使用的 ffmpeg 完整路径。
	Path string `json:"path"`
	// Version 是 `ffmpeg -version` 的第一行。
	Version string `json:"version"`
	// Checked 是依次尝试过的路径（含失败项），用于确认到底找过哪里。
	Checked []FfmpegChecked `json:"checked"`
	// Hint 是安装/指定路径的建议文案。
	Hint string `json:"hint"`
	// CacheDir 是解密产物缓存目录，便于清理与确认写权限。
	CacheDir string `json:"cacheDir"`
}

// FfmpegChecked 一条候选探测记录。
type FfmpegChecked struct {
	Path   string `json:"path"`
	OK     bool   `json:"ok"`
	Reason string `json:"reason,omitempty"`
}

// FfmpegDiagnose 现场再探测一遍所有候选，返回可用性、版本与尝试记录。
func (c *Cinema) FfmpegDiagnose() (FfmpegStatus, error) {
	cfg := currentHongguoConfig()
	status := FfmpegStatus{Hint: ffmpegHintInstall, CacheDir: cfg.cacheDir}
	for _, cand := range ffmpegCandidates(cfg.ffmpegPath) {
		probe := probeFfmpeg(cand, true)
		item := FfmpegChecked{Path: probe.path, OK: probe.ok}
		if !probe.ok && probe.err != nil {
			item.Reason = probe.err.Error()
		}
		if item.Path == "" {
			item.Path = cand
		}
		status.Checked = append(status.Checked, item)
		if probe.ok && !status.Available {
			status.Available = true
			status.Path = probe.path
			status.Version = probe.version
		}
	}
	return status, nil
}

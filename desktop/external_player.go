package main

// ==================== 外部播放器（MKV 等 WebView 不支持的容器兜底） ====================
// WebKitGTK / WebView2 受 Chromium 容器与编码白名单限制，MKV 往往 MEDIA_ERR_SRC_NOT_SUPPORTED。
// 这里提供「用系统播放器打开」的能力：优先 mpv/vlc 等，找不到就回落 xdg-open（Linux）。
// 只放行用户在本进程内选择过（已授权）的文件，和本地媒体协议一致的安全边界。

import (
	"errors"
	"os"
	"os/exec"
	"runtime"
)

// PlayExternal 用外部播放器打开一个本地文件，返回所用播放器名。仅限已授权文件。
func (c *Cinema) PlayExternal(filePath string) (string, error) {
	if c.access == nil {
		return "", errors.New("后端尚未初始化")
	}
	if filePath == "" {
		return "", errors.New("路径为空")
	}
	if !c.access.IsAllowed(filePath) {
		return "", errors.New("未授权的文件")
	}
	info, err := os.Stat(filePath)
	if err != nil || !info.Mode().IsRegular() {
		return "", errors.New("文件不存在")
	}
	player, args, err := pickPlayer()
	if err != nil {
		return "", err
	}
	cmd := exec.Command(player, append(args, filePath)...)
	cmd.Stdin = nil
	cmd.Stdout = nil
	cmd.Stderr = nil
	if err := cmd.Start(); err != nil {
		return "", errors.New("启动外部播放器失败：" + err.Error())
	}
	// 不阻塞 UI：后台回收子进程。
	go func() { _ = cmd.Wait() }()
	return player, nil
}

// pickPlayer 选择外部播放器。可用 PRIVATE_CINEMA_PLAYER 覆盖（其值可带参数，空格分隔）。
func pickPlayer() (string, []string, error) {
	if custom := os.Getenv("PRIVATE_CINEMA_PLAYER"); custom != "" {
		parts := splitFields(custom)
		if len(parts) > 0 {
			if p, err := exec.LookPath(parts[0]); err == nil {
				return p, parts[1:], nil
			}
			return parts[0], parts[1:], nil // 允许用户给绝对路径
		}
	}
	candidates := []string{"mpv", "vlc", "celluloid", "totem"}
	if runtime.GOOS == "windows" {
		candidates = []string{"mpv", "vlc"}
	} else {
		candidates = append(candidates, "xdg-open")
	}
	for _, name := range candidates {
		if p, err := exec.LookPath(name); err == nil {
			return p, nil, nil
		}
	}
	return "", nil, errors.New("未找到外部播放器（可安装 mpv 或 vlc，或设置 PRIVATE_CINEMA_PLAYER）")
}

// splitFields 按空白切分（不引入 shell 解析，避免命令注入）。
func splitFields(s string) []string {
	var out []string
	cur := ""
	for _, r := range s {
		if r == ' ' || r == '\t' || r == '\n' {
			if cur != "" {
				out = append(out, cur)
				cur = ""
			}
			continue
		}
		cur += string(r)
	}
	if cur != "" {
		out = append(out, cur)
	}
	return out
}

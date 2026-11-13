package main

// ==================== 私人影院 · 桌面端（mygo 版） ====================
// 单一 Go 程序 = 后端（原 Electron 主进程）+ 承载前端页面（mygo 的 WebView 模式）。
// 与旧架构的对应关系：
//   Electron main/preload/IPC  →  本文件 + cinema.go（mygo.Bind 生成类型化 IPC）
//   cinema:// 自定义协议        →  media_server.go（loopback HTTP，Range 流式）
//   渲染进程 React              →  frontend/（原样复用，仅换 window.cinema 适配层）
//   windows/ 与 linux/ 两套壳   →  合并为这一套（mygo 纯 Go，跨平台构建）

import (
	_ "embed"
	"log"
	"os"
	"path/filepath"

	"github.com/egoist/mygo"
)

// 应用图标：打包时内嵌，运行时再用 SetIcon 设成窗口图标（标题栏 + 任务栏/停靠栏）。
//
//go:embed resources/icon.png
var appIcon []byte

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func main() {
	access := newAccessRegistry()
	media := newMediaServer(access)
	cinema := &Cinema{access: access, media: media}

	// 绑定服务：`mygo generate` 会据此生成 src/mygo.ts。
	mygo.Bind(cinema)

	mygo.App.WhenReady(func() {
		// 1) 先起本地媒体服务，拿到 127.0.0.1 基址（前端经 Cinema.mediaBase 读取）。
		if err := media.Start(); err != nil {
			log.Printf("媒体服务启动失败: %v", err)
		}
		// 2) 进度库 / 红果缓存与匿名档案都落在 userData 目录（与旧 Electron 行为一致）。
		userData, err := mygo.App.Path(mygo.PathUserData)
		if err != nil {
			userData = os.TempDir()
		}
		cinema.progress = newProgressStore(userData)
		configureHongguo(
			filepath.Join(userData, "hongguo-cache"),
			envOr("FFMPEG_PATH", "ffmpeg"),
			filepath.Join(userData, "openhongguo", "anonymous.json"),
		)
		configureUpdate(userData)

		// 3) 主窗口。
		win := mygo.NewWindow(mygo.WindowOptions{
			Title:           "私人影院",
			URL:             "/",
			Width:           1280,
			Height:          800,
			MinWidth:        960,
			MinHeight:       600,
			BackgroundColor: "#0b0b0d",
			AutoHideMenuBar: true,
			StateKey:        "main",
		})
		// 窗口自己的图标（GTK 的 _NET_WM_ICON → 标题栏/任务栏），避免显示成通用空白图标。
		if err := win.SetIcon(appIcon); err != nil {
			log.Printf("设置窗口图标失败: %v", err)
		}

		// 4) 启动后按偏好做一次静默自动更新检查（仅正式构建生效）。
		go autoUpdateOnStart()
	})

	if err := mygo.App.Run(); err != nil {
		log.Fatal(err)
	}
}

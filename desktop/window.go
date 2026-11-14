package main

// ==================== 窗口模式：小窗 / 置顶 ====================
// 两个跟窗口本身有关的开关，落在设置页「窗口」分组：
//   - 小窗模式：把主窗口缩到约 560×400 的一份「边看边干别的」尺寸，并放开最小尺寸限制；
//     关掉后回到常规尺寸。原来是最大化的话先还原再缩，否则在多数窗口管理器上 SetSize 无效。
//   - 窗口置顶：AlwaysOnTop，跨平台由 mygo 的 SetAlwaysOnTop 落到各平台原生实现
//     （Linux 走 X11/Wayland 的 above 提示，Windows 走 HWND_TOPMOST，macOS 走
//     NSFloatingWindowLevel）。
//
// 偏好落盘复用 update.go 的 appSettings（userData/app-settings.json），
// 启动时由 applyWindowPrefs 还原，避免每次开应用都要重新勾一遍。

import (
	"errors"
	"log"
	"sync"

	"github.com/egoist/mygo"
)

const (
	// 小窗尺寸：够放下侧栏折叠态 + 一屏 hero，又不至于挡住其他窗口。
	// 高度取 400：再矮 hero 的 clamp(380px,...) 会把下方内容全挤没。
	compactWidth  = 560
	compactHeight = 420
	// 小窗模式下允许的最小尺寸，比常规 960×600 小一截。
	compactMinWidth  = 420
	compactMinHeight = 320
	// 常规模式的最小尺寸，与 main.go 建窗时一致。
	normalMinWidth  = 960
	normalMinHeight = 600
	// 常规模式的恢复尺寸。
	normalWidth  = 1280
	normalHeight = 800
)

var (
	windowMu   sync.Mutex
	mainWindow *mygo.Window
)

// setMainWindow 由主进程建窗后注入；窗口控制 API 都基于它。
func setMainWindow(win *mygo.Window) {
	windowMu.Lock()
	mainWindow = win
	windowMu.Unlock()
}

func currentWindow() (*mygo.Window, error) {
	windowMu.Lock()
	win := mainWindow
	windowMu.Unlock()
	if win == nil || win.IsDestroyed() {
		return nil, errors.New("主窗口尚未就绪")
	}
	return win, nil
}

// CompactMode 读取「小窗模式」开关。
func (c *Cinema) CompactMode() (bool, error) {
	return loadAppSettings().CompactMode, nil
}

// SetCompactMode 切换小窗模式：改窗口尺寸与最小尺寸，并把偏好落盘。
func (c *Cinema) SetCompactMode(enabled bool) error {
	win, err := currentWindow()
	if err != nil {
		return err
	}

	if enabled {
		// 最大化状态下 SetSize 在不少 WM 上会被忽略，先还原。
		if win.IsMaximized() {
			win.Unmaximize()
		}
		win.SetMinimumSize(compactMinWidth, compactMinHeight)
		win.SetSize(compactWidth, compactHeight)
		win.Center()
	} else {
		win.SetSize(normalWidth, normalHeight)
		win.SetMinimumSize(normalMinWidth, normalMinHeight)
		win.Center()
	}

	settings := loadAppSettings()
	settings.CompactMode = enabled
	return saveAppSettings(settings)
}

// AlwaysOnTop 读取「窗口置顶」开关。
func (c *Cinema) AlwaysOnTop() (bool, error) {
	return loadAppSettings().AlwaysOnTop, nil
}

// SetAlwaysOnTop 切换窗口置顶，并把偏好落盘。
func (c *Cinema) SetAlwaysOnTop(enabled bool) error {
	win, err := currentWindow()
	if err != nil {
		return err
	}
	win.SetAlwaysOnTop(enabled)

	settings := loadAppSettings()
	settings.AlwaysOnTop = enabled
	return saveAppSettings(settings)
}

// applyWindowPrefs 在窗口创建后还原上次的窗口偏好；读盘失败只记日志，不挡启动。
func applyWindowPrefs(win *mygo.Window) {
	settings := loadAppSettings()
	if settings.AlwaysOnTop {
		win.SetAlwaysOnTop(true)
	}
	if settings.CompactMode {
		win.SetMinimumSize(compactMinWidth, compactMinHeight)
		win.SetSize(compactWidth, compactHeight)
		win.Center()
	}
	if settings.AlwaysOnTop || settings.CompactMode {
		log.Printf("窗口偏好已还原：置顶=%v 小窗=%v", settings.AlwaysOnTop, settings.CompactMode)
	}
}

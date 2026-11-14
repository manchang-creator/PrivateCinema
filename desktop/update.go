package main

// ==================== 应用更新（基于 mygo.Updater 的签名更新）====================
// mygo 自带签名更新器：mygo.config.ts 配置 updates（publicKey + github/url）后，
// `mygo build` 会为每个平台产出 update-<target>.json 清单和签名归档；安装后的应用用
// mygo.Updater.Check 比对版本、mygo.Updater.Install 下载安装、mygo.App.Relaunch 重启生效。
//
// 这里把它包成前端「设置 → 更新」能用的能力：
//   - AppInfo：当前版本 / 平台 / 是否启用更新 / 自动更新开关；
//   - CheckUpdate：检查是否为新版本（结果缓存，供 InstallUpdate 用）；
//   - InstallUpdate：安装检查到的更新；RestartApp：重启生效；
//   - Get/SetAutoUpdate：自动更新偏好落盘到 userData/app-settings.json；
//   - autoUpdateOnStart：启动时按偏好静默检查并安装（仅正式构建生效）。
//
// 注意：是否「能」在线更新取决于构建是否带 updates（mygo.Updater.Enabled）。
// dev / 普通 `go build` 构建会返回未启用，界面据此提示，不影响其它功能。

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"sync"
	"time"

	"github.com/egoist/mygo"
)

// appSettings 存在 userData/app-settings.json 的应用级偏好。
type appSettings struct {
	AutoUpdate bool `json:"autoUpdate"`
	// CompactMode 小窗模式；AlwaysOnTop 窗口置顶。见 window.go。
	CompactMode bool `json:"compactMode"`
	AlwaysOnTop bool `json:"alwaysOnTop"`
}

var (
	updateMu        sync.Mutex
	updatePrefsPath string
	updatePrefs     *appSettings
	pendingUpdate   *mygo.Update
)

// configureUpdate 由主进程启动时注入 userData 目录。
func configureUpdate(userData string) {
	updateMu.Lock()
	updatePrefsPath = filepath.Join(userData, "app-settings.json")
	updatePrefs = nil
	updateMu.Unlock()
}

func defaultAppSettings() appSettings {
	// 默认开启自动更新：用户装了新版就自动更到最新；可用设置页关掉。
	return appSettings{AutoUpdate: true}
}

func loadAppSettings() appSettings {
	updateMu.Lock()
	defer updateMu.Unlock()
	if updatePrefs != nil {
		return *updatePrefs
	}
	s := defaultAppSettings()
	if updatePrefsPath != "" {
		if data, err := os.ReadFile(updatePrefsPath); err == nil {
			_ = json.Unmarshal(data, &s)
		}
	}
	updatePrefs = &s
	return s
}

func saveAppSettings(s appSettings) error {
	updateMu.Lock()
	updatePrefs = &s
	path := updatePrefsPath
	updateMu.Unlock()
	if path == "" {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func currentVersion() string {
	if v := mygo.App.Version(); v != "" {
		return v
	}
	return "0.0.0-dev"
}

// AppInfo 返回应用与更新的元信息。
func (c *Cinema) AppInfo() (AppInfo, error) {
	return AppInfo{
		Version:        currentVersion(),
		Platform:       runtime.GOOS + "-" + runtime.GOARCH,
		IsDev:          mygo.IsDev(),
		UpdatesEnabled: mygo.Updater.Enabled(),
		AutoUpdate:     loadAppSettings().AutoUpdate,
	}, nil
}

// CheckUpdate 检查是否有新版本。未启用更新的构建直接返回 enabled=false。
func (c *Cinema) CheckUpdate(ctx context.Context) (UpdateInfo, error) {
	info := UpdateInfo{Enabled: mygo.Updater.Enabled(), Current: currentVersion()}
	if !info.Enabled {
		return info, nil
	}
	up, err := mygo.Updater.Check(ctx)
	if err != nil {
		return info, err
	}
	updateMu.Lock()
	pendingUpdate = up
	updateMu.Unlock()
	if up == nil {
		return info, nil
	}
	info.Available = true
	info.Version = up.Version
	info.Notes = up.Notes
	if !up.Date.IsZero() {
		info.Date = up.Date.Format(time.RFC3339)
	}
	return info, nil
}

// InstallUpdate 下载并安装上次 CheckUpdate 找到的更新（不自动重启，由前端调 RestartApp）。
func (c *Cinema) InstallUpdate(ctx context.Context) error {
	updateMu.Lock()
	up := pendingUpdate
	updateMu.Unlock()
	if up == nil {
		return errors.New("没有可安装的更新，请先检查更新")
	}
	return up.Install(ctx, nil)
}

// RestartApp 重启应用，让已安装的更新生效。
func (c *Cinema) RestartApp() error {
	mygo.App.Relaunch()
	return nil
}

// GetAutoUpdate 读取「自动更新」开关。
func (c *Cinema) GetAutoUpdate() (bool, error) {
	return loadAppSettings().AutoUpdate, nil
}

// SetAutoUpdate 设置「自动更新」开关并落盘。
func (c *Cinema) SetAutoUpdate(enabled bool) error {
	s := loadAppSettings()
	s.AutoUpdate = enabled
	return saveAppSettings(s)
}

// autoUpdateOnStart 启动时静默检查并按需安装；仅在启用更新的正式构建且开了自动更新时动作。
// 设置环境变量 CINEMA_DISABLE_AUTOUPDATE=1 可临时关掉。
func autoUpdateOnStart() {
	if os.Getenv("CINEMA_DISABLE_AUTOUPDATE") == "1" {
		return
	}
	if !loadAppSettings().AutoUpdate || !mygo.Updater.Enabled() {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	up, err := mygo.Updater.Check(ctx)
	if err != nil || up == nil {
		return
	}
	if err := up.Install(ctx, nil); err != nil {
		return
	}
	mygo.App.Relaunch()
}

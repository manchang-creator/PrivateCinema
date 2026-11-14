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
	"fmt"
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

// configureUpdate 由主进程启动时注入 userData 目录；空串表示「还没就绪」。
func configureUpdate(userData string) {
	updateMu.Lock()
	if userData == "" {
		updatePrefsPath = ""
	} else {
		updatePrefsPath = filepath.Join(userData, "app-settings.json")
	}
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

// updateLogPath 是 userData 下的更新日志：网络故障（GFW / 代理 / CDN EOF）在界面上
// 只有一句话，落盘后才能事后定位是哪一跳断的。
func updateLogPath() string {
	updateMu.Lock()
	prefs := updatePrefsPath
	updateMu.Unlock()
	if prefs == "" {
		return ""
	}
	return filepath.Join(filepath.Dir(prefs), "update.log")
}

// appendUpdateLog 追加一行带时间戳的更新日志；写失败不影响主流程。
func appendUpdateLog(format string, args ...any) {
	path := updateLogPath()
	if path == "" {
		return
	}
	line := time.Now().Format(time.RFC3339) + " " + fmt.Sprintf(format, args...) + "\n"
	f, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return
	}
	_, _ = f.WriteString(line)
	_ = f.Close()
}

// checkOnce 检查一轮。镜像启用时先走镜像，失败（且允许回落）再走 GitHub feed。
func checkOnce(ctx context.Context) (*mygo.Update, error) {
	up, err := mygo.Updater.Check(ctx)
	if err == nil || !mirrorActive || !shouldFallbackToGitHub() {
		return up, err
	}
	return withGitHubFallback(ctx, err, func() (*mygo.Update, error) {
		return mygo.Updater.Check(ctx)
	})
}

// checkWithRetry 在 mygo 自带的两级重试（1s / 3s）之外再补几轮。
// 实测 Windows 上首次访问 GitHub 的 release 资产（302 跳到 release-assets.githubusercontent.com）
// 常被 RST 成 "EOF"，而稍后同一请求就能成功；用户点一次「检查更新」不该因为这一下就失败。
func checkWithRetry(ctx context.Context) (*mygo.Update, error) {
	backoff := []time.Duration{0, 2 * time.Second, 5 * time.Second, 10 * time.Second}
	var lastErr error
	for attempt, wait := range backoff {
		if wait > 0 {
			select {
			case <-ctx.Done():
				appendUpdateLog("check aborted after %d attempts: %v", attempt, ctx.Err())
				return nil, lastErr
			case <-time.After(wait):
			}
		}
		up, err := checkOnce(ctx)
		if err == nil {
			if attempt > 0 {
				appendUpdateLog("check succeeded after %d attempts", attempt+1)
			}
			return up, nil
		}
		lastErr = err
		appendUpdateLog("check attempt %d/%d failed: %v", attempt+1, len(backoff), err)
		// 构建未启用更新这类错误重试没有意义。
		if errors.Is(err, mygo.ErrUpdatesDisabled) || ctx.Err() != nil {
			return nil, err
		}
	}
	return nil, lastErr
}

// CheckUpdate 检查是否有新版本。未启用更新的构建直接返回 enabled=false。
func (c *Cinema) CheckUpdate(ctx context.Context) (UpdateInfo, error) {
	info := UpdateInfo{Enabled: mygo.Updater.Enabled(), Current: currentVersion()}
	if !info.Enabled {
		return info, nil
	}
	// 检查更新是用户点出来的动作：给足 45s（含重试），别让首跳 EOF 直接报错。
	if _, ok := ctx.Deadline(); !ok {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, 45*time.Second)
		defer cancel()
	}
	up, err := checkWithRetry(ctx)
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
	var err error
	for attempt := 0; attempt < 3; attempt++ {
		if attempt > 0 {
			select {
			case <-ctx.Done():
				return err
			case <-time.After(time.Duration(attempt) * 3 * time.Second):
			}
		}
		if err = up.Install(ctx, nil); err == nil {
			appendUpdateLog("installed %s", up.Version)
			return nil
		}
		appendUpdateLog("install %s attempt %d/3 failed: %v", up.Version, attempt+1, err)
	}
	return err
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
	up, err := checkWithRetry(ctx)
	if err != nil {
		appendUpdateLog("auto-update: %v", err)
		return
	}
	if up == nil {
		appendUpdateLog("auto-update: already the latest (%s)", currentVersion())
		return
	}
	if err := up.Install(ctx, nil); err != nil {
		appendUpdateLog("auto-update: install %s failed: %v", up.Version, err)
		return
	}
	appendUpdateLog("auto-update: installed %s, relaunching", up.Version)
	mygo.App.Relaunch()
}

//go:build !linux && !windows

package main

// ==================== 显示器亮度（非 Linux 平台占位） ====================
// Windows 端原 Electron 实现走 WMI / DDC（koffi FFI）。移植到纯 Go 需要 WMI COM 绑定
// 或调用 PowerShell，属阶段二工作。这里如实返回「不可用 + 原因」，界面显示原因而不是假滑块，
// 与原「不可用必须给原因」的约定一致。

func listDisplays() []DisplayBrightness {
	return []DisplayBrightness{{
		ID: "none", Label: "显示器", Available: false,
		Reason: "当前平台亮度控制尚未移植到 Go 后端（阶段二：Windows WMI / DDC）",
	}}
}

func setDisplayBrightness(id string, value float64) BrightnessWriteResult {
	return BrightnessWriteResult{OK: false, Reason: "当前平台亮度控制尚未移植到 Go 后端"}
}

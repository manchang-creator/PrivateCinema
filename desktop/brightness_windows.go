//go:build windows

package main

// ==================== 显示器亮度（Windows，移植自 windows/src/main/brightness.ts） ====================
// 走 DXVA2 的物理显示器 API 读写 DDC/CI 亮度（VCP 代码 0x10，API 内部固定，无需传参）。
// 与 TS 版保持一致的三条约束：
//   1. koffi.errno()/syscall 的自动 LastError 都不是可靠来源 —— 必须显式调 GetLastError()。
//   2. LastError 在成功调用后仍是陈旧值 —— 只在返回值表示失败时读，且读前先 SetLastError(0)。
//   3. HMONITOR / hPhysicalMonitor 是句柄（64 位下 8 字节），用 syscall.Handle 承载，不可当数字用。
//
// 纯 Go + golang.org/x/sys/windows + syscall，不使用 cgo：Windows 交叉编译即可验证。

import (
	"fmt"
	"math"
	"sync"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

// ==================== 纯逻辑（可单测） ====================

// describeWin32Error Win32 错误码 → 面向用户的中文说明（照抄 brightness.ts）。
func describeWin32Error(code uint32) string {
	switch code {
	case 0:
		return "调用失败但没有返回错误码"
	case 5: // ERROR_ACCESS_DENIED
		return "没有权限控制该显示器的亮度"
	case 1168: // ERROR_NOT_FOUND
		return "未找到物理显示器：显示器不支持 DDC/CI，或在设备管理器中被禁用"
	case 1461: // ERROR_INVALID_MONITOR_HANDLE
		return "显示器句柄无效（显示器可能已断开）"
	default:
		return fmt.Sprintf("Win32 错误 %d", code)
	}
}

// clampBrightness 把请求亮度收敛到显示器支持的整数刻度。
// 不处理 NaN —— 非有限值属于调用方错误，由 setDisplayBrightness 显式拒绝，不在这里静默兜底。
func clampBrightness(value float64, min, max uint32) uint32 {
	r := math.Round(value)
	if r < float64(min) {
		return min
	}
	if r > float64(max) {
		return max
	}
	return uint32(r)
}

// ==================== Win32 结构体 ====================

// RECT 与 Win32 RECT 内存布局一致（4 个 int32）。
type RECT struct {
	Left   int32
	Top    int32
	Right  int32
	Bottom int32
}

// MONITORINFOEXW 对应同名 Win32 结构（CCHDEVICENAME = 32）。
type MONITORINFOEXW struct {
	CbSize    uint32
	RcMonitor RECT
	RcWork    RECT
	DwFlags   uint32
	SzDevice  [32]uint16
}

// PHYSICAL_MONITOR 对应同名 Win32 结构（szPhysicalMonitorDescription[128]）。
type PHYSICAL_MONITOR struct {
	HPhysicalMonitor             syscall.Handle
	SzPhysicalMonitorDescription [128]uint16
}

// ==================== 惰性 FFI 绑定 ====================

var (
	user32   = windows.NewLazySystemDLL("user32.dll")
	dxva2    = windows.NewLazySystemDLL("dxva2.dll")
	kernel32 = windows.NewLazySystemDLL("kernel32.dll")

	procEnumDisplayMonitors         = user32.NewProc("EnumDisplayMonitors")
	procGetMonitorInfoW             = user32.NewProc("GetMonitorInfoW")
	procGetNumberOfPhysicalMonitors = dxva2.NewProc("GetNumberOfPhysicalMonitorsFromHMONITOR")
	procGetPhysicalMonitors         = dxva2.NewProc("GetPhysicalMonitorsFromHMONITOR")
	procGetMonitorBrightness        = dxva2.NewProc("GetMonitorBrightness")
	procSetMonitorBrightness        = dxva2.NewProc("SetMonitorBrightness")
	procDestroyPhysicalMonitors     = dxva2.NewProc("DestroyPhysicalMonitors")
	procGetLastError                = kernel32.NewProc("GetLastError")
	procSetLastError                = kernel32.NewProc("SetLastError")
)

// getLastError 显式读取当前线程的 Win32 LastError。
func getLastError() uint32 {
	r1, _, _ := procGetLastError.Call()
	return uint32(r1)
}

// setLastError 显式清零 LastError，保证失败分支读到的是本次调用的新值。
func setLastError(code uint32) {
	procSetLastError.Call(uintptr(code))
}

// ==================== 枚举 ====================

// monitorHandle 一台逻辑显示器（HMONITOR）。
type monitorHandle struct {
	handle  syscall.Handle
	device  string
	primary bool
}

// enumAccum / enumMu 用于把回调结果汇集回调用方。
// syscall.NewCallback 注册的回调无法像 koffi 那样 unregister，因此回调只创建一次，
// 复用同一个收集目标；用互斥锁串行化并发枚举，避免数据竞争。
var (
	enumMu    sync.Mutex
	enumAccum *[]monitorHandle
)

// enumCallback 是 MonitorEnumProc：BOOL CALLBACK(HMONITOR, HDC, LPRECT, LPARAM)。
// 返回 1 继续枚举。
var enumCallback = syscall.NewCallback(func(hMonitor, hdc, lprc, lParam uintptr) uintptr {
	var info MONITORINFOEXW
	info.CbSize = uint32(unsafe.Sizeof(info))
	r1, _, _ := procGetMonitorInfoW.Call(hMonitor, uintptr(unsafe.Pointer(&info)))
	if r1 != 0 {
		if enumAccum != nil {
			*enumAccum = append(*enumAccum, monitorHandle{
				handle:  syscall.Handle(hMonitor),
				device:  windows.UTF16ToString(info.SzDevice[:]),
				primary: info.DwFlags&1 != 0,
			})
		}
	}
	return 1
})

// enumerateMonitors 枚举所有逻辑显示器。回调退出后 HMONITOR 依然有效（与 TS 版一致）。
func enumerateMonitors() []monitorHandle {
	enumMu.Lock()
	defer enumMu.Unlock()

	found := make([]monitorHandle, 0, 4)
	enumAccum = &found
	defer func() { enumAccum = nil }()

	procEnumDisplayMonitors.Call(0, 0, enumCallback, 0)
	return found
}

// ==================== 物理显示器 ====================

// openPhysicalMonitors 打开一台显示器下的物理显示器列表；失败返回中文原因。
// 调用方负责 destroyPhysicalMonitors。
func openPhysicalMonitors(handle syscall.Handle) ([]PHYSICAL_MONITOR, string) {
	var count uint32
	setLastError(0)
	if r1, _, _ := procGetNumberOfPhysicalMonitors.Call(uintptr(handle), uintptr(unsafe.Pointer(&count))); r1 == 0 {
		return nil, describeWin32Error(getLastError())
	}
	if count == 0 {
		return nil, "该显示器没有暴露物理显示器接口"
	}

	monitors := make([]PHYSICAL_MONITOR, count)
	setLastError(0)
	if r1, _, _ := procGetPhysicalMonitors.Call(uintptr(handle), uintptr(count), uintptr(unsafe.Pointer(&monitors[0]))); r1 == 0 {
		return nil, describeWin32Error(getLastError())
	}
	return monitors, ""
}

// destroyPhysicalMonitors 释放物理显示器句柄。
func destroyPhysicalMonitors(monitors []PHYSICAL_MONITOR) {
	if len(monitors) == 0 {
		return
	}
	procDestroyPhysicalMonitors.Call(uintptr(len(monitors)), uintptr(unsafe.Pointer(&monitors[0])))
}

// readBrightness 读取一台显示器下第一个能报出亮度的物理显示器。
func readBrightness(base DisplayBrightness, monitors []PHYSICAL_MONITOR) DisplayBrightness {
	var firstErr uint32
	for i := range monitors {
		var min, current, max uint32
		setLastError(0)
		r1, _, _ := procGetMonitorBrightness.Call(
			uintptr(monitors[i].HPhysicalMonitor),
			uintptr(unsafe.Pointer(&min)),
			uintptr(unsafe.Pointer(&current)),
			uintptr(unsafe.Pointer(&max)),
		)
		if r1 != 0 {
			// 范围退化 = 硬件不支持调光。若照常返回会让渲染层拿到一个 min === max 的死滑块，
			// 用户拖动毫无反应 —— 宁可明确说不可调。
			if max <= min {
				base.Available = false
				base.Reason = "该显示器不支持亮度调节"
				return base
			}
			if desc := windows.UTF16ToString(monitors[i].SzPhysicalMonitorDescription[:]); desc != "" {
				base.Label = desc
			}
			base.Available = true
			base.Current = float64(current)
			base.Min = float64(min)
			base.Max = float64(max)
			return base
		}
		if firstErr == 0 {
			firstErr = getLastError()
		}
	}
	base.Available = false
	base.Reason = describeWin32Error(firstErr)
	return base
}

// ==================== 对外接口 ====================

// listDisplays 列出所有显示器的亮度状态，不可用的也列出来并带原因。
func listDisplays() []DisplayBrightness {
	monitors := enumerateMonitors()
	out := make([]DisplayBrightness, 0, len(monitors))
	for _, monitor := range monitors {
		base := DisplayBrightness{ID: monitor.device, Label: monitor.device, Primary: monitor.primary}
		physicals, reason := openPhysicalMonitors(monitor.handle)
		if reason != "" {
			base.Available = false
			base.Reason = reason
			out = append(out, base)
			continue
		}
		result := readBrightness(base, physicals)
		destroyPhysicalMonitors(physicals)
		out = append(out, result)
	}
	return out
}

// setDisplayBrightness 设置某台显示器的亮度；值会被收敛到该显示器支持的范围。
func setDisplayBrightness(id string, value float64) BrightnessWriteResult {
	if math.IsNaN(value) || math.IsInf(value, 0) {
		return BrightnessWriteResult{OK: false, Reason: "亮度值必须是有限数字"}
	}

	monitors := enumerateMonitors()
	var target *monitorHandle
	for i := range monitors {
		if monitors[i].device == id {
			target = &monitors[i]
			break
		}
	}
	if target == nil {
		return BrightnessWriteResult{OK: false, Reason: fmt.Sprintf("未找到显示器 %s（可能已断开）", id)}
	}

	physicals, reason := openPhysicalMonitors(target.handle)
	if reason != "" {
		return BrightnessWriteResult{OK: false, Reason: reason}
	}
	defer destroyPhysicalMonitors(physicals)
	if len(physicals) == 0 {
		return BrightnessWriteResult{OK: false, Reason: "该显示器没有暴露物理显示器接口"}
	}

	// 先读范围再写：不同显示器刻度不同（常见 0-100，也有 0-255），必须按实测范围收敛。
	var min, current, max uint32
	setLastError(0)
	r1, _, _ := procGetMonitorBrightness.Call(
		uintptr(physicals[0].HPhysicalMonitor),
		uintptr(unsafe.Pointer(&min)),
		uintptr(unsafe.Pointer(&current)),
		uintptr(unsafe.Pointer(&max)),
	)
	if r1 == 0 {
		return BrightnessWriteResult{OK: false, Reason: describeWin32Error(getLastError())}
	}
	if max <= min {
		return BrightnessWriteResult{OK: false, Reason: "该显示器不支持亮度调节"}
	}

	setLastError(0)
	targetValue := clampBrightness(value, min, max)
	if r2, _, _ := procSetMonitorBrightness.Call(uintptr(physicals[0].HPhysicalMonitor), uintptr(targetValue)); r2 == 0 {
		return BrightnessWriteResult{OK: false, Reason: describeWin32Error(getLastError())}
	}
	return BrightnessWriteResult{OK: true}
}

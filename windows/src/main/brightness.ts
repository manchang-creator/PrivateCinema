// ==================== 显示器亮度 ====================
// 经 DXVA2 的物理显示器 API 读写 DDC/CI 亮度（VCP 代码 0x10，API 内部固定，无需传参）。
//
// 为什么没有 WMI 分支：本机 `root\wmi` 下 WmiMonitorBrightness / WmiMonitorBrightnessMethods
// 整个类都不存在（实测「不支持」），COM 经 koffi 还要自建 IDispatch，收益远低于风险。
// DXVA2 这条路径对内外屏一视同仁：能控制就给范围，不能控制就如实返回原因，不做假。
//
// 三条实测约束（改动前务必回看，全部踩过坑）：
// 1. `koffi.errno()` 恒为 0，不是 Win32 LastError —— 必须显式调 GetLastError()。
// 2. LastError 在成功调用后仍是陈旧值 —— 只在返回值表示失败时读，且读前先 SetLastError(0)。
// 3. HMONITOR / hPhysicalMonitor 是 BigInt —— 不可当 number 用，不可 JSON.stringify。

import koffi from 'koffi'
import type { BrightnessWriteResult, DisplayBrightness } from '@shared/ipc'

// ==================== 纯逻辑（可单测） ====================

/** Win32 错误码 → 面向用户的中文说明。 */
export function describeWin32Error(code: number): string {
  switch (code) {
    case 0:
      return '调用失败但没有返回错误码'
    case 5: // ERROR_ACCESS_DENIED
      return '没有权限控制该显示器的亮度'
    case 1168: // ERROR_NOT_FOUND
      return '未找到物理显示器：显示器不支持 DDC/CI，或在设备管理器中被禁用'
    case 1461: // ERROR_INVALID_HANDLE
      return '显示器句柄无效（显示器可能已断开）'
    default:
      return `Win32 错误 ${code}`
  }
}

/**
 * 把请求亮度收敛到显示器支持的整数刻度。
 * 不处理 NaN —— 非有限值属于调用方错误，由 IPC 边界显式拒绝，不在这里静默兜底。
 */
export function clampBrightness(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)))
}

// ==================== FFI 绑定（惰性） ====================
// 惰性初始化：只 import 上面的纯函数不应加载 dxva2.dll；非 Windows 平台只在真正
// 调用时才报错，而不是 import 阶段就崩。

interface PhysicalMonitor {
  hPhysicalMonitor: unknown
  szPhysicalMonitorDescription: string
}

interface MonitorHandle {
  /** HMONITOR。回调退出后依然有效（实测确认），因此可以先收集、后使用。 */
  handle: unknown
  device: string
  primary: boolean
}

function createFfi() {
  if (process.platform !== 'win32') {
    throw new Error('显示器亮度控制仅支持 Windows')
  }

  const user32 = koffi.load('user32.dll')
  const dxva2 = koffi.load('dxva2.dll')
  const kernel32 = koffi.load('kernel32.dll')

  // 匿名类型（name 传 null）：vitest 可能对同一模块求值多次，具名类型会撞
  // 「Duplicate type name」。匿名类型没有全局名字，重复构建安全。
  const RECT = koffi.struct(null, {
    left: 'int32_t',
    top: 'int32_t',
    right: 'int32_t',
    bottom: 'int32_t',
  })
  const MONITORINFOEXW = koffi.struct(null, {
    cbSize: 'uint32_t',
    rcMonitor: RECT,
    rcWork: RECT,
    dwFlags: 'uint32_t',
    szDevice: koffi.array('char16_t', 32, 'String'),
  })
  const PHYSICAL_MONITOR = koffi.struct(null, {
    hPhysicalMonitor: 'void *',
    szPhysicalMonitorDescription: koffi.array('char16_t', 128, 'String'),
  })
  // MonitorEnumProc: BOOL CALLBACK(HMONITOR, HDC, LPRECT, LPARAM)
  const MONITOR_ENUM_PROC = koffi.proto(null, 'bool', ['void *', 'void *', 'void *', 'void *'])

  return {
    monitorInfoSize: koffi.sizeof(MONITORINFOEXW),
    physicalMonitorSize: koffi.sizeof(PHYSICAL_MONITOR),
    monitorInfoType: MONITORINFOEXW,
    physicalMonitorType: PHYSICAL_MONITOR,
    /** 回调指针类型：`koffi.register` 要求指针，实测传原型本体报「expected <callback> * type」。 */
    enumProcType: koffi.pointer(MONITOR_ENUM_PROC),

    enumDisplayMonitors: user32.func('__stdcall', 'EnumDisplayMonitors', 'bool', [
      'void *',
      'void *',
      koffi.pointer(MONITOR_ENUM_PROC),
      'void *',
    ]),
    getMonitorInfo: user32.func('bool __stdcall GetMonitorInfoW(void *h, _Inout_ void *mi)'),

    getPhysicalCount: dxva2.func(
      'bool __stdcall GetNumberOfPhysicalMonitorsFromHMONITOR(void *h, _Out_ uint32_t *n)',
    ),
    getPhysicalMonitors: dxva2.func(
      'bool __stdcall GetPhysicalMonitorsFromHMONITOR(void *h, uint32_t n, _Out_ void *arr)',
    ),
    getBrightness: dxva2.func(
      'bool __stdcall GetMonitorBrightness(void *h, _Out_ uint32_t*, _Out_ uint32_t*, _Out_ uint32_t*)',
    ),
    setBrightness: dxva2.func('bool __stdcall SetMonitorBrightness(void *h, uint32_t)'),
    destroyPhysicalMonitors: dxva2.func('bool __stdcall DestroyPhysicalMonitors(uint32_t, void*)'),

    getLastError: kernel32.func('uint32_t __stdcall GetLastError()'),
    setLastError: kernel32.func('void __stdcall SetLastError(uint32_t)'),
  }
}

type Ffi = ReturnType<typeof createFfi>

let ffi: Ffi | null = null

function api(): Ffi {
  ffi ??= createFfi()
  return ffi
}

// ==================== 枚举 ====================

function enumerateMonitors(bindings: Ffi): MonitorHandle[] {
  const found: MonitorHandle[] = []
  const callback = koffi.register((handle: unknown) => {
    const info = Buffer.alloc(bindings.monitorInfoSize)
    info.writeUInt32LE(bindings.monitorInfoSize, 0)
    if (bindings.getMonitorInfo(handle, info)) {
      const decoded = koffi.decode(info, bindings.monitorInfoType) as {
        szDevice: string
        dwFlags: number
      }
      found.push({
        handle,
        device: decoded.szDevice,
        primary: (decoded.dwFlags & 1) !== 0,
      })
    }
    return true
  }, bindings.enumProcType)

  try {
    bindings.enumDisplayMonitors(null, null, callback, null)
  } finally {
    koffi.unregister(callback)
  }
  return found
}

/** 打开一台显示器下的物理显示器列表；失败返回原因。调用方负责 destroy。 */
function openPhysicalMonitors(
  bindings: Ffi,
  monitor: MonitorHandle,
): { buffer: Buffer; count: number } | { reason: string } {
  const count = [0]
  bindings.setLastError(0)
  if (!bindings.getPhysicalCount(monitor.handle, count)) {
    return { reason: describeWin32Error(bindings.getLastError() as number) }
  }
  if (count[0] === 0) {
    return { reason: '该显示器没有暴露物理显示器接口' }
  }

  const buffer = Buffer.alloc(bindings.physicalMonitorSize * count[0])
  bindings.setLastError(0)
  if (!bindings.getPhysicalMonitors(monitor.handle, count[0], buffer)) {
    return { reason: describeWin32Error(bindings.getLastError() as number) }
  }
  return { buffer, count: count[0] }
}

function decodePhysicalMonitors(bindings: Ffi, buffer: Buffer, count: number): PhysicalMonitor[] {
  return koffi.decode(buffer, bindings.physicalMonitorType, count) as PhysicalMonitor[]
}

/** 读取一台显示器下第一个能报出亮度的物理显示器。 */
function readBrightness(
  bindings: Ffi,
  base: { id: string; label: string; primary: boolean },
  list: PhysicalMonitor[],
): DisplayBrightness {
  let firstError = 0
  for (const physical of list) {
    const min = [0]
    const current = [0]
    const max = [0]
    bindings.setLastError(0)
    if (bindings.getBrightness(physical.hPhysicalMonitor, min, current, max)) {
      // 范围退化 = 硬件不支持调光。若照常返回，渲染层会拿到一个 min === max 的
      // 死滑块，用户拖动却毫无反应 —— 宁可明确说不可调。
      if (max[0] <= min[0]) {
        return { ...base, available: false, reason: '该显示器不支持亮度调节' }
      }
      return {
        ...base,
        label: physical.szPhysicalMonitorDescription === '' ? base.label : physical.szPhysicalMonitorDescription,
        available: true,
        current: current[0],
        min: min[0],
        max: max[0],
      }
    }
    if (firstError === 0) firstError = bindings.getLastError() as number
  }
  return { ...base, available: false, reason: describeWin32Error(firstError) }
}

// ==================== 对外接口 ====================

/** 列出所有显示器的亮度状态，不可用的也列出来并带原因。 */
export function listDisplays(): DisplayBrightness[] {
  const bindings = api()
  return enumerateMonitors(bindings).map((monitor) => {
    const base = { id: monitor.device, label: monitor.device, primary: monitor.primary }
    const opened = openPhysicalMonitors(bindings, monitor)
    if ('reason' in opened) return { ...base, available: false, reason: opened.reason }

    try {
      return readBrightness(
        bindings,
        base,
        decodePhysicalMonitors(bindings, opened.buffer, opened.count),
      )
    } finally {
      bindings.destroyPhysicalMonitors(opened.count, opened.buffer)
    }
  })
}

/** 设置某台显示器的亮度；值会被收敛到该显示器支持的范围。 */
export function setDisplayBrightness(id: string, value: number): BrightnessWriteResult {
  if (!Number.isFinite(value)) {
    return { ok: false, reason: '亮度值必须是有限数字' }
  }

  const bindings = api()
  const monitor = enumerateMonitors(bindings).find((item) => item.device === id)
  if (monitor === undefined) {
    return { ok: false, reason: `未找到显示器 ${id}（可能已断开）` }
  }

  const opened = openPhysicalMonitors(bindings, monitor)
  if ('reason' in opened) return { ok: false, reason: opened.reason }

  try {
    const [physical] = decodePhysicalMonitors(bindings, opened.buffer, opened.count)
    if (physical === undefined) {
      return { ok: false, reason: '该显示器没有暴露物理显示器接口' }
    }

    // 先读范围再写：不同显示器刻度不同（常见 0-100，也有 0-255），必须按实测范围收敛。
    const min = [0]
    const current = [0]
    const max = [0]
    bindings.setLastError(0)
    if (!bindings.getBrightness(physical.hPhysicalMonitor, min, current, max)) {
      return { ok: false, reason: describeWin32Error(bindings.getLastError() as number) }
    }
    if (max[0] <= min[0]) {
      return { ok: false, reason: '该显示器不支持亮度调节' }
    }

    bindings.setLastError(0)
    if (!bindings.setBrightness(physical.hPhysicalMonitor, clampBrightness(value, min[0], max[0]))) {
      return { ok: false, reason: describeWin32Error(bindings.getLastError() as number) }
    }
    return { ok: true }
  } finally {
    bindings.destroyPhysicalMonitors(opened.count, opened.buffer)
  }
}

// ==================== 显示器亮度（Linux） ====================
// 两条后端，按「能控制就给范围，不能控制就如实返回原因」的原则合流：
//
// 1. sysfs（`/sys/class/backlight/*`）：内核背光驱动的标准接口，覆盖笔记本内置屏与部分
//    独显直连的 eDP 面板。纯 fs 读写，无外部依赖。
// 2. DDC/CI（`ddcutil` CLI）：外接显示器走 I2C 总线上的 MCCS 协议。需要用户安装 ddcutil，
//    且内核 i2c-dev 可用；权限不足时 ddcutil 会报权限原因，原样透传给用户。
//
// 为什么 sysfs 优先：它不需要子进程、单次写入微秒级，且 sysfs 里 `brightness` 的
// 写入语义就是「硬件已接受」。ddcutil 每次调用要 100ms 起步，只在 sysfs 覆盖不到的外接屏上用。
//
// 已知约束（改之前必须回看）：
// - sysfs 的 `max_brightness` 是只读刻度上限；范围恒为 `actual_brightness` 的
//   0..max。有驱动把 `actual_brightness` 报成陈旧值，因此枚举时读 `brightness`（请求值）。
// - `bl_power`（DPMS）与亮度是两件事，这里不碰。
// - 写入必须节流：ddcutil 单次往返上百毫秒，逐次直发会让主进程被阻塞。节流在渲染层做。

import { execFile } from 'node:child_process'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import type { BrightnessWriteResult, DisplayBrightness } from '@private-cinema/core/shared'

const BACKLIGHT_ROOT = '/sys/class/backlight'

// ==================== 纯逻辑（可单测） ====================

/** 把请求亮度收敛到显示器支持的整数刻度。 */
export function clampBrightness(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)))
}

/**
 * 解析 `ddcutil detect` 的输出，取出每一路显示器。
 * 只取 `Display N` 块里的 `I2C bus:` 与 `Monitor:` 型号行 —— 其余字段随版本变化，不作依赖。
 */
export function parseDdcutilDetect(output: string): { bus: number; label: string }[] {
  const displays: { bus: number; label: string }[] = []
  let bus = -1
  let label = ''

  const flush = (): void => {
    if (bus >= 0) displays.push({ bus, label: label === '' ? `总线 ${bus}` : label })
    bus = -1
    label = ''
  }

  for (const line of output.split('\n')) {
    const trimmed = line.trim()
    if (/^Display \d+/.test(trimmed)) {
      flush()
      continue
    }
    const busMatch = /^I2C bus:\s*\/dev\/i2c-(\d+)/.exec(trimmed)
    if (busMatch !== null) {
      bus = Number.parseInt(busMatch[1], 10)
      continue
    }
    const monitorMatch = /^Monitor:\s*(.+)$/.exec(trimmed)
    if (monitorMatch !== null) label = monitorMatch[1].trim()
  }
  flush()
  return displays
}

/** ddcutil 失败输出 → 面向用户的中文说明。原文保留在尾部，便于排查。 */
export function describeDdcutilError(stderr: string, attempted: boolean): string {
  if (!attempted) return '未安装 ddcutil，无法控制外接显示器亮度'
  if (/permission denied|i2c.*open|Display Exception/i.test(stderr)) {
    return '没有权限访问 I2C 总线：需要把当前用户加入 i2c 组，或配置 udev 规则'
  }
  if (/No displays found/i.test(stderr)) return '未检测到支持 DDC/CI 的显示器'
  const detail = stderr.trim().split('\n').slice(-1)[0] ?? ''
  return detail === '' ? 'ddcutil 调用失败' : `ddcutil 调用失败：${detail}`
}

// ==================== 后端：sysfs ====================

/** 读取 sysfs 背光设备列表与当前刻度。读失败的设备直接跳过 —— 它们本来就不受控。 */
export async function listSysfsBacklights(): Promise<DisplayBrightness[]> {
  let entries: string[]
  try {
    entries = await readdir(BACKLIGHT_ROOT)
  } catch {
    return []
  }

  const results: DisplayBrightness[] = []
  for (const name of entries.sort()) {
    const dir = `${BACKLIGHT_ROOT}/${name}`
    const id = `sysfs:${name}`
    try {
      const [rawMax, rawCurrent, rawType] = await Promise.all([
        readFile(`${dir}/max_brightness`, 'utf8'),
        readFile(`${dir}/brightness`, 'utf8'),
        readFile(`${dir}/type`, 'utf8').catch(() => ''),
      ])
      const max = Number.parseInt(rawMax.trim(), 10)
      const current = Number.parseInt(rawCurrent.trim(), 10)
      if (!Number.isFinite(max) || !Number.isFinite(current) || max <= 0) {
        results.push({ id, label: name, primary: false, available: false, reason: '背光刻度异常' })
        continue
      }
      const type = rawType.trim()
      results.push({
        id,
        label: type === '' ? name : `${name}（${type}）`,
        // `type=raw` 一般是面板原始寄存器背光（如 nvidia_0），对应用内置屏；
        // 用「是否 raw」当作主屏判定是没有更好依据时的诚实近似。
        primary: type === 'raw',
        available: true,
        current,
        min: 0,
        max,
      })
    } catch {
      results.push({ id, label: name, primary: false, available: false, reason: '背光设备不可读' })
    }
  }
  return results
}

/**
 * 写入 sysfs 时用的名字。`node:path` 没有提供 shell 转义，所以这里只做「是不是一个裸设备名」的校验：
 * 设备名来自 `readdir('/sys/class/backlight')`，不该含路径分隔符或点前缀。
 */
function isPlainBacklightName(name: string): boolean {
  return name !== '' && !name.startsWith('.') && !name.includes('/') && !name.includes('\\')
}

async function setSysfsBrightness(name: string, value: number): Promise<BrightnessWriteResult> {
  if (!isPlainBacklightName(name)) return { ok: false, reason: `非法背光设备名 ${name}` }
  const dir = `${BACKLIGHT_ROOT}/${name}`
  try {
    const rawMax = await readFile(`${dir}/max_brightness`, 'utf8')
    const max = Number.parseInt(rawMax.trim(), 10)
    if (!Number.isFinite(max) || max <= 0) {
      return { ok: false, reason: '背光刻度异常，无法设置亮度' }
    }
    const target = clampBrightness(value, 0, max)
    await writeFile(`${dir}/brightness`, String(target), 'utf8')
    return { ok: true }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'EACCES' || code === 'EPERM') {
      return { ok: false, reason: '没有权限写入背光设备：请检查 udev 规则或文件权限' }
    }
    if (code === 'ENOENT') {
      return { ok: false, reason: '背光设备已消失（显示器可能已断开）' }
    }
    return { ok: false, reason: `写入背光失败：${(error as Error).message}` }
  }
}

// ==================== 后端：ddcutil ====================

function runDdcutil(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile('ddcutil', args, { timeout: 8000 }, (error, stdout, stderr) => {
      const code = error === null ? 0 : ((error as NodeJS.ErrnoException).code === 'ENOENT' ? -1 : 1)
      resolve({ code, stdout: stdout ?? '', stderr: stderr ?? '' })
    })
  })
}

/** 枚举 DDC/CI 显示器。ddcutil 缺失或调用失败都返回空表 —— 原因在 `ddcutilStatus` 里。 */
async function listDdcutilDisplays(): Promise<{ displays: DisplayBrightness[]; reason: string | null }> {
  const detect = await runDdcutil(['detect', '--brief'])
  if (detect.code === -1) return { displays: [], reason: describeDdcutilError('', false) }
  if (detect.code !== 0) {
    return { displays: [], reason: describeDdcutilError(detect.stderr, true) }
  }

  const found = parseDdcutilDetect(detect.stdout)
  const displays: DisplayBrightness[] = []
  for (const item of found) {
    const id = `ddc:${item.bus}`
    const read = await runDdcutil(['getvcp', '10', '--brief', '--bus', String(item.bus)])
    if (read.code !== 0) {
      displays.push({
        id,
        label: item.label,
        primary: false,
        available: false,
        reason: describeDdcutilError(read.stderr, true),
      })
      continue
    }
    const values = parseDdcutilVcp(read.stdout)
    if (values === null) {
      displays.push({
        id,
        label: item.label,
        primary: false,
        available: false,
        reason: '该显示器不支持亮度（VCP 0x10）',
      })
      continue
    }
    if (values.max <= values.min) {
      displays.push({ id, label: item.label, primary: false, available: false, reason: '该显示器不支持亮度调节' })
      continue
    }
    displays.push({
      id,
      label: item.label,
      primary: false,
      available: true,
      current: values.current,
      min: values.min,
      max: values.max,
    })
  }
  return { displays, reason: null }
}

/** `VCP 10 C 50 100`（--brief）→ 当前值 / 上限。 */
export function parseDdcutilVcp(output: string): { current: number; max: number; min: number } | null {
  const match = /VCP\s+10\s+C\s+(\d+)\s+(\d+)/i.exec(output)
  if (match === null) return null
  const current = Number.parseInt(match[1], 10)
  const max = Number.parseInt(match[2], 10)
  if (!Number.isFinite(current) || !Number.isFinite(max)) return null
  return { current, max, min: 0 }
}

async function setDdcutilBrightness(bus: number, value: number): Promise<BrightnessWriteResult> {
  const read = await runDdcutil(['getvcp', '10', '--brief', '--bus', String(bus)])
  if (read.code !== 0) return { ok: false, reason: describeDdcutilError(read.stderr, true) }
  const range = parseDdcutilVcp(read.stdout)
  if (range === null) return { ok: false, reason: '该显示器不支持亮度（VCP 0x10）' }
  if (range.max <= range.min) return { ok: false, reason: '该显示器不支持亮度调节' }

  const target = clampBrightness(value, range.min, range.max)
  const write = await runDdcutil(['setvcp', '10', String(target), '--bus', String(bus)])
  if (write.code !== 0) return { ok: false, reason: describeDdcutilError(write.stderr, true) }
  return { ok: true }
}

// ==================== 对外接口 ====================

/**
 * 列出所有能控制的显示器。
 * sysfs 覆盖内置屏，ddcutil 覆盖外接屏；两者都为空时返回一条带原因的占位记录，
 * 让界面能说清「为什么没有滑块」而不是显示空面板。
 */
export async function listDisplays(): Promise<DisplayBrightness[]> {
  const sysfs = await listSysfsBacklights()
  const ddc = await listDdcutilDisplays()
  const all = [...sysfs, ...ddc.displays]
  if (all.length > 0) return all
  return [
    {
      id: 'none',
      label: '显示器',
      primary: false,
      available: false,
      reason: ddc.reason ?? '未找到可控制的显示器（sysfs 无背光设备，且未检测到 DDC/CI 显示器）',
    },
  ]
}

/** 设置亮度。`id` 形如 `sysfs:nvidia_0` 或 `ddc:4`，由 `listDisplays` 给出。 */
export async function setDisplayBrightness(id: string, value: number): Promise<BrightnessWriteResult> {
  if (!Number.isFinite(value)) return { ok: false, reason: '亮度值必须是有限数字' }

  const [kind, key] = id.split(':', 2)
  if (kind === 'sysfs' && key !== undefined && key !== '') {
    return setSysfsBrightness(key, value)
  }
  if (kind === 'ddc' && key !== undefined && key !== '') {
    const bus = Number.parseInt(key, 10)
    if (!Number.isFinite(bus)) return { ok: false, reason: `非法显示器标识 ${id}` }
    return setDdcutilBrightness(bus, value)
  }
  if (id === 'none') return { ok: false, reason: '没有可控制的显示器' }
  return { ok: false, reason: `未知显示器标识 ${id}` }
}

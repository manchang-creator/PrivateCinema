// ==================== 弹幕设置 ====================
// 与 iOS `DanmakuSettings` 同名同义：默认值与取值区间完全对齐，
// 便于两端行为一致。MVP 阶段存 localStorage（非敏感数据）。

import type { DanmakuItem } from '../shared/types'

/** 弹幕渲染快照：引擎每帧只认这一个不可变对象。 */
export interface DanmakuSnapshot {
  areaRatio: number
  opacity: number
  fontScale: number
  speedFactor: number
  allowScroll: boolean
  allowTop: boolean
  allowBottom: boolean
}

export interface DanmakuSettings extends DanmakuSnapshot {
  enabled: boolean
  blockedKeywords: string[]
}

export const DEFAULT_SETTINGS: DanmakuSettings = {
  enabled: true,
  areaRatio: 0.5,
  opacity: 1,
  fontScale: 1,
  speedFactor: 1,
  allowScroll: true,
  allowTop: true,
  allowBottom: true,
  blockedKeywords: [],
}

const STORAGE_KEY = 'danmaku.settings'

function clamp(value: number, low: number, high: number): number {
  if (!Number.isFinite(value)) return low
  return Math.min(high, Math.max(low, value))
}

/** 把任意来源的设置收敛到合法区间；非法值一律回落到默认值。 */
export function normalizeSettings(input: Partial<DanmakuSettings> | null): DanmakuSettings {
  if (input === null || typeof input !== 'object') return { ...DEFAULT_SETTINGS }
  return {
    enabled: typeof input.enabled === 'boolean' ? input.enabled : DEFAULT_SETTINGS.enabled,
    areaRatio: clamp(input.areaRatio ?? DEFAULT_SETTINGS.areaRatio, 0.25, 1),
    opacity: clamp(input.opacity ?? DEFAULT_SETTINGS.opacity, 0.2, 1),
    fontScale: clamp(input.fontScale ?? DEFAULT_SETTINGS.fontScale, 0.7, 1.5),
    speedFactor: clamp(input.speedFactor ?? DEFAULT_SETTINGS.speedFactor, 0.5, 2),
    allowScroll:
      typeof input.allowScroll === 'boolean' ? input.allowScroll : DEFAULT_SETTINGS.allowScroll,
    allowTop: typeof input.allowTop === 'boolean' ? input.allowTop : DEFAULT_SETTINGS.allowTop,
    allowBottom:
      typeof input.allowBottom === 'boolean' ? input.allowBottom : DEFAULT_SETTINGS.allowBottom,
    blockedKeywords: Array.isArray(input.blockedKeywords)
      ? input.blockedKeywords.filter((word): word is string => typeof word === 'string' && word !== '')
      : [],
  }
}

export function loadSettings(): DanmakuSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return { ...DEFAULT_SETTINGS }
    return normalizeSettings(JSON.parse(raw) as Partial<DanmakuSettings>)
  } catch {
    // 存储损坏或不可用：回落默认值，不让播放链路因设置读取失败而中断
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(settings: DanmakuSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
}

/** 设置 → 渲染快照。三种类型全关时引擎按「整体不可见」处理。 */
export function toSnapshot(settings: DanmakuSettings): DanmakuSnapshot {
  return {
    areaRatio: settings.areaRatio,
    opacity: settings.opacity,
    fontScale: settings.fontScale,
    speedFactor: settings.speedFactor,
    allowScroll: settings.allowScroll,
    allowTop: settings.allowTop,
    allowBottom: settings.allowBottom,
  }
}

/** 按设置过滤：关闭的类型整条丢弃，命中屏蔽词丢弃。 */
export function filterItems(items: DanmakuItem[], settings: DanmakuSettings): DanmakuItem[] {
  if (!settings.enabled) return []
  return items.filter((item) => {
    if (item.type === 'scroll' && !settings.allowScroll) return false
    if (item.type === 'top' && !settings.allowTop) return false
    if (item.type === 'bottom' && !settings.allowBottom) return false
    return !settings.blockedKeywords.some((word) => item.content.includes(word))
  })
}

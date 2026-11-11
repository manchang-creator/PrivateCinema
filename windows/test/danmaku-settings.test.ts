import { describe, expect, it } from 'vitest'
import type { DanmakuItem } from '../src/shared/types'
import {
  DEFAULT_SETTINGS,
  filterItems,
  normalizeSettings,
  toSnapshot,
  type DanmakuSettings,
} from '../src/renderer/src/danmaku/settings'

// ==================== 弹幕设置 ====================
// 重点：区间钳制与过滤语义必须与 iOS `DanmakuSettings` 一致。

function item(content: string, type: DanmakuItem['type'] = 'scroll'): DanmakuItem {
  return {
    id: content,
    mediaId: 'm1',
    episodeId: 'e1',
    time: 1,
    content,
    type,
    color: '#FFFFFF',
    userId: 'u1',
    createdAt: '2026-01-01T00:00:00.000Z',
  }
}

describe('normalizeSettings', () => {
  it('null 返回默认值', () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS)
  })

  it('缺失字段回落到默认值', () => {
    const result = normalizeSettings({ opacity: 0.5 })
    expect(result.opacity).toBe(0.5)
    expect(result.areaRatio).toBe(DEFAULT_SETTINGS.areaRatio)
    expect(result.fontScale).toBe(DEFAULT_SETTINGS.fontScale)
  })

  it('区域比例钳制到 0.25 ~ 1', () => {
    expect(normalizeSettings({ areaRatio: 0.1 }).areaRatio).toBe(0.25)
    expect(normalizeSettings({ areaRatio: 2 }).areaRatio).toBe(1)
  })

  it('不透明度钳制到 0.2 ~ 1', () => {
    expect(normalizeSettings({ opacity: 0 }).opacity).toBe(0.2)
    expect(normalizeSettings({ opacity: 5 }).opacity).toBe(1)
  })

  it('字号钳制到 0.7 ~ 1.5', () => {
    expect(normalizeSettings({ fontScale: 0.1 }).fontScale).toBe(0.7)
    expect(normalizeSettings({ fontScale: 9 }).fontScale).toBe(1.5)
  })

  it('速度钳制到 0.5 ~ 2', () => {
    expect(normalizeSettings({ speedFactor: 0.1 }).speedFactor).toBe(0.5)
    expect(normalizeSettings({ speedFactor: 9 }).speedFactor).toBe(2)
  })

  it('NaN 回落到下限而非产生 NaN', () => {
    expect(normalizeSettings({ opacity: Number.NaN }).opacity).toBe(0.2)
  })

  it('屏蔽词过滤掉空串与非字符串', () => {
    const raw = { blockedKeywords: ['广告', '', 123 as unknown as string] }
    expect(normalizeSettings(raw).blockedKeywords).toEqual(['广告'])
  })
})

describe('toSnapshot', () => {
  it('只带渲染字段，不带 enabled / 屏蔽词', () => {
    const snapshot = toSnapshot({ ...DEFAULT_SETTINGS, enabled: false, blockedKeywords: ['x'] })
    expect(snapshot).not.toHaveProperty('enabled')
    expect(snapshot).not.toHaveProperty('blockedKeywords')
  })
})

describe('filterItems', () => {
  const items = [item('滚动'), item('顶部', 'top'), item('底部', 'bottom'), item('这里有广告')]

  it('弹幕总开关关闭时全部丢弃', () => {
    expect(filterItems(items, { ...DEFAULT_SETTINGS, enabled: false })).toEqual([])
  })

  it('关闭滚动后只留顶部与底部', () => {
    const result = filterItems(items, { ...DEFAULT_SETTINGS, allowScroll: false })
    expect(result.map((entry) => entry.type).sort()).toEqual(['bottom', 'top'])
  })

  it('屏蔽词按子串匹配', () => {
    const settings: DanmakuSettings = { ...DEFAULT_SETTINGS, blockedKeywords: ['广告'] }
    expect(filterItems(items, settings).map((entry) => entry.content)).not.toContain('这里有广告')
  })

  it('默认设置保留全部', () => {
    expect(filterItems(items, DEFAULT_SETTINGS)).toHaveLength(4)
  })
})

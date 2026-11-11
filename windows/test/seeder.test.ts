import { describe, expect, it } from 'vitest'
import { hashSeed, SeededGenerator, seedDanmaku } from '../src/renderer/src/danmaku/seeder'

// ==================== 演示弹幕种子 ====================
// 关键性质：同一 episodeId 必须得到同一批弹幕（高能进度条才稳定）。

describe('SeededGenerator', () => {
  it('同一 seed 产生同一序列', () => {
    const a = new SeededGenerator(12345n)
    const b = new SeededGenerator(12345n)
    const left = Array.from({ length: 10 }, () => a.next())
    const right = Array.from({ length: 10 }, () => b.next())
    expect(left).toEqual(right)
  })

  it('不同 seed 产生不同序列', () => {
    const a = new SeededGenerator(1n)
    const b = new SeededGenerator(2n)
    expect(a.next()).not.toBe(b.next())
  })

  it('seed 为 0 时回落到固定常量，不产生全零序列', () => {
    const zero = new SeededGenerator(0n)
    expect(zero.next()).not.toBe(0n)
  })

  it('nextInt 落在 [0, bound)', () => {
    const random = new SeededGenerator(7n)
    for (let i = 0; i < 100; i += 1) {
      const value = random.nextInt(20)
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(20)
    }
  })

  it('nextFloat 落在区间内', () => {
    const random = new SeededGenerator(11n)
    for (let i = 0; i < 100; i += 1) {
      const value = random.nextFloat(-8, 8)
      expect(value).toBeGreaterThanOrEqual(-8)
      expect(value).toBeLessThan(8)
    }
  })
})

describe('hashSeed', () => {
  it('同字符串同哈希', () => {
    expect(hashSeed('episode-1')).toBe(hashSeed('episode-1'))
  })

  it('不同字符串不同哈希', () => {
    expect(hashSeed('episode-1')).not.toBe(hashSeed('episode-2'))
  })
})

describe('seedDanmaku', () => {
  it('时长不足 60 秒不生成', () => {
    expect(seedDanmaku('m1', 'e1', 60)).toEqual([])
    expect(seedDanmaku('m1', 'e1', 10)).toEqual([])
  })

  it('同一 episodeId 结果稳定', () => {
    const first = seedDanmaku('m1', 'e1', 600)
    const second = seedDanmaku('m1', 'e1', 600)
    expect(first.map((entry) => `${entry.time}:${entry.content}`)).toEqual(
      second.map((entry) => `${entry.time}:${entry.content}`),
    )
  })

  it('不同 episodeId 结果不同', () => {
    const a = seedDanmaku('m1', 'e1', 600)
    const b = seedDanmaku('m1', 'e2', 600)
    expect(a.map((entry) => entry.time)).not.toEqual(b.map((entry) => entry.time))
  })

  it('数量落在 80 ~ 160', () => {
    const items = seedDanmaku('m1', 'e1', 600)
    expect(items.length).toBeGreaterThanOrEqual(80)
    expect(items.length).toBeLessThanOrEqual(160)
  })

  it('按时间升序', () => {
    const items = seedDanmaku('m1', 'e1', 600)
    const sorted = [...items].sort((a, b) => a.time - b.time)
    expect(items).toEqual(sorted)
  })

  it('时间落在 [0, duration) 区间', () => {
    const items = seedDanmaku('m1', 'e1', 600)
    for (const entry of items) {
      expect(entry.time).toBeGreaterThanOrEqual(0)
      expect(entry.time).toBeLessThan(620)
    }
  })

  it('三种类型都会出现', () => {
    const types = new Set(seedDanmaku('m1', 'e1', 600).map((entry) => entry.type))
    expect(types.has('scroll')).toBe(true)
    expect(types.has('top')).toBe(true)
    expect(types.has('bottom')).toBe(true)
  })

  it('id 唯一', () => {
    const items = seedDanmaku('m1', 'e1', 600)
    expect(new Set(items.map((entry) => entry.id)).size).toBe(items.length)
  })
})

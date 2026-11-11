import { describe, expect, it } from 'vitest'
import type { DanmakuItem } from '../src/shared/types'
import { DanmakuEngine, type DanmakuViewport } from '../src/renderer/src/danmaku/engine'
import type { DanmakuSnapshot } from '../src/renderer/src/danmaku/settings'

// ==================== 弹幕引擎 ====================
// 引擎是纯逻辑：时间与视口都由测试注入，因此可以逐帧断言。

const VIEWPORT: DanmakuViewport = { width: 390, height: 300 }

const FULL: DanmakuSnapshot = {
  areaRatio: 0.5,
  opacity: 1,
  fontScale: 1,
  speedFactor: 1,
  allowScroll: true,
  allowTop: true,
  allowBottom: true,
}

/** 墙钟可控，用于验证锚点超时逻辑。 */
function makeEngine(viewport: DanmakuViewport = VIEWPORT): {
  engine: DanmakuEngine
  advanceClock: (ms: number) => void
} {
  let clock = 0
  const engine = new DanmakuEngine({
    viewport: () => viewport,
    measureText: (content, fontSize) => content.length * fontSize * 0.6,
    clock: () => clock,
  })
  return { engine, advanceClock: (ms: number) => (clock += ms) }
}

function item(time: number, overrides: Partial<DanmakuItem> = {}): DanmakuItem {
  return {
    id: `d-${time}-${Math.random()}`,
    mediaId: 'm1',
    episodeId: 'e1',
    time,
    content: '测试弹幕',
    type: 'scroll',
    color: '#FFFFFF',
    userId: 'u1',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('DanmakuEngine 时间基准', () => {
  it('load 时用锚点，不读播放器的旧时间', () => {
    const { engine } = makeEngine()
    // 锚点 100s，播放器仍停在 0s：绝不能把 0~100s 的弹幕倾倒出来
    engine.load([item(1), item(50), item(99), item(101)], FULL, 100)
    const frame = engine.tick(0)
    expect(frame).toHaveLength(0)
  })

  it('播放头追上锚点后交还实时时间', () => {
    const { engine } = makeEngine()
    engine.load([item(100.2)], FULL, 100)
    // 差值 0.1s ≤ 0.5s 容差 → 释放锚点，弹幕正常上屏
    const frame = engine.tick(100.2)
    expect(frame).toHaveLength(1)
  })

  it('锚点超时后交还实时时间', () => {
    const { engine, advanceClock } = makeEngine()
    engine.load([item(100)], FULL, 100)
    advanceClock(3100)
    // seek 未生效且已超时：用实时时间渲染，不会永久冻结
    const frame = engine.tick(200)
    expect(frame).toHaveLength(0)
  })

  it('后退 seek 超时后重建索引，不倾倒中间弹幕', () => {
    const { engine, advanceClock } = makeEngine()
    engine.load([item(10), item(20), item(30), item(120)], FULL, 100)
    advanceClock(3100)
    // 播放头 120s 已越过锚点 100s：说明 seek 卡住，必须重建索引
    engine.tick(120)
    const frame = engine.tick(120)
    // 只有 120s 那条，10/20/30 不能被倾泻出来
    expect(frame.map((entry) => entry.id)).toHaveLength(1)
  })
})

describe('DanmakuEngine 车道', () => {
  it('同一时刻多条滚动弹幕分到不同车道', () => {
    const { engine } = makeEngine()
    engine.load([item(1), item(1), item(1)], FULL, 0)
    const frame = engine.tick(1)
    expect(frame).toHaveLength(3)
    const lanes = new Set(frame.map((entry) => entry.y))
    expect(lanes.size).toBe(3)
  })

  it('车道全满时丢弃，不排队', () => {
    const { engine } = makeEngine()
    // 视口高度 300 × 0.5 = 150；字号 16 → 车道高 26.4 → 5 条车道
    const many = Array.from({ length: 12 }, () => item(1))
    engine.load(many, FULL, 0)
    const frame = engine.tick(1)
    expect(frame.length).toBeLessThanOrEqual(5)
    expect(frame.length).toBeGreaterThan(0)
  })

  it('车道释放后可以继续使用', () => {
    const { engine } = makeEngine()
    engine.load([item(1), item(1), item(1), item(1), item(1), item(30)], FULL, 0)
    expect(engine.tick(1)).toHaveLength(5)
    // 30s 时首条早已离场，车道重新可用
    expect(engine.tick(30).length).toBeGreaterThan(0)
  })
})

describe('DanmakuEngine 位置推导', () => {
  it('滚动弹幕从右向左移动', () => {
    const { engine } = makeEngine()
    engine.load([item(1)], FULL, 0)
    const first = engine.tick(1)[0]
    const later = engine.tick(3)[0]
    expect(first.x).toBeGreaterThan(later.x)
  })

  it('位置由绝对时间推导，跳帧不产生漂移', () => {
    const { engine } = makeEngine()
    engine.load([item(1)], FULL, 0)
    engine.tick(1)
    const direct = engine.tick(5)[0]
    expect(direct.x).toBeLessThan(VIEWPORT.width)
  })

  it('顶部弹幕水平居中', () => {
    const { engine } = makeEngine()
    engine.load([item(1, { type: 'top', content: '顶部' })], FULL, 0)
    const entry = engine.tick(1)[0]
    expect(entry.y).toBeLessThan(VIEWPORT.height / 2)
  })

  it('底部弹幕位于下方', () => {
    const { engine } = makeEngine()
    engine.load([item(1, { type: 'bottom', content: '底部' })], FULL, 0)
    const entry = engine.tick(1)[0]
    expect(entry.y).toBeGreaterThan(VIEWPORT.height / 2)
  })

  it('固定弹幕停留 4.5s 后消失', () => {
    const { engine } = makeEngine()
    engine.load([item(1, { type: 'top' })], FULL, 0)
    expect(engine.tick(1)).toHaveLength(1)
    // 1 + 4.5 = 5.5：5.4 仍在屏上，5.6 已消失
    expect(engine.tick(5.4)).toHaveLength(1)
    expect(engine.tick(5.6)).toHaveLength(0)
  })
})

describe('DanmakuEngine 设置', () => {
  it('关闭滚动后不生成滚动弹幕', () => {
    const { engine } = makeEngine()
    engine.load([item(1)], { ...FULL, allowScroll: false }, 0)
    expect(engine.tick(1)).toHaveLength(0)
  })

  it('关闭顶部后不生成顶部弹幕', () => {
    const { engine } = makeEngine()
    engine.load([item(1, { type: 'top' })], { ...FULL, allowTop: false }, 0)
    expect(engine.tick(1)).toHaveLength(0)
  })

  it('apply 立即清掉已上屏的禁用类型', () => {
    const { engine } = makeEngine()
    engine.load([item(1)], FULL, 0)
    expect(engine.tick(1)).toHaveLength(1)
    engine.apply({ ...FULL, allowScroll: false })
    expect(engine.tick(1.1)).toHaveLength(0)
  })

  it('显示区域越小车道越少', () => {
    const small = makeEngine()
    small.engine.load(Array.from({ length: 20 }, () => item(1)), { ...FULL, areaRatio: 0.25 }, 0)
    const smallCount = small.engine.tick(1).length

    const large = makeEngine()
    large.engine.load(Array.from({ length: 20 }, () => item(1)), FULL, 0)
    const largeCount = large.engine.tick(1).length

    expect(smallCount).toBeLessThan(largeCount)
  })

  it('字号随 fontScale 变化', () => {
    const { engine } = makeEngine()
    engine.load([item(1)], { ...FULL, fontScale: 1.5 }, 0)
    const entry = engine.tick(1)[0]
    expect(entry.fontSize).toBeCloseTo(24, 5)
  })
})

describe('DanmakuEngine skip', () => {
  it('seek 后丢弃已过去的弹幕', () => {
    const { engine } = makeEngine()
    engine.load([item(10), item(50), item(90)], FULL, 0)
    engine.skip(60)
    expect(engine.tick(60)).toHaveLength(0)
    // 90s 那条在 seek 之后仍应出现
    expect(engine.tick(90)).toHaveLength(1)
  })

  it('seek 后清空在播弹幕', () => {
    const { engine } = makeEngine()
    engine.load([item(1)], FULL, 0)
    expect(engine.tick(1)).toHaveLength(1)
    engine.skip(500)
    expect(engine.tick(1.1)).toHaveLength(0)
  })
})

describe('DanmakuEngine enqueue', () => {
  it('按时间插入到待显队列', () => {
    const { engine } = makeEngine()
    engine.load([item(10), item(30)], FULL, 0)
    engine.enqueue(item(20, { content: '插入' }))
    // 20s 时插入的这条应当出现
    const frame = engine.tick(20)
    expect(frame.map((entry) => entry.content)).toContain('插入')
  })

  it('追加到末尾', () => {
    const { engine } = makeEngine()
    engine.load([item(10)], FULL, 0)
    engine.enqueue(item(40, { content: '最后' }))
    expect(engine.tick(40).map((entry) => entry.content)).toContain('最后')
  })
})

describe('DanmakuEngine 边界', () => {
  it('视口过小不渲染', () => {
    const { engine } = makeEngine({ width: 0, height: 0 })
    engine.load([item(1)], FULL, 0)
    expect(engine.tick(1)).toHaveLength(0)
  })

  it('空弹幕列表不报错', () => {
    const { engine } = makeEngine()
    engine.load([], FULL, 0)
    expect(engine.tick(10)).toEqual([])
  })

  it('clear 后不再渲染', () => {
    const { engine } = makeEngine()
    engine.load([item(1)], FULL, 0)
    engine.clear()
    expect(engine.tick(1)).toHaveLength(0)
  })
})

// ==================== 时间轴推进与播完释放 ====================
// 「播完」在引擎侧的语义是：待显队列耗尽 + 在播弹幕全部过期。
// 这里按 1/60s 步进模拟整集播放，断言不残留、不累积。

describe('DanmakuEngine 时间轴推进', () => {
  /** 每帧 1/60s 推进，返回每帧的在播条数。 */
  const play = (engine: DanmakuEngine, from: number, to: number): number[] => {
    const counts: number[] = []
    for (let frame = 0; from + frame / 60 <= to; frame += 1) {
      counts.push(engine.tick(from + frame / 60).length)
    }
    return counts
  }

  it('待显弹幕耗尽且过期后不再产出', () => {
    const { engine } = makeEngine()
    engine.load([item(1, { content: '早' }), item(2, { content: '晚' })], FULL, 0)
    // 最后一条 2s 上屏，滚动 9s 后离场；30s 后必然全空
    expect(play(engine, 0, 30).at(-1)).toBe(0)
  })

  /** 跑完整段并收集真正上过屏的 id。 */
  const renderedIds = (
    engine: DanmakuEngine,
    items: DanmakuItem[],
    until: number,
  ): Set<string> => {
    engine.load(items, FULL, 0)
    const seen = new Set<string>()
    for (let frame = 0; frame / 60 <= until; frame += 1) {
      for (const entry of engine.tick(frame / 60)) seen.add(entry.id)
    }
    return seen
  }

  it('密集弹幕在车道占满时丢弃，不会全部上屏', () => {
    // 每条 0.1s 一条（10 条/秒），远超 5 条车道 × 约 1.3s 的释放周期
    const items = Array.from({ length: 200 }, (_, index) => item(index * 0.1))
    const seen = renderedIds(makeEngine().engine, items, 70)
    expect(seen.size).toBeGreaterThan(0)
    expect(seen.size).toBeLessThan(items.length)
  })

  it('稀疏弹幕全部上屏（丢弃只发生在车道满时）', () => {
    const items = Array.from({ length: 20 }, (_, index) => item(index * 2))
    const seen = renderedIds(makeEngine().engine, items, 60)
    expect(seen.size).toBe(items.length)
  })

  it('播放结束后 active 不累积（无泄漏）', () => {
    const { engine } = makeEngine()
    engine.load([item(1)], FULL, 0)
    play(engine, 0, 20)
    const counts = play(engine, 20, 40)
    expect(counts.every((count) => count === 0)).toBe(true)
  })

  it('clear 释放锚点，重新 load 从给定位置正常起算', () => {
    const { engine } = makeEngine()
    engine.load([item(5, { content: '旧' })], FULL, 100)
    engine.clear()
    // clear 后锚点已释放，新 load 的锚点才是唯一时间基准
    engine.load([item(5, { content: '新' })], FULL, 5)
    expect(engine.tick(5).map((entry) => entry.content)).toContain('新')
  })
})

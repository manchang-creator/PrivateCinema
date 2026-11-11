// ==================== 演示弹幕种子 ====================
// 移植自 iOS `DanmakuSeeder`：同一 episodeId 每次生成同一批弹幕，
// 保证高能进度条与弹幕分布可复现（否则每次进播放页都变）。

import type { DanmakuItem, DanmakuType } from '@shared/types'

/** xorshift64，与 iOS `SeededGenerator` 同一算法。 */
export class SeededGenerator {
  private state: bigint

  constructor(seed: bigint) {
    this.state = seed === 0n ? 0x9e3779b97f4a7c15n : seed
  }

  next(): bigint {
    this.state ^= (this.state << 13n) & 0xffffffffffffffffn
    this.state ^= this.state >> 7n
    this.state ^= (this.state << 17n) & 0xffffffffffffffffn
    this.state &= 0xffffffffffffffffn
    return this.state
  }

  /** [low, high) 内的浮点数。 */
  nextFloat(low: number, high: number): number {
    const unit = Number(this.next() >> 11n) / 2 ** 53
    return low + unit * (high - low)
  }

  /** [0, bound) 内的整数。 */
  nextInt(bound: number): number {
    return Math.floor(this.nextFloat(0, bound))
  }

  pick<T>(pool: readonly T[]): T {
    return pool[this.nextInt(pool.length)]
  }
}

/** 由字符串生成稳定的 64 位种子（FNV-1a 64）。 */
export function hashSeed(text: string): bigint {
  let hash = 0xcbf29ce484222325n
  for (let i = 0; i < text.length; i += 1) {
    hash ^= BigInt(text.charCodeAt(i))
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn
  }
  return hash
}

const CONTENT_POOL = [
  '这段配乐绝了',
  '前方高能',
  '笑死我了',
  '第一次看，先留个名',
  '二刷打卡',
  '这个镜头太美了',
  '导演是懂节奏的',
  '泪目',
  '名场面来了',
  '这段我能看一百遍',
  '细节狂魔',
  '全场最佳',
  '求同款',
  '这里埋了伏笔',
  '别眨眼',
  '字幕组辛苦了',
]

const COLOR_POOL = ['#FFFFFF', '#FFFFFF', '#FFFFFF', '#FFD84D', '#7FD8FF', '#FF8FB1']

/** 与 iOS 一致：时长不足 60 秒不生成演示弹幕。 */
export function seedDanmaku(
  mediaId: string,
  episodeId: string,
  duration: number,
): DanmakuItem[] {
  if (duration <= 60) return []

  const random = new SeededGenerator(hashSeed(episodeId) | 1n)
  const count = 80 + random.nextInt(81)
  const peaks = [0.25, 0.55, 0.8].map((ratio) => ratio * duration)
  const items: DanmakuItem[] = []

  for (let i = 0; i < count; i += 1) {
    const nearPeak = random.nextInt(2) === 0
    const time = nearPeak
      ? Math.max(0, random.pick(peaks) + random.nextFloat(-8, 8))
      : random.nextFloat(0, duration)

    const roll = random.nextInt(20)
    const type: DanmakuType = roll === 0 ? 'top' : roll === 1 ? 'bottom' : 'scroll'

    items.push({
      id: `seed-${episodeId}-${i}`,
      mediaId,
      episodeId,
      time,
      content: random.pick(CONTENT_POOL),
      type,
      color: random.pick(COLOR_POOL),
      userId: 'seed',
      createdAt: new Date(0).toISOString(),
    })
  }

  return items.sort((a, b) => a.time - b.time)
}

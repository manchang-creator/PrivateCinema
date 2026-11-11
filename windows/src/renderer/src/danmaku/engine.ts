// ==================== 弹幕引擎 ====================
// 移植自 iOS `DanmakuRendererView`：把「时间 → 位置」的推导与图层绘制分离，
// 本文件只做纯逻辑（无 DOM），因此可被单元测试直接驱动。
//
// 三条不变量（与 iOS 完全一致）：
// 1. 位置由绝对时间推导，不做逐帧累加 —— 掉帧不产生漂移。
// 2. 车道用「该车道空闲时刻」占用，不排队：车道全满即丢弃。
// 3. seek 后先锚定时间基准，等播放头落回锚点再交还实时时间，
//    否则后退 seek 会把整段弹幕一次性倾泻到屏幕上。

import type { DanmakuItem } from '@shared/types'
import type { DanmakuSnapshot } from './settings'

/** 一条横穿屏幕（或停留）的弹幕的渲染状态。 */
export interface ActiveDanmaku {
  item: DanmakuItem
  /** 进入屏幕时的视频时间（秒） */
  startTime: number
  /** 文本像素宽（含 8px 内边距） */
  textWidth: number
  /** 走完全程所需秒数 */
  travelDuration: number
  lane: number
  /** 顶部 / 底部弹幕的固定 y；滚动弹幕每帧重算 */
  y: number
}

/** 交给绘制层的单条数据：只含绘制所需字段。 */
export interface RenderableDanmaku {
  id: string
  content: string
  color: string
  x: number
  y: number
  fontSize: number
  opacity: number
}

export interface DanmakuViewport {
  width: number
  height: number
}

export interface DanmakuEngineOptions {
  viewport: () => DanmakuViewport
  /** 测量文本宽度（像素）。由绘制层注入，引擎本身不碰 canvas。 */
  measureText: (content: string, fontSize: number) => number
  /** 单调递增墙钟（毫秒）。用于锚点超时判定，默认 performance.now。 */
  clock?: () => number
}

/** 滚动弹幕横穿屏幕的基准时长（秒）。 */
const BASE_CROSS_DURATION = 9.0
/** 顶部 / 底部弹幕的停留时长（秒）。 */
const FIXED_DISPLAY_DURATION = 4.5
/** seek 锚点最长保持时间（毫秒）。 */
const SYNC_ANCHOR_TIMEOUT_MS = 3000
/** 播放头与锚点的容差（秒）：进入该范围即认为 seek 已生效。 */
const SYNC_ANCHOR_TOLERANCE = 0.5

export class DanmakuEngine {
  private pending: DanmakuItem[] = []
  private pendingIndex = 0
  private active: ActiveDanmaku[] = []

  private snapshot: DanmakuSnapshot = {
    areaRatio: 0.5,
    opacity: 1,
    fontScale: 1,
    speedFactor: 1,
    allowScroll: true,
    allowTop: true,
    allowBottom: true,
  }

  private syncAnchor: number | null = null
  private syncAnchorDeadline = 0

  private scrollLaneFreeAt: number[] = []
  private topLaneFreeAt: number[] = []
  private bottomLaneFreeAt: number[] = []

  private readonly options: DanmakuEngineOptions

  constructor(options: DanmakuEngineOptions) {
    this.options = options
  }

  // ==================== 对外接口 ====================

  /**
   * 载入一集弹幕（需按 time 升序）。
   * @param at 载入时刻的播放位置。必须由调用方给出 —— 刚换集时播放器
   *   上报的时间还停在旧值，读它会把整段弹幕倾倒出来。
   */
  load(items: DanmakuItem[], snapshot: DanmakuSnapshot, at: number): void {
    this.snapshot = snapshot
    this.pending = [...items].sort((a, b) => a.time - b.time)
    // 刻意不把 liveTime 改成 at：锚点必须真正生效，
    // 否则第一帧就会读到播放器尚未 seek 到位的旧时间
    this.holdTimeline(at)

    const now = this.renderTime()
    this.active = []
    this.resetLanes(now)
    this.pendingIndex = this.pending.findIndex((item) => item.time >= now)
    if (this.pendingIndex < 0) this.pendingIndex = this.pending.length
  }

  clear(): void {
    this.releaseTimeline()
    this.pending = []
    this.pendingIndex = 0
    this.active = []
    this.resetLanes()
  }

  /** 设置变更：只影响后续渲染，已上屏的按新开关清掉不允许的类型。 */
  apply(snapshot: DanmakuSnapshot): void {
    this.snapshot = snapshot
    this.active = this.active.filter((entry) => this.isAllowed(entry.item))
  }

  /** 实时追加一条弹幕（用户自己发送的）。 */
  enqueue(item: DanmakuItem): void {
    const rest = this.pending.slice(this.pendingIndex)
    const offset = rest.findIndex((existing) => existing.time > item.time)
    if (offset < 0) {
      this.pending.push(item)
      return
    }
    this.pending.splice(this.pendingIndex + offset, 0, item)
  }

  /** seek 之后同步：丢弃已过去的待显弹幕，清空在播，重新锚定时间。 */
  skip(to: number): void {
    this.active = []
    this.resetLanes(to)
    const index = this.pending.findIndex((item) => item.time >= to)
    this.pendingIndex = index < 0 ? this.pending.length : index
    this.holdTimeline(to)
  }

  /** 视口尺寸变化后清屏重来，避免错位。 */
  resize(): void {
    this.active = []
    this.resetLanes(this.renderTime())
  }

  /**
   * 推进一帧，返回本帧需要绘制的弹幕。
   * @param videoTime 播放器当前时间（秒）
   */
  tick(videoTime: number): RenderableDanmaku[] {
    this.liveTime = videoTime
    const viewport = this.options.viewport()
    if (viewport.width <= 1 || viewport.height <= 1) return []

    const now = this.renderTime()
    this.spawnDue(now, viewport)
    this.update(now, viewport)
    return this.collectRenderables(now, viewport)
  }

  // ==================== 时间基准 ====================

  /** 最近一次 tick 传入的播放器时间。 */
  private liveTime = 0

  /** 锚定时间基准，直到播放头落回锚点附近（或超时）。 */
  private holdTimeline(time: number): void {
    this.syncAnchor = time
    this.syncAnchorDeadline = this.now() + SYNC_ANCHOR_TIMEOUT_MS
  }

  private releaseTimeline(): void {
    this.syncAnchor = null
    this.syncAnchorDeadline = 0
  }

  /**
   * 渲染用时间：锚点生效期间取锚点，播放头落到锚点后交还实时时间。
   * 用绝对差值而非方向判定 —— 后退 seek 时旧位置大于锚点，
   * 前进 seek 时小于，只有「已经落在锚点附近」才说明 seek 真正生效。
   */
  private renderTime(): number {
    const live = this.liveTime
    const anchor = this.syncAnchor
    if (anchor === null) return live
    if (Math.abs(live - anchor) <= SYNC_ANCHOR_TOLERANCE) {
      this.releaseTimeline()
      return live
    }
    if (this.now() <= this.syncAnchorDeadline) return anchor

    // seek 迟迟未生效：交还实时时间。播放头已越过锚点说明是后退 seek 卡住，
    // 必须重建索引，否则恢复瞬间会把中间那段弹幕整段倾泻出来。
    this.releaseTimeline()
    if (live > anchor) {
      this.active = []
      this.resetLanes(live)
      const index = this.pending.findIndex((item) => item.time >= live)
      this.pendingIndex = index < 0 ? this.pending.length : index
    }
    return live
  }

  private now(): number {
    return this.options.clock ? this.options.clock() : performance.now()
  }

  // ==================== 生成 ====================

  private spawnDue(now: number, viewport: DanmakuViewport): void {
    while (this.pendingIndex < this.pending.length && this.pending[this.pendingIndex].time <= now) {
      const item = this.pending[this.pendingIndex]
      this.pendingIndex += 1
      this.spawn(item, now, viewport)
    }
  }

  private spawn(item: DanmakuItem, now: number, viewport: DanmakuViewport): void {
    if (!this.isAllowed(item)) return
    if (item.type === 'scroll') {
      this.spawnScroll(item, now, viewport)
    } else {
      this.spawnFixed(item, now, viewport, item.type === 'top')
    }
  }

  private isAllowed(item: DanmakuItem): boolean {
    if (item.type === 'scroll') return this.snapshot.allowScroll
    if (item.type === 'top') return this.snapshot.allowTop
    return this.snapshot.allowBottom
  }

  private spawnScroll(item: DanmakuItem, now: number, viewport: DanmakuViewport): void {
    const textWidth = this.measure(item, viewport)
    const lane = this.availableScrollLane(now, viewport)
    // 车道全满则丢弃：排队会让弹幕滞后于画面，比丢一条更糟
    if (lane === null) return

    const pxPerSecond = this.scrollSpeed(textWidth, viewport)
    this.active.push({
      item,
      startTime: now,
      textWidth,
      travelDuration: (viewport.width + textWidth) / pxPerSecond,
      lane,
      y: this.laneOffset(lane, viewport),
    })
    this.scrollLaneFreeAt[lane] = now + textWidth / pxPerSecond
  }

  private spawnFixed(
    item: DanmakuItem,
    now: number,
    viewport: DanmakuViewport,
    isTop: boolean,
  ): void {
    const textWidth = this.measure(item, viewport)
    const lanes = isTop ? this.topLaneFreeAt : this.bottomLaneFreeAt
    const lane = lanes.findIndex((freeAt) => now >= freeAt)
    if (lane < 0) return
    lanes[lane] = now + FIXED_DISPLAY_DURATION

    const offset = this.laneOffset(lane, viewport)
    const laneHeight = this.laneHeight(viewport)
    this.active.push({
      item,
      startTime: now,
      textWidth,
      travelDuration: FIXED_DISPLAY_DURATION,
      lane,
      y: isTop ? offset : viewport.height - offset - laneHeight,
    })
  }

  // ==================== 更新 ====================

  private update(now: number, viewport: DanmakuViewport): void {
    this.active = this.active.filter((entry) => {
      if (entry.item.type !== 'scroll') {
        return now <= entry.startTime + FIXED_DISPLAY_DURATION
      }
      const progress = (now - entry.startTime) / Math.max(0.001, entry.travelDuration)
      const x = viewport.width - progress * (viewport.width + entry.textWidth)
      return x >= -entry.textWidth - 8
    })
  }

  private collectRenderables(now: number, viewport: DanmakuViewport): RenderableDanmaku[] {
    const fontSize = this.baseFontSize(viewport)
    return this.active.map((entry) => {
      const x =
        entry.item.type === 'scroll'
          ? viewport.width -
            ((now - entry.startTime) / Math.max(0.001, entry.travelDuration)) *
              (viewport.width + entry.textWidth)
          : Math.max(8, (viewport.width - entry.textWidth) / 2)
      return {
        id: entry.item.id,
        content: entry.item.content,
        color: entry.item.color,
        x,
        y: entry.y,
        fontSize,
        opacity: this.snapshot.opacity,
      }
    })
  }

  // ==================== 车道与几何 ====================

  private baseFontSize(viewport: DanmakuViewport): number {
    // 以 390px 为基准逐级放大：窄屏保持 16px，宽屏按整数倍放大
    return 16 * this.snapshot.fontScale * Math.max(1, Math.floor(viewport.width / 390))
  }

  private laneHeight(viewport: DanmakuViewport): number {
    return this.baseFontSize(viewport) * 1.4 + 4
  }

  private usableHeight(viewport: DanmakuViewport): number {
    return viewport.height * this.snapshot.areaRatio
  }

  private laneCount(viewport: DanmakuViewport): number {
    return Math.max(1, Math.floor(this.usableHeight(viewport) / this.laneHeight(viewport)))
  }

  private laneOffset(lane: number, viewport: DanmakuViewport): number {
    return lane * this.laneHeight(viewport) + 4
  }

  private scrollSpeed(textWidth: number, viewport: DanmakuViewport): number {
    const width = Math.max(viewport.width, 100)
    return (width + textWidth) / (BASE_CROSS_DURATION / Math.max(0.1, this.snapshot.speedFactor))
  }

  private measure(item: DanmakuItem, viewport: DanmakuViewport): number {
    return this.options.measureText(item.content, this.baseFontSize(viewport)) + 8
  }

  private availableScrollLane(now: number, viewport: DanmakuViewport): number | null {
    const count = this.laneCount(viewport)
    for (let lane = 0; lane < count; lane += 1) {
      if (lane >= this.scrollLaneFreeAt.length) break
      if (now >= this.scrollLaneFreeAt[lane]) return lane
    }
    return null
  }

  private resetLanes(time?: number): void {
    const at = time ?? this.liveTime
    const viewport = this.options.viewport()
    this.scrollLaneFreeAt = new Array(Math.max(this.laneCount(viewport), 8)).fill(at)
    this.topLaneFreeAt = new Array(Math.max(this.laneCount(viewport), 4)).fill(at)
    this.bottomLaneFreeAt = new Array(Math.max(this.laneCount(viewport), 4)).fill(at)
  }
}

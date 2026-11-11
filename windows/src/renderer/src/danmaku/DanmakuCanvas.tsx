// ==================== 弹幕画布 ====================
// 只负责「把引擎算好的坐标画出来」：不持有时间轴、不判断可见性。
// 用 canvas 而非 DOM 节点，是因为弹幕动辄数十条同时移动，
// 逐个改 transform 会产生大量样式重算。

import { useEffect, useRef, type JSX, type RefObject } from 'react'
import type { DanmakuItem } from '@shared/types'
import { DanmakuEngine, type DanmakuViewport } from './engine'
import { filterItems, toSnapshot, type DanmakuSettings } from './settings'

interface Props {
  items: DanmakuItem[]
  settings: DanmakuSettings
  /** 播放器当前时间（秒）。用 ref 传递，避免父组件按帧重渲染。 */
  currentTimeRef: RefObject<number>
  /** 载入时的锚点：换集 / 续播时必须显式给出，不能读播放器当前值。 */
  anchor: number
  /** 载入标识：换集时变化即触发重载。 */
  loadKey: string
}

const FONT_FAMILY = '"Microsoft YaHei", "PingFang SC", sans-serif'

/** 文本宽度测量用的离屏 canvas，避免每帧创建。 */
const measureCanvas = document.createElement('canvas')
const measureContext = measureCanvas.getContext('2d')

export function DanmakuCanvas({
  items,
  settings,
  currentTimeRef,
  anchor,
  loadKey,
}: Props): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const engineRef = useRef<DanmakuEngine | null>(null)

  // 引擎只创建一次：viewport 与测量函数在运行时读取，不随 props 重建
  if (engineRef.current === null) {
    engineRef.current = new DanmakuEngine({
      viewport: (): DanmakuViewport => {
        const canvas = canvasRef.current
        return { width: canvas?.clientWidth ?? 0, height: canvas?.clientHeight ?? 0 }
      },
      measureText: (content, fontSize) => {
        if (measureContext === null) return content.length * fontSize
        measureContext.font = `600 ${fontSize}px ${FONT_FAMILY}`
        return measureContext.measureText(content).width
      },
    })
  }

  // 换集：重载弹幕。anchor 由外层给出，避免读到 seek 生效前的旧时间
  useEffect(() => {
    engineRef.current?.load(filterItems(items, settings), toSnapshot(settings), anchor)
    // settings 的后续变化走下面的 apply，不重建待显队列
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadKey, items, anchor])

  useEffect(() => {
    engineRef.current?.apply(toSnapshot(settings))
  }, [settings])

  // 尺寸变化：清屏重来，避免车道错位
  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null) return
    const observer = new ResizeObserver(() => {
      syncCanvasSize(canvas)
      engineRef.current?.resize()
    })
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [])

  // 渲染循环：位置由绝对时间推导，掉帧不产生漂移，所以用 rAF 仅作刷新节拍
  useEffect(() => {
    const canvas = canvasRef.current
    const engine = engineRef.current
    if (canvas === null || engine === null) return
    const context = canvas.getContext('2d')
    if (context === null) return

    let frame = 0
    const draw = (): void => {
      frame = requestAnimationFrame(draw)
      syncCanvasSize(canvas)
      const ratio = window.devicePixelRatio || 1
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      context.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight)

      for (const danmaku of engine.tick(currentTimeRef.current)) {
        context.globalAlpha = danmaku.opacity
        context.font = `600 ${danmaku.fontSize}px ${FONT_FAMILY}`
        context.fillStyle = danmaku.color
        // 用阴影充当描边：只画一次文字，比 stroke + fill 两次绘制便宜
        context.shadowColor = 'rgba(0, 0, 0, 0.9)'
        context.shadowBlur = danmaku.fontSize * 0.05
        context.shadowOffsetX = 0.7
        context.shadowOffsetY = 0.7
        context.fillText(danmaku.content, danmaku.x, danmaku.y + danmaku.fontSize)
      }
      context.globalAlpha = 1
      context.shadowColor = 'transparent'
    }

    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [currentTimeRef])

  return <canvas ref={canvasRef} className="danmaku-canvas" />
}

/** 按设备像素比同步画布分辨率，避免高分屏发虚。 */
function syncCanvasSize(canvas: HTMLCanvasElement): void {
  const ratio = window.devicePixelRatio || 1
  const width = Math.floor(canvas.clientWidth * ratio)
  const height = Math.floor(canvas.clientHeight * ratio)
  if (canvas.width !== width) canvas.width = width
  if (canvas.height !== height) canvas.height = height
}

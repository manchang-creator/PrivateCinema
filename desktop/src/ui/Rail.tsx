// ==================== 横向货架 ====================
// 隐藏原生滚动条，纵向滚轮映射为横向翻动，左右渐隐 + 悬浮箭头提示翻页。
// 首页「继续观看」与在线分区货架共用。

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react'
import { Icon } from './icons'

interface Props {
  children: ReactNode
  className?: string
  /** 常显左右翻页按钮（大卡区用），到两端时对应按钮置灰 */
  alwaysNav?: boolean
}

export function Rail({ children, className, alwaysNav }: Props): JSX.Element {
  const scroller = useRef<HTMLDivElement>(null)
  const [reach, setReach] = useState({ left: false, right: false, overflow: false })

  const sync = useCallback(() => {
    const el = scroller.current
    if (el === null) return
    const max = el.scrollWidth - el.clientWidth
    if (max <= 1) {
      setReach({ left: false, right: false, overflow: false })
      return
    }
    setReach({
      left: el.scrollLeft > 2,
      right: el.scrollLeft < max - 2,
      overflow: true,
    })
  }, [])

  useEffect(() => {
    sync()
    const el = scroller.current
    if (el === null) return
    const observer = new ResizeObserver(sync)
    observer.observe(el)
    return () => observer.disconnect()
  }, [sync, children])

  useEffect(() => {
    const el = scroller.current
    if (el === null) return
    const onWheel = (event: WheelEvent): void => {
      const max = el.scrollWidth - el.clientWidth
      if (max <= 1 || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return
      const goingRight = event.deltaY > 0
      if ((goingRight && el.scrollLeft >= max - 1) || (!goingRight && el.scrollLeft <= 1)) return
      event.preventDefault()
      el.scrollLeft += event.deltaY
      sync()
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [sync])

  const page = useCallback((direction: 1 | -1) => {
    const el = scroller.current
    if (el === null) return
    el.scrollBy({ left: direction * el.clientWidth * 0.82, behavior: 'smooth' })
  }, [])

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const el = scroller.current
      if (el === null) return
      if (event.key === 'ArrowRight') {
        event.preventDefault()
        page(1)
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault()
        page(-1)
      }
    },
    [page],
  )

  const fadeClass = `${reach.left ? ' fade-left' : ''}${reach.right ? ' fade-right' : ''}`
  const showPrev = alwaysNav ? reach.overflow : reach.left
  const showNext = alwaysNav ? reach.overflow : reach.right

  return (
    <div className={alwaysNav ? 'rail-wrap nav-always' : 'rail-wrap'}>
      <div
        className={`rail${fadeClass}${className !== undefined ? ` ${className}` : ''}`}
        ref={scroller}
        onScroll={sync}
        onKeyDown={handleKeyDown}
      >
        {children}
      </div>
      {showPrev && (
        <button
          type="button"
          className="rail-nav rail-nav-prev"
          aria-label="向左浏览"
          disabled={!reach.left}
          onClick={() => page(-1)}
        >
          <Icon name="chevron-left" size={20} />
        </button>
      )}
      {showNext && (
        <button
          type="button"
          className="rail-nav rail-nav-next"
          aria-label="向右浏览"
          disabled={!reach.right}
          onClick={() => page(1)}
        >
          <Icon name="chevron-right" size={20} />
        </button>
      )}
    </div>
  )
}

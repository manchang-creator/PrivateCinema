// ==================== 亮度菜单（主界面） ====================
// 播放页之外也能调亮度：主界面顶栏放一个「亮度」按钮，弹出显示器亮度面板。
// 与播放页共用同一套 IPC（listDisplays / setBrightness），底层按平台走 sysfs / ddcutil / X11 软件调光。

import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import type { DisplayBrightness } from '@private-cinema/core/shared'

interface WriteSlot {
  inFlight: boolean
  pending: number | null
}

export function BrightnessMenu(): JSX.Element {
  const [open, setOpen] = useState(false)
  const [displays, setDisplays] = useState<DisplayBrightness[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  // 每台显示器最多一个写入在途，其余只保留最新值（与播放页同一策略，防止拖滑块打爆 IPC 队列）。
  const writesRef = useRef(new Map<string, WriteSlot>())

  const flush = useCallback((id: string): void => {
    const slot = writesRef.current.get(id)
    if (slot === undefined || slot.inFlight || slot.pending === null) return
    const value = slot.pending
    slot.pending = null
    slot.inFlight = true
    void window.cinema
      .setBrightness(id, value)
      .then((result) => {
        if (!result.ok) setError(result.reason)
      })
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : String(reason))
      })
      .finally(() => {
        slot.inFlight = false
        flush(id)
      })
  }, [])

  const change = useCallback(
    (id: string, value: number) => {
      setDisplays((previous) =>
        previous === null
          ? previous
          : previous.map((item) =>
              item.id === id && item.available ? { ...item, current: value } : item,
            ),
      )
      const slot = writesRef.current.get(id) ?? { inFlight: false, pending: null }
      slot.pending = value
      writesRef.current.set(id, slot)
      flush(id)
    },
    [flush],
  )

  const toggle = useCallback(() => {
    setOpen((previous) => {
      if (previous) return false
      setError(null)
      setDisplays(null)
      void window.cinema
        .listDisplays()
        .then(setDisplays)
        .catch((reason: unknown) => {
          setError(reason instanceof Error ? reason.message : String(reason))
          setDisplays([])
        })
      return true
    })
  }, [])

  // 点击外部 / Esc 关闭
  useEffect(() => {
    if (!open) return
    const onPointer = (event: MouseEvent): void => {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="brightness-menu" ref={rootRef}>
      <button
        type="button"
        className={open ? 'btn-ghost active' : 'btn-ghost'}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={toggle}
      >
        ☀ 屏幕亮度
      </button>

      {open && (
        <div className="brightness-popover" role="dialog" aria-label="显示器亮度">
          <div className="brightness-popover-head">
            <span>屏幕亮度</span>
            <button
              type="button"
              className="brightness-popover-close"
              aria-label="关闭"
              onClick={() => setOpen(false)}
            >
              ×
            </button>
          </div>

          {error !== null && <div className="brightness-error">{error}</div>}
          {displays === null && <div className="brightness-empty">正在读取显示器…</div>}
          {displays !== null && displays.length === 0 && (
            <div className="brightness-empty">没有检测到显示器</div>
          )}

          {displays?.map((display) => (
            <div key={display.id} className="brightness-row">
              <div className="brightness-name">
                <span className="brightness-name-text">{display.label}</span>
                {display.primary && <span className="brightness-tag">主屏</span>}
              </div>
              {display.available ? (
                <div className="brightness-slider">
                  <input
                    type="range"
                    min={display.min}
                    max={display.max}
                    value={display.current}
                    aria-label={`${display.label} 亮度`}
                    onChange={(event) => change(display.id, Number(event.target.value))}
                  />
                  <span className="brightness-value">{Math.round(display.current)}</span>
                </div>
              ) : (
                <div className="brightness-reason">{display.reason}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ==================== 显示菜单（外观 + 屏幕亮度，合并为一个） ====================
// 顶栏一个「显示」入口，弹出里同时放两块：
//   1) 外观：跟随系统 / 浅色 / 深色（CSS 变量主题）
//   2) 屏幕亮度：显示器亮度滑块（sysfs / ddcutil / X11 xrandr，底层同播放页）

import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import type { DisplayBrightness } from '@private-cinema/core/shared'
import { applyTheme, getThemePref, saveTheme, type ThemePref } from '../theme'
import { Icon } from './icons'

const THEME_OPTIONS: ReadonlyArray<{ key: ThemePref; label: string }> = [
  { key: 'system', label: '跟随系统' },
  { key: 'light', label: '浅色' },
  { key: 'dark', label: '深色' },
]

interface WriteSlot {
  inFlight: boolean
  pending: number | null
}

export function DisplayMenu(): JSX.Element {
  const [open, setOpen] = useState(false)
  const [pref, setPref] = useState<ThemePref>(getThemePref)
  const [displays, setDisplays] = useState<DisplayBrightness[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const writesRef = useRef(new Map<string, WriteSlot>())

  // 跟随系统时，OS 深浅色变化实时生效
  useEffect(() => {
    if (pref !== 'system') return
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (): void => applyTheme('system')
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [pref])

  const chooseTheme = useCallback((next: ThemePref) => {
    setPref(next)
    saveTheme(next)
  }, [])

  // ==================== 屏幕亮度 ====================
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

  const changeBrightness = useCallback(
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

  const loadDisplays = useCallback(() => {
    setDisplays(null)
    setError(null)
    void window.cinema
      .listDisplays()
      .then(setDisplays)
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : String(reason))
        setDisplays([])
      })
  }, [])

  const toggle = useCallback(() => {
    setOpen((previous) => {
      if (previous) return false
      loadDisplays()
      return true
    })
  }, [loadDisplays])

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
    <div className="display-menu" ref={rootRef}>
      <button
        type="button"
        className={open ? 'icon-btn active' : 'icon-btn'}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={toggle}
        title="外观与屏幕亮度"
      >
        <Icon name="monitor" size={16} />
        <span>显示</span>
      </button>

      {open && (
        <div className="display-popover" role="dialog" aria-label="显示设置">
          <div className="display-section">
            <div className="display-section-title">外观</div>
            <div className="display-theme" role="radiogroup" aria-label="外观模式">
              {THEME_OPTIONS.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  role="radio"
                  aria-checked={pref === option.key}
                  className={pref === option.key ? 'display-theme-btn active' : 'display-theme-btn'}
                  onClick={() => chooseTheme(option.key)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="display-divider" />

          <div className="display-section">
            <div className="display-section-title">屏幕亮度</div>
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
                      onChange={(event) => changeBrightness(display.id, Number(event.target.value))}
                    />
                    <span className="brightness-value">{Math.round(display.current)}</span>
                  </div>
                ) : (
                  <div className="brightness-reason">{display.reason}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

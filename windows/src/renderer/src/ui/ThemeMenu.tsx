// ==================== 外观菜单（跟随系统 / 浅色 / 深色） ====================
// 主流做法：三档外观。跟随系统 = 跟随 OS 深浅色；浅色/深色 = 强制白色/黑色主题。

import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import { applyTheme, getThemePref, saveTheme, type ThemePref } from '../theme'

const OPTIONS: ReadonlyArray<{ key: ThemePref; label: string; hint: string }> = [
  { key: 'system', label: '跟随系统', hint: '跟随操作系统深浅色自动切换' },
  { key: 'light', label: '浅色', hint: '白色主题' },
  { key: 'dark', label: '深色', hint: '黑色主题' },
]

export function ThemeMenu(): JSX.Element {
  const [pref, setPref] = useState<ThemePref>(getThemePref)
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  const choose = useCallback((next: ThemePref) => {
    setPref(next)
    saveTheme(next)
    setOpen(false)
  }, [])

  // 跟随系统时，OS 主题变化要实时生效
  useEffect(() => {
    if (pref !== 'system') return
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (): void => applyTheme('system')
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [pref])

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

  const current = OPTIONS.find((option) => option.key === pref) ?? OPTIONS[0]

  return (
    <div className="theme-menu" ref={rootRef}>
      <button
        type="button"
        className={open ? 'btn-ghost active' : 'btn-ghost'}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span aria-hidden="true">◐</span> 外观
        <span className="theme-current">{current.label}</span>
      </button>

      {open && (
        <div className="theme-popover" role="dialog" aria-label="外观">
          <div className="theme-popover-head">外观</div>
          <div className="theme-options" role="radiogroup" aria-label="外观模式">
            {OPTIONS.map((option) => (
              <button
                key={option.key}
                type="button"
                role="radio"
                aria-checked={pref === option.key}
                className={pref === option.key ? 'theme-option active' : 'theme-option'}
                onClick={() => choose(option.key)}
              >
                <span className="theme-option-check" aria-hidden="true">
                  {pref === option.key ? '✓' : ''}
                </span>
                <span className="theme-option-body">
                  <span className="theme-option-label">{option.label}</span>
                  <span className="theme-option-hint">{option.hint}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

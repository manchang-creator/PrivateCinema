// ==================== 外观主题（跟随系统 / 浅色 / 深色） ====================
// 主题偏好存 localStorage；跟随系统时监听 OS 的 prefers-color-scheme。
// 应用方式：给 <html> 设 data-theme="light|dark"，具体配色全部由 CSS 变量切换。

export type ThemePref = 'system' | 'light' | 'dark'

const STORAGE_KEY = 'pc-theme'

export function getThemePref(): ThemePref {
  const stored = localStorage.getItem(STORAGE_KEY)
  return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system'
}

export function prefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

export function resolveTheme(pref: ThemePref): 'light' | 'dark' {
  if (pref === 'system') return prefersDark() ? 'dark' : 'light'
  return pref
}

export function applyTheme(pref: ThemePref): void {
  document.documentElement.dataset.theme = resolveTheme(pref)
}

export function saveTheme(pref: ThemePref): void {
  localStorage.setItem(STORAGE_KEY, pref)
  applyTheme(pref)
}

/** 首帧前调用，避免刷新时先闪一下错误配色。 */
export function initTheme(): void {
  applyTheme(getThemePref())
}

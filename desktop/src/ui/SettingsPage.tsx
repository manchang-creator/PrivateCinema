// ==================== 设置页 ====================
// 顶栏里的「显示 / 设置」弹层保留（快捷入口），这里给一个完整的设置页：
// 外观、播放偏好、数据清理、关于与更新。分组卡片布局，参考腾讯视频的「设置」页。

import { useCallback, useEffect, useState, type JSX, type ReactNode } from 'react'
import type { AppInfo, UpdateInfo } from '@private-cinema/core/shared'
import { applyTheme, getThemePref, saveTheme, type ThemePref } from '../theme'
import {
  useAutoNext,
  useHistory,
  usePlayerRate,
  useRailCollapsed,
  useSearchHistory,
  useViewMode,
} from '../lib/store'
import { Icon } from './icons'

const THEMES: ReadonlyArray<{ key: ThemePref; label: string; desc: string }> = [
  { key: 'system', label: '跟随系统', desc: '系统切换深浅色时自动跟随' },
  { key: 'light', label: '浅色', desc: '明亮底，适合白天' },
  { key: 'dark', label: '深色', desc: '影院黑，适合关灯看片' },
]

const RATES: readonly number[] = [0.75, 1, 1.25, 1.5, 2]

function errMsg(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

function friendlyUpdateError(reason: unknown): string {
  const msg = errMsg(reason)
  if (/404|\bnot found\b/i.test(msg)) {
    return '暂无可用的在线更新清单（最新发布未附 update-*.json），可到 Releases 手动下载。'
  }
  return msg
}

export function SettingsPage(): JSX.Element {
  const [pref, setPref] = useState<ThemePref>(getThemePref)
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [autoUpdate, setAutoUpdate] = useState(false)
  const [update, setUpdate] = useState<UpdateInfo | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [compact, setCompact] = useState(false)
  const [onTop, setOnTop] = useState(false)
  const [windowErr, setWindowErr] = useState<string | null>(null)
  const [autoNext, setAutoNext] = useAutoNext()
  const [rate, setRate] = usePlayerRate()
  const [view, setView] = useViewMode()
  const [collapsed, setCollapsed] = useRailCollapsed()
  const history = useHistory()
  const search = useSearchHistory()

  useEffect(() => {
    void window.cinema
      .appInfo()
      .then((next) => {
        setInfo(next)
        setAutoUpdate(next.autoUpdate)
      })
      .catch((reason: unknown) => setMessage(errMsg(reason)))
    // 窗口偏好与 AppInfo 分开读：窗口 API 失败不该影响「关于/更新」整块
    void window.cinema
      .compactMode()
      .then(setCompact)
      .catch((reason: unknown) => setWindowErr(errMsg(reason)))
    void window.cinema
      .alwaysOnTop()
      .then(setOnTop)
      .catch((reason: unknown) => setWindowErr(errMsg(reason)))
  }, [])

  const chooseTheme = useCallback((next: ThemePref) => {
    setPref(next)
    saveTheme(next)
    applyTheme(next)
  }, [])

  const check = useCallback(async () => {
    setBusy(true)
    setMessage(null)
    setUpdate(null)
    try {
      const result = await window.cinema.checkUpdate()
      setUpdate(result)
      if (!result.enabled) setMessage('当前构建未启用在线更新（开发版或未配置更新）。')
      else if (!result.available) setMessage('已是最新版本。')
    } catch (reason) {
      setMessage(friendlyUpdateError(reason))
    } finally {
      setBusy(false)
    }
  }, [])

  const install = useCallback(async () => {
    setBusy(true)
    setMessage('正在下载并安装更新…')
    try {
      await window.cinema.installUpdate()
      await window.cinema.restartApp()
    } catch (reason) {
      setMessage(friendlyUpdateError(reason))
      setBusy(false)
    }
  }, [])

  // 先乐观更新 UI，失败再回滚：窗口尺寸变化是即时的，等 IPC 回来才勾会显得卡。
  const toggleCompact = useCallback((next: boolean) => {
    setCompact(next)
    setWindowErr(null)
    void window.cinema.setCompactMode(next).catch((reason: unknown) => {
      setCompact(!next)
      setWindowErr(errMsg(reason))
    })
  }, [])

  const toggleOnTop = useCallback((next: boolean) => {
    setOnTop(next)
    setWindowErr(null)
    void window.cinema.setAlwaysOnTop(next).catch((reason: unknown) => {
      setOnTop(!next)
      setWindowErr(errMsg(reason))
    })
  }, [])

  const toggleAutoUpdate = useCallback((next: boolean) => {
    setAutoUpdate(next)
    void window.cinema.setAutoUpdate(next).catch((reason: unknown) => setMessage(errMsg(reason)))
  }, [])

  const enabled = info?.updatesEnabled ?? false

  return (
    <div className="page">
      <div className="page-inner narrow">
        <div className="page-head">
          <div>
            <h1 className="page-title">设置</h1>
            <p className="page-desc">外观、播放习惯与本机数据都在这里</p>
          </div>
        </div>

        <Card title="外观" sub="Theme">
          <div className="theme-grid" role="radiogroup" aria-label="外观模式">
            {THEMES.map((entry) => (
              <button
                key={entry.key}
                type="button"
                role="radio"
                aria-checked={pref === entry.key}
                className={pref === entry.key ? 'theme-card active' : 'theme-card'}
                onClick={() => chooseTheme(entry.key)}
              >
                <span className={`theme-swatch ${entry.key}`} aria-hidden="true" />
                <span className="theme-text">
                  <b>{entry.label}</b>
                  <small>{entry.desc}</small>
                </span>
                {pref === entry.key && <Icon name="star" size={14} />}
              </button>
            ))}
          </div>
        </Card>

        <Card title="窗口" sub="Window">
          <Row label="小窗模式" hint="把主窗口缩到 560×420，边看边干别的；关掉回到常规尺寸">
            <Switch checked={compact} onChange={toggleCompact} label="小窗模式" />
          </Row>
          <Row label="窗口置顶" hint="主窗口始终浮在其他窗口之上（全屏应用除外）">
            <Switch checked={onTop} onChange={toggleOnTop} label="窗口置顶" />
          </Row>
          {windowErr !== null && <p className="hint brightness-error">{windowErr}</p>}
        </Card>

        <Card title="播放" sub="Playback">
          <Row label="自动连播" hint="一集结束自动播下一集">
            <Switch checked={autoNext} onChange={setAutoNext} label="自动连播" />
          </Row>
          <Row label="默认倍速" hint="进入播放页时的初始倍速">
            <div className="seg small">
              {RATES.map((value) => (
                <button
                  key={value}
                  type="button"
                  className={rate === value ? 'seg-item active' : 'seg-item'}
                  onClick={() => setRate(value)}
                >
                  {value}x
                </button>
              ))}
            </div>
          </Row>
          <Row label="片库默认视图" hint="网格适合看封面，列表适合看集数与体积">
            <div className="seg small">
              <button
                type="button"
                className={view === 'grid' ? 'seg-item active' : 'seg-item'}
                onClick={() => setView('grid')}
              >
                网格
              </button>
              <button
                type="button"
                className={view === 'list' ? 'seg-item active' : 'seg-item'}
                onClick={() => setView('list')}
              >
                列表
              </button>
            </div>
          </Row>
          <Row label="侧栏" hint="收起后只剩图标，给内容更多宽度">
            <Switch checked={collapsed} onChange={setCollapsed} label="收起侧栏" />
          </Row>
        </Card>

        <Card title="数据" sub="Data">
          <Row label="观看历史" hint={`${history.list.length} 条记录`}>
            <button type="button" className="btn-glass small" onClick={history.clear}>
              <Icon name="trash" size={14} />
              清空
            </button>
          </Row>
          <Row label="搜索历史" hint={`${search.list.length} 条记录`}>
            <button type="button" className="btn-glass small" onClick={search.clear}>
              <Icon name="trash" size={14} />
              清空
            </button>
          </Row>
        </Card>

        <Card title="关于" sub="About">
          <Row label="版本" hint={info?.platform ?? ''}>
            <span className="mono">v{info?.version ?? '…'}</span>
          </Row>
          <Row label="自动更新" hint="启动时静默检查新版本">
            <Switch checked={autoUpdate} onChange={toggleAutoUpdate} label="自动更新" />
          </Row>
          <div className="settings-block">
            {!enabled ? (
              <p className="hint">
                当前为开发或未配置更新的构建。正式安装包在 mygo.config.ts 配置 updates 并签名后即具备
                在线更新能力。
              </p>
            ) : (
              <div className="settings-actions">
                <button type="button" className="btn-glass" disabled={busy} onClick={() => void check()}>
                  <Icon name="refresh" size={15} />
                  检查更新
                </button>
                {update?.available === true && (
                  <button type="button" className="btn-primary" disabled={busy} onClick={() => void install()}>
                    更新到 v{update.version}
                  </button>
                )}
              </div>
            )}
            {update?.available === true && update.notes !== '' && (
              <pre className="release-notes">{update.notes}</pre>
            )}
            {message !== null && <p className="hint">{message}</p>}
          </div>
        </Card>
      </div>
    </div>
  )
}

function Card({ title, sub, children }: { title: string; sub: string; children: ReactNode }): JSX.Element {
  return (
    <section className="setting-card">
      <header className="setting-card-head">
        <h2>{title}</h2>
        <span>{sub}</span>
      </header>
      <div className="setting-card-body">{children}</div>
    </section>
  )
}

function Row({ label, hint, children }: { label: string; hint: string; children: ReactNode }): JSX.Element {
  return (
    <div className="setting-row">
      <div className="setting-row-text">
        <b>{label}</b>
        {hint !== '' && <small>{hint}</small>}
      </div>
      <div className="setting-row-ctl">{children}</div>
    </div>
  )
}

function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
}): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={checked ? 'switch on' : 'switch'}
      onClick={() => onChange(!checked)}
    >
      <span className="switch-knob" />
    </button>
  )
}

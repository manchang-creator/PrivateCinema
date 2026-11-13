// ==================== 设置菜单（关于 + 更新）====================
// 顶栏一个「设置」入口，弹出里放「关于」和「更新」：
//   1) 关于：应用名 + 当前版本 + 平台；
//   2) 更新：自动更新开关、检查更新、发现新版本后一键更新并重启。
// 更新能力由后端 mygo.Updater 提供；开发/未配置更新的构建会提示暂不支持在线更新。

import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import type { AppInfo, UpdateInfo } from '@private-cinema/core/shared'
import { Icon } from './icons'

type Phase = 'idle' | 'checking' | 'latest' | 'available' | 'installing' | 'done' | 'error'

function errMsg(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

// 更新检查最常见的「假报错」：最新 Release 没附 update-*.json 清单时，GitHub 返回 404。
// 这不是应用故障，只是没有可用的在线更新源；转成一句人能看懂的提示，别把 GET…404 原样甩出来。
function friendlyUpdateError(reason: unknown): string {
  const msg = errMsg(reason)
  if (/404|\bnot found\b/i.test(msg)) {
    return '暂时无法在线更新：最新发布未附更新清单（可到 GitHub Releases 手动下载最新版）。'
  }
  return msg
}

export function SettingsMenu(): JSX.Element {
  const [open, setOpen] = useState(false)
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [autoUpdate, setAutoUpdateState] = useState(false)
  const [phase, setPhase] = useState<Phase>('idle')
  const [update, setUpdate] = useState<UpdateInfo | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  const refreshInfo = useCallback(() => {
    void window.cinema
      .appInfo()
      .then((next) => {
        setInfo(next)
        setAutoUpdateState(next.autoUpdate)
      })
      .catch((reason: unknown) => setMessage(errMsg(reason)))
  }, [])

  const toggle = useCallback(() => {
    setOpen((previous) => {
      if (!previous) refreshInfo()
      return !previous
    })
  }, [refreshInfo])

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

  const check = useCallback(async () => {
    setPhase('checking')
    setMessage(null)
    setUpdate(null)
    try {
      const result = await window.cinema.checkUpdate()
      setUpdate(result)
      if (!result.enabled) {
        setPhase('idle')
        setMessage('当前构建未启用在线更新（开发版或未配置更新）。')
      } else if (result.available) {
        setPhase('available')
      } else {
        setPhase('latest')
      }
    } catch (reason) {
      setPhase('error')
      setMessage(friendlyUpdateError(reason))
    }
  }, [])

  const install = useCallback(async () => {
    setPhase('installing')
    setMessage('正在下载并安装更新…')
    try {
      await window.cinema.installUpdate()
      setPhase('done')
      setMessage('更新已安装，正在重启…')
      await window.cinema.restartApp()
    } catch (reason) {
      setPhase('error')
      setMessage(friendlyUpdateError(reason))
    }
  }, [])

  const toggleAuto = useCallback((next: boolean) => {
    setAutoUpdateState(next)
    void window.cinema.setAutoUpdate(next).catch((reason: unknown) => setMessage(errMsg(reason)))
  }, [])

  const busy = phase === 'checking' || phase === 'installing'
  const enabled = info?.updatesEnabled ?? false

  return (
    <div className="display-menu" ref={rootRef}>
      <button
        type="button"
        className={open ? 'icon-btn active' : 'icon-btn'}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={toggle}
        title="设置与更新"
      >
        <Icon name="settings" size={16} />
        <span>设置</span>
      </button>

      {open && (
        <div className="display-popover settings-popover" role="dialog" aria-label="设置">
          <div className="display-section">
            <div className="display-section-title">关于</div>
            <div className="settings-about">
              <span className="settings-app">私人影院 PrivateCinema</span>
              <span className="settings-version">
                v{info?.version ?? '…'}
                {info?.platform ? ` · ${info.platform}` : ''}
              </span>
            </div>
          </div>

          <div className="display-divider" />

          <div className="display-section">
            <div className="display-section-title">更新</div>

            <label className="settings-row">
              <span className="settings-row-label">自动更新</span>
              <input
                type="checkbox"
                className="settings-switch"
                checked={autoUpdate}
                onChange={(event) => toggleAuto(event.target.checked)}
              />
            </label>

            {!enabled ? (
              <div className="settings-hint">
                当前为开发或未配置更新的构建，暂不支持在线更新。正式安装包在 mygo.config.ts 配置
                updates 并可签名后即具备在线更新能力。
              </div>
            ) : (
              <>
                <div className="settings-actions">
                  <button className="btn-glass" disabled={busy} onClick={() => void check()}>
                    <Icon name="refresh" size={15} />
                    {phase === 'checking' ? '检查中…' : '检查更新'}
                  </button>
                  {phase === 'available' && (
                    <button className="btn-primary" disabled={busy} onClick={() => void install()}>
                      <Icon name="refresh" size={15} />
                      立即更新
                    </button>
                  )}
                </div>

                {update?.available && (
                  <div className="settings-update">
                    <span className="settings-update-ver">发现新版本 v{update.version}</span>
                    {update.notes !== '' && <span className="settings-notes">{update.notes}</span>}
                  </div>
                )}
                {phase === 'latest' && <div className="settings-hint">已是最新版本。</div>}
                {message !== null && <div className="settings-hint">{message}</div>}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

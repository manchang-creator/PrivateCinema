// ==================== 播放页 ====================
// 主链路：视频解码 → 字幕叠加 → 弹幕渲染 → 进度续播。
// 时间轴只有一个真相源：`<video>` 元素。字幕与弹幕都读它，不各自计时。

import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import Hls from 'hls.js'
import {
  isCompleted,
  type DisplayBrightness,
  type Episode,
  type MediaItem,
  type RemoteLine,
} from '@private-cinema/core/shared'
import { localMediaUrl } from '../media'
import { DanmakuCanvas } from '../danmaku/DanmakuCanvas'
import {
  filterItems,
  loadSettings,
  saveSettings,
  seedDanmaku,
  type DanmakuSettings,
} from '@private-cinema/core/danmaku'
import { cueAt, parseSubtitle, type SubtitleCue } from '@private-cinema/core/subtitle'
import { formatTime } from '@private-cinema/core/ui'

interface Props {
  media: MediaItem
  episode: Episode
  playlist: Episode[]
  /** 从进度恢复的位置（秒）；0 表示从头播放 */
  startPosition: number
  onSelectEpisode: (episode: Episode) => void
  onExit: () => void
}

/** 进度落盘间隔（秒）：过密会频繁写盘，过疏会丢进度。 */
const SAVE_INTERVAL = 5

export function PlayerScreen({
  media,
  episode,
  playlist,
  startPosition,
  onSelectEpisode,
  onExit,
}: Props): JSX.Element {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const timeRef = useRef(0)
  const lastSavedRef = useRef(0)

  const [duration, setDuration] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [position, setPosition] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [subtitleName, setSubtitleName] = useState<string | null>(null)
  const [cues, setCues] = useState<SubtitleCue[]>([])
  const [currentCue, setCurrentCue] = useState<string | null>(null)
  const [settings, setSettings] = useState<DanmakuSettings>(() => loadSettings())
  const [anchor, setAnchor] = useState(startPosition)
  const [showSettings, setShowSettings] = useState(false)
  const [showBrightness, setShowBrightness] = useState(false)
  // null = 尚未读回（读取中）；[] = 确实一台都没有。两者不可混为一谈。
  const [displays, setDisplays] = useState<DisplayBrightness[] | null>(null)
  const [brightnessError, setBrightnessError] = useState<string | null>(null)

  // 在线片源：按集 token 现解析播放地址。null 表示自动选线。
  // 红果走 hongguo 适配器，其余远端（含看剧AI）默认 kanju。
  const remoteProvider = episode.source === 'hongguo' ? 'hongguo' : 'kanju'
  const isRemote =
    episode.source === 'kanju' || episode.source === 'hongguo' || (episode.episodeToken ?? '') !== ''
  const [resolvedSrc, setResolvedSrc] = useState<string | null>(null)
  const [resolving, setResolving] = useState(false)
  const [lines, setLines] = useState<RemoteLine[]>([])
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null)
  // 远端解析出的地址类型：mp4 直接喂 <video>，hls 交给 hls.js
  const [playbackKind, setPlaybackKind] = useState<'mp4' | 'hls' | null>(null)

  useEffect(() => {
    if (!isRemote) {
      setResolvedSrc(null)
      setLines([])
      setPlaybackKind(null)
      return
    }
    const token = episode.episodeToken ?? ''
    if (token === '') {
      setError('该集缺少解析 token，无法播放')
      return
    }
    let cancelled = false
    setResolving(true)
    setError(null)
    setResolvedSrc(null)
    void window.cinema
      .remoteResolve(remoteProvider, token, selectedLineId ?? undefined)
      .then((playback) => {
        if (cancelled) return
        setResolvedSrc(playback.url)
        setLines(playback.lines)
        setPlaybackKind(playback.urlKind)
      })
      .catch((cause: unknown) => {
        if (cancelled) return
        setError(`线路解析失败：${cause instanceof Error ? cause.message : String(cause)}`)
      })
      .finally(() => {
        if (!cancelled) setResolving(false)
      })
    return () => {
      cancelled = true
    }
  }, [isRemote, episode.episodeToken, episode.source, selectedLineId])

  const src = isRemote ? (resolvedSrc ?? '') : localMediaUrl(episode.filePath)

  // HLS：Chromium 不原生支持 m3u8，用 hls.js 走 MSE。mp4 直接由 <video src> 处理。
  useEffect(() => {
    const video = videoRef.current
    if (video === null) return
    if (src === '' || playbackKind !== 'hls') return
    if (!Hls.isSupported()) {
      setError('当前环境不支持 HLS 播放')
      return
    }
    const hls = new Hls({ enableWorker: true })
    hls.attachMedia(video)
    hls.on(Hls.Events.MEDIA_ATTACHED, () => hls.loadSource(src))
    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (data.fatal) setError(`HLS 播放失败：${data.details ?? data.type}`)
    })
    return () => {
      hls.destroy()
    }
  }, [src, playbackKind])


  // 演示弹幕：本地片源没有弹幕服务器，按 episodeId 生成确定性分布
  const danmakuItems = useMemo(
    () => seedDanmaku(media.id, episode.id, duration),
    [media.id, episode.id, duration],
  )
  const visibleDanmaku = useMemo(
    () => filterItems(danmakuItems, settings),
    [danmakuItems, settings],
  )

  const currentIndex = playlist.findIndex((item) => item.id === episode.id)
  const hasPrev = currentIndex > 0
  const hasNext = currentIndex >= 0 && currentIndex < playlist.length - 1

  // ==================== 进度落盘 ====================

  const saveProgress = useCallback(
    (at: number, total: number) => {
      if (total <= 0) return
      void window.cinema.saveProgress({
        mediaId: media.id,
        episodeId: episode.id,
        mediaTitle: media.title,
        episodeTitle: episode.title,
        episodeIndex: episode.index,
        position: at,
        duration: total,
        lastPlayedAt: new Date().toISOString(),
        completed: isCompleted(at, total),
      })
      lastSavedRef.current = at
    },
    [media.id, media.title, episode.id, episode.index, episode.title],
  )

  // ==================== 换集 / 卸载时保存 ====================

  useEffect(() => {
    const video = videoRef.current
    return () => {
      const total = video?.duration ?? 0
      const at = video?.currentTime ?? 0
      if (total > 0) saveProgress(at, total)
    }
  }, [saveProgress, episode.id])

  // ==================== 字幕 ====================

  useEffect(() => {
    let cancelled = false
    setCues([])
    setSubtitleName(null)
    setCurrentCue(null)

    // 在线片源没有本地同名字幕，跳过文件查找。
    if (isRemote) return

    void (async () => {
      const found = await window.cinema.findSubtitle(episode.filePath)
      if (cancelled || found === null) return
      setSubtitleName(found.name)
      setCues(parseSubtitle(found.content))
    })()

    return () => {
      cancelled = true
    }
  }, [episode.filePath, isRemote])

  const pickSubtitle = useCallback(async () => {
    const picked = await window.cinema.pickSubtitle()
    if (picked === null) return
    setSubtitleName(picked.name)
    setCues(parseSubtitle(picked.content))
  }, [])

  // MKV 等 WebView 不支持的容器：交给系统播放器（mpv/vlc）。
  const openExternal = useCallback(async () => {
    try {
      const player = await window.cinema.playExternal?.(episode.filePath)
      if (player !== undefined && player !== '') {
        setError(`已用外部播放器（${player}）打开：${episode.title}`)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [episode.filePath, episode.title])

  // ==================== 视频事件 ====================

  useEffect(() => {
    const video = videoRef.current
    if (video === null) return

    const onLoaded = (): void => {
      setDuration(video.duration)
      if (startPosition > 0.5 && startPosition < video.duration - 1) {
        video.currentTime = startPosition
        setAnchor(startPosition)
        // seek 生效前弹幕引擎必须锚在续播点，否则会倾倒前面的弹幕
        timeRef.current = startPosition
      }
      void video.play().catch(() => {
        // 自动播放被拦截：保持暂停，等用户点击播放
        setPlaying(false)
      })
    }

    const onTime = (): void => {
      timeRef.current = video.currentTime
      setPosition(video.currentTime)
      if (Math.abs(video.currentTime - lastSavedRef.current) >= SAVE_INTERVAL) {
        saveProgress(video.currentTime, video.duration)
      }
    }

    const onPlay = (): void => setPlaying(true)
    const onPause = (): void => {
      setPlaying(false)
      saveProgress(video.currentTime, video.duration)
    }
    const onEnded = (): void => {
      setPlaying(false)
      saveProgress(video.duration, video.duration)
      if (hasNext) onSelectEpisode(playlist[currentIndex + 1])
    }
    const onError = (): void => {
      // 把 <video> 的真实错误码带出来。桌面端最常见的失败是容器/编码不被 Chromium 支持
      // （MEDIA_ERR_SRC_NOT_SUPPORTED = 4，例如 MKV 的某些音轨），只显示片名无法定位。
      const code = video?.error?.code ?? 0
      const detail =
        code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED
          ? '（该容器或编码不被支持）'
          : code === MediaError.MEDIA_ERR_DECODE
            ? '（解码失败）'
            : code === MediaError.MEDIA_ERR_NETWORK
              ? '（读取中断）'
              : ''
      setError(
        `无法播放：${episode.title}${detail}${code > 0 ? ` [错误码 ${code}]` : ''}` +
          (isRemote ? '' : '（可点「外部播放」用系统播放器打开）'),
      )
      setPlaying(false)
    }

    video.addEventListener('loadedmetadata', onLoaded)
    video.addEventListener('timeupdate', onTime)
    video.addEventListener('play', onPlay)
    video.addEventListener('pause', onPause)
    video.addEventListener('ended', onEnded)
    video.addEventListener('error', onError)
    return () => {
      video.removeEventListener('loadedmetadata', onLoaded)
      video.removeEventListener('timeupdate', onTime)
      video.removeEventListener('play', onPlay)
      video.removeEventListener('pause', onPause)
      video.removeEventListener('ended', onEnded)
      video.removeEventListener('error', onError)
    }
  }, [currentIndex, episode.title, hasNext, isRemote, onSelectEpisode, playlist, saveProgress, startPosition])

  // 字幕：只在命中的 cue 变化时才 setState，避免每帧重渲染
  useEffect(() => {
    if (cues.length === 0) return
    let frame = 0
    let last: SubtitleCue | null = null
    const tick = (): void => {
      frame = requestAnimationFrame(tick)
      const next = cueAt(cues, timeRef.current)
      if (next !== last) {
        last = next
        setCurrentCue(next?.text ?? null)
      }
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [cues])

  // ==================== 交互 ====================

  const togglePlay = useCallback(() => {
    const video = videoRef.current
    if (video === null) return
    if (video.paused) void video.play()
    else video.pause()
  }, [])

  const seekBy = useCallback((delta: number) => {
    const video = videoRef.current
    if (video === null) return
    video.currentTime = Math.max(0, Math.min(video.duration || 0, video.currentTime + delta))
  }, [])

  const seekTo = useCallback((value: number) => {
    const video = videoRef.current
    if (video === null) return
    video.currentTime = value
    timeRef.current = value
    setPosition(value)
  }, [])

  // 键盘：空格播放 / ←→ 快退快进 / F 全屏
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.target instanceof HTMLInputElement) return
      switch (event.key) {
        case ' ':
          event.preventDefault()
          togglePlay()
          break
        case 'ArrowLeft':
          seekBy(-5)
          break
        case 'ArrowRight':
          seekBy(5)
          break
        case 'f':
        case 'F':
          void document.documentElement.requestFullscreen()
          break
        default:
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [seekBy, togglePlay])

  const updateSettings = useCallback((patch: Partial<DanmakuSettings>) => {
    setSettings((previous) => {
      const next = { ...previous, ...patch }
      saveSettings(next)
      return next
    })
  }, [])

  // ==================== 显示器亮度 ====================
  // 只在面板打开时枚举：DDC/CI 每次往返要上百毫秒（ddcutil 子进程），
  // 挂在挂载阶段会拖慢进播放页。

  const openBrightness = useCallback(() => {
    // 不把副作用写进 setState 的 updater —— StrictMode 下 updater 会被重复调用，
    // 等于每次开面板都发两遍 DDC/CI 枚举。
    if (showBrightness) {
      setShowBrightness(false)
      return
    }
    setShowBrightness(true)
    setBrightnessError(null)
    setDisplays(null)
    void window.cinema
      .listDisplays()
      .then(setDisplays)
      .catch((reason: unknown) => {
        setBrightnessError(reason instanceof Error ? reason.message : String(reason))
        setDisplays([])
      })
  }, [showBrightness])

  /**
   * 每台显示器最多一个写入在途。
   * DDC/CI 写一次要上百毫秒（i2c 往返），sysfs 虽然快但同样不接受逐帧直写；
   * 而拖动滑块产生事件的速度远高于硬件吞吐。逐个排队会让 IPC 队列越堆越长、
   * 窗口跟着卡。这里只保留「最新值」：在途写完后补发最后那个值，中间值直接丢弃 ——
   * 用户要的永远是松手时的亮度。节流节奏由硬件真实速度决定，不猜固定间隔。
   */
  const writesRef = useRef(new Map<string, { inFlight: boolean; pending: number | null }>())

  const flushBrightness = useCallback((id: string): void => {
    const slot = writesRef.current.get(id)
    if (slot === undefined || slot.inFlight || slot.pending === null) return
    const value = slot.pending
    slot.pending = null
    slot.inFlight = true
    void window.cinema
      .setBrightness(id, value)
      .then((result) => {
        if (!result.ok) setBrightnessError(result.reason)
      })
      .catch((reason: unknown) => {
        setBrightnessError(reason instanceof Error ? reason.message : String(reason))
      })
      .finally(() => {
        slot.inFlight = false
        // 拖动期间攒下的最新值在这里补发；microtask 里回调，不会累积调用栈。
        flushBrightness(id)
      })
  }, [])

  const changeBrightness = useCallback(
    (id: string, value: number) => {
      // 滑块立刻跟手；写硬件交给 flushBrightness 节流。写失败不把滑块弹回去，
      // 否则拖动过程会被慢速 DDC/CI 拉成锯齿。
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
      flushBrightness(id)
    },
    [flushBrightness],
  )

  return (
    <div className="player-screen">
      <div className="player-stage">
        <video
          ref={videoRef}
          src={playbackKind === 'hls' || src === '' ? undefined : src}
          className="player-video"
          onClick={togglePlay}
        />

        {settings.enabled && (
          <DanmakuCanvas
            items={visibleDanmaku}
            settings={settings}
            currentTimeRef={timeRef}
            anchor={anchor}
            loadKey={`${episode.id}:${danmakuItems.length}`}
          />
        )}

        {currentCue !== null && (
          <div className="subtitle-layer">
            {currentCue.split('\n').map((line, index) => (
              <div key={index} className="subtitle-line">
                {line}
              </div>
            ))}
          </div>
        )}

        {resolving && <div className="player-resolving">线路解析中…</div>}

        {error !== null && <div className="player-error">{error}</div>}

        {!playing && !resolving && error === null && (
          <button className="player-big-play" onClick={togglePlay} aria-label="播放">
            ▶
          </button>
        )}
      </div>

      <div className="player-bar">
        <div className="player-title">
          <span className="player-title-main">{media.title}</span>
          <span className="player-title-sub">{episode.title}</span>
        </div>

        {isRemote && lines.length > 1 && (
          <select
            className="player-line-select"
            value={selectedLineId ?? 'auto'}
            onChange={(event) =>
              setSelectedLineId(event.target.value === 'auto' ? null : event.target.value)
            }
            aria-label="播放线路"
          >
            <option value="auto">自动线路</option>
            {lines.map((line) => (
              <option key={line.id} value={line.id}>
                {line.label}
              </option>
            ))}
          </select>
        )}

        <input
          className="player-progress"
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={position}
          onChange={(event) => seekTo(Number(event.target.value))}
          aria-label="播放进度"
        />

        <div className="player-time">
          {formatTime(position)} / {formatTime(duration)}
        </div>

        <div className="player-actions">
          <button disabled={!hasPrev} onClick={() => onSelectEpisode(playlist[currentIndex - 1])}>
            上一集
          </button>
          <button disabled={!hasNext} onClick={() => onSelectEpisode(playlist[currentIndex + 1])}>
            下一集
          </button>
          <button onClick={() => updateSettings({ enabled: !settings.enabled })}>
            弹幕 {settings.enabled ? '开' : '关'}
          </button>
          <button onClick={() => setShowSettings((value) => !value)}>弹幕设置</button>
          <button onClick={openBrightness}>亮度</button>
          <button onClick={() => void pickSubtitle()}>
            字幕 {subtitleName === null ? '未加载' : ''}
          </button>
          {!isRemote && <button onClick={() => void openExternal()}>外部播放</button>}
          <button onClick={onExit}>返回</button>
        </div>
      </div>

      {showSettings && (
        <DanmakuSettingsPanel
          settings={settings}
          onChange={updateSettings}
          onClose={() => setShowSettings(false)}
        />
      )}

      {showBrightness && (
        <BrightnessPanel
          displays={displays}
          error={brightnessError}
          onChange={changeBrightness}
          onClose={() => setShowBrightness(false)}
        />
      )}
    </div>
  )
}

// ==================== 亮度面板 ====================

interface BrightnessPanelProps {
  /** null = 读取中 */
  displays: DisplayBrightness[] | null
  error: string | null
  onChange: (id: string, value: number) => void
  onClose: () => void
}

function BrightnessPanel({ displays, error, onChange, onClose }: BrightnessPanelProps): JSX.Element {
  return (
    <div className="danmaku-panel brightness-panel">
      <div className="danmaku-panel-head">
        <span>显示器亮度</span>
        <button onClick={onClose}>关闭</button>
      </div>

      {error !== null && <div className="brightness-error">{error}</div>}

      {displays === null && <div className="brightness-empty">正在读取显示器…</div>}

      {displays !== null && displays.length === 0 && error === null && (
        <div className="brightness-empty">没有检测到显示器</div>
      )}

      {(displays ?? []).map((display) => (
        <div key={display.id} className="brightness-row">
          <div className="brightness-name">
            {display.label}
            {display.primary && <span className="brightness-tag">主屏</span>}
          </div>
          {display.available ? (
            <input
              type="range"
              min={display.min}
              max={display.max}
              value={display.current}
              onChange={(event) => onChange(display.id, Number(event.target.value))}
              aria-label={`${display.label} 亮度`}
            />
          ) : (
            <div className="brightness-reason">{display.reason}</div>
          )}
        </div>
      ))}
    </div>
  )
}

// ==================== 弹幕设置面板 ====================

interface PanelProps {
  settings: DanmakuSettings
  onChange: (patch: Partial<DanmakuSettings>) => void
  onClose: () => void
}

function DanmakuSettingsPanel({ settings, onChange, onClose }: PanelProps): JSX.Element {
  return (
    <div className="danmaku-panel">
      <div className="danmaku-panel-head">
        <span>弹幕设置</span>
        <button onClick={onClose}>关闭</button>
      </div>

      <label>
        显示区域 {Math.round(settings.areaRatio * 100)}%
        <input
          type="range"
          min={25}
          max={100}
          value={Math.round(settings.areaRatio * 100)}
          onChange={(event) => onChange({ areaRatio: Number(event.target.value) / 100 })}
        />
      </label>

      <label>
        不透明度 {Math.round(settings.opacity * 100)}%
        <input
          type="range"
          min={20}
          max={100}
          value={Math.round(settings.opacity * 100)}
          onChange={(event) => onChange({ opacity: Number(event.target.value) / 100 })}
        />
      </label>

      <label>
        字号 {settings.fontScale.toFixed(1)}x
        <input
          type="range"
          min={70}
          max={150}
          value={Math.round(settings.fontScale * 100)}
          onChange={(event) => onChange({ fontScale: Number(event.target.value) / 100 })}
        />
      </label>

      <label>
        速度 {settings.speedFactor.toFixed(1)}x
        <input
          type="range"
          min={50}
          max={200}
          value={Math.round(settings.speedFactor * 100)}
          onChange={(event) => onChange({ speedFactor: Number(event.target.value) / 100 })}
        />
      </label>

      <div className="danmaku-panel-toggles">
        <label>
          <input
            type="checkbox"
            checked={settings.allowScroll}
            onChange={(event) => onChange({ allowScroll: event.target.checked })}
          />
          滚动
        </label>
        <label>
          <input
            type="checkbox"
            checked={settings.allowTop}
            onChange={(event) => onChange({ allowTop: event.target.checked })}
          />
          顶部
        </label>
        <label>
          <input
            type="checkbox"
            checked={settings.allowBottom}
            onChange={(event) => onChange({ allowBottom: event.target.checked })}
          />
          底部
        </label>
      </div>
    </div>
  )
}


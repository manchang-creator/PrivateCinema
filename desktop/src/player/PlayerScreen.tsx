// ==================== 播放页 ====================
// 主链路：视频解码 → 字幕叠加 → 弹幕渲染 → 进度续播。
// 时间轴只有一个真相源：`<video>` 元素。字幕与弹幕都读它，不各自计时。
//
// 控制层参考 B 站播放器：
//   - 底部一条：播放/暂停、上一集/下一集、音量、时间、进度、倍速、弹幕、字幕、线路、全屏；
//   - 顶部只在悬浮时出现（标题 + 返回 + 选集抽屉），不挡画面；
//   - 鼠标静止 2.4s 自动隐藏控制层与光标，播放页永远深色，不受浅色主题影响。

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type JSX } from 'react'
import Hls from 'hls.js'
import {
  isCompleted,
  type DanmakuItem,
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
import { useAutoNext, usePlayerMuted, usePlayerRate, usePlayerVolume } from '../lib/store'
import { Icon } from '../ui/icons'

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
const RATES: readonly number[] = [0.5, 0.75, 1, 1.25, 1.5, 2, 3]

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
  const [showPlaylist, setShowPlaylist] = useState(false)
  const [showRate, setShowRate] = useState(false)
  const [chrome, setChrome] = useState(true)
  const idleTimer = useRef<number>(0)
  // null = 尚未读回（读取中）；[] = 确实一台都没有。两者不可混为一谈。
  const [displays, setDisplays] = useState<DisplayBrightness[] | null>(null)
  const [brightnessError, setBrightnessError] = useState<string | null>(null)

  // 播放器记忆：音量 / 静音 / 倍速跨会话保留
  const [volume, setVolume] = usePlayerVolume()
  const [muted, setMuted] = usePlayerMuted()
  const [rate, setRate] = usePlayerRate()
  const [autoNext] = useAutoNext()
  const [fullscreen, setFullscreen] = useState(false)

  // 在线片源：按集 token 现解析播放地址。null 表示自动选线。
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

  // 红果有真实弹幕：进入/切换分集时异步拉取；拿不到再回退演示弹幕。
  const [remoteDanmaku, setRemoteDanmaku] = useState<DanmakuItem[]>([])
  useEffect(() => {
    let cancelled = false
    setRemoteDanmaku([])
    const episodeToken = episode.episodeToken ?? ''
    if (episode.source !== 'hongguo' || episodeToken === '') return
    void (async () => {
      try {
        const items = await window.cinema.remoteDanmaku('hongguo', media.id, episodeToken)
        if (!cancelled && items.length > 0) setRemoteDanmaku(items)
      } catch {
        // 拉取失败：保留空数组，下面自动回退演示弹幕
      }
    })()
    return () => {
      cancelled = true
    }
  }, [media.id, episode.id, episode.source, episode.episodeToken])

  // 演示弹幕兜底：本地/其它片源或红果拉不到时，按 episodeId 生成确定性分布。
  const danmakuItems = useMemo(
    () => (remoteDanmaku.length > 0 ? remoteDanmaku : seedDanmaku(media.id, episode.id, duration)),
    [remoteDanmaku, media.id, episode.id, duration],
  )
  const visibleDanmaku = useMemo(() => filterItems(danmakuItems, settings), [danmakuItems, settings])

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
      if (hasNext && autoNext) {
        onSelectEpisode(playlist[currentIndex + 1])
        return
      }
      if (hasNext) setShowPlaylist(true)
    }
    const onError = (): void => {
      // 把 <video> 的真实错误码带出来。桌面端最常见的失败是容器/编码不被 Chromium 支持
      // （MEDIA_ERR_SRC_NOT_SUPPORTED = 4），只显示片名无法定位。
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
  }, [
    autoNext,
    currentIndex,
    episode.title,
    hasNext,
    isRemote,
    onSelectEpisode,
    playlist,
    saveProgress,
    startPosition,
  ])

  // 音量 / 静音 / 倍速：记忆值回灌到 video
  useEffect(() => {
    const video = videoRef.current
    if (video === null) return
    video.volume = Math.max(0, Math.min(1, volume))
    video.muted = muted
    video.playbackRate = rate
  }, [volume, muted, rate, resolvedSrc])

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
    video.currentTime = Math.max(
      0,
      Math.min(video.duration || 0, video.currentTime + delta),
    )
  }, [])

  const seekTo = useCallback((value: number) => {
    const video = videoRef.current
    if (video === null) return
    video.currentTime = value
    timeRef.current = value
    setPosition(value)
  }, [])

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement === null) void document.documentElement.requestFullscreen()
    else void document.exitFullscreen()
  }, [])

  useEffect(() => {
    const onChange = (): void => setFullscreen(document.fullscreenElement !== null)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  // 键盘：空格播放 / ←→ 快退快进 / ↑↓ 音量 / F 全屏 / M 静音 / Esc 返回
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
        case 'ArrowUp':
          event.preventDefault()
          setVolume(Math.min(1, Number((volume + 0.05).toFixed(2))))
          break
        case 'ArrowDown':
          event.preventDefault()
          setVolume(Math.max(0, Number((volume - 0.05).toFixed(2))))
          break
        case 'f':
        case 'F':
          toggleFullscreen()
          break
        case 'm':
        case 'M':
          setMuted(!muted)
          break
        default:
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [seekBy, togglePlay, toggleFullscreen, volume, muted, setVolume, setMuted])

  // 鼠标静止 → 收起控制层（暂停时始终显示）
  const wake = useCallback(() => {
    setChrome(true)
    window.clearTimeout(idleTimer.current)
    idleTimer.current = window.setTimeout(() => {
      setChrome(false)
      setShowRate(false)
    }, 2400)
  }, [])

  useEffect(() => {
    if (!playing) {
      setChrome(true)
      window.clearTimeout(idleTimer.current)
      return
    }
    wake()
    return () => window.clearTimeout(idleTimer.current)
  }, [playing, wake])

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
    // 不把副作用写进 setState 的 updater —— StrictMode 下 updater 会被重复调用。
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
   * 每台显示器最多一个写入在途。DDC/CI 写一次要上百毫秒，而拖动滑块的速度远高于
   * 硬件吞吐，队列会越堆越长。这里只保留「最新值」：在途写完后补发最后那个值。
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
        flushBrightness(id)
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
      flushBrightness(id)
    },
    [flushBrightness],
  )

  const playedPercent = duration > 0 ? Math.max(0, Math.min(100, (position / duration) * 100)) : 0
  const controlsVisible = chrome && !resolving && error === null

  return (
    <div
      className={chrome ? 'player-screen' : 'player-screen idle'}
      onMouseMove={wake}
      onMouseLeave={() => setChrome(false)}
    >
      <div className={controlsVisible ? 'player-stage' : 'player-stage bare'}>
        <video
          ref={videoRef}
          src={playbackKind === 'hls' || src === '' ? undefined : src}
          className="player-video"
          onClick={togglePlay}
          onDoubleClick={toggleFullscreen}
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

        {error !== null && (
          <div className="player-error">
            <Icon name="info" size={18} />
            <span>{error}</span>
            {!isRemote && (
              <button type="button" className="btn-glass small" onClick={() => void openExternal()}>
                <Icon name="expand" size={14} />
                外部播放
              </button>
            )}
          </div>
        )}

        {!playing && !resolving && error === null && (
          <button className="player-big-play" onClick={togglePlay} aria-label="播放">
            <Icon name="play" size={32} />
          </button>
        )}
      </div>

      {/* 顶部：返回 + 标题（悬浮显隐） */}
      {controlsVisible && (
        <div className="player-top">
          <div className="player-top-left">
            <button
              type="button"
              className="player-back"
              onClick={onExit}
              aria-label="返回片库"
              title="返回片库"
            >
              <Icon name="arrow-left" size={18} />
            </button>
            <div className="player-top-title">
              <b>{media.title}</b>
              <span>{episode.title}</span>
            </div>
          </div>

          <div className="player-cluster">
            <button
              type="button"
              className={showPlaylist ? 'icon-btn on' : 'icon-btn'}
              title="选集"
              aria-label="选集"
              onClick={() => setShowPlaylist(!showPlaylist)}
            >
              <Icon name="layers" size={17} />
              <span>选集</span>
            </button>
          </div>
        </div>
      )}

      {/* 底部控制条：B 站式一条排开 */}
      {controlsVisible && (
        <div className="player-bottom">
          <div className="player-scrub">
            <input
              className="player-progress"
              type="range"
              min={0}
              max={duration || 0}
              step={0.1}
              value={position}
              style={{ '--played': `${playedPercent}%` } as CSSProperties}
              onChange={(event) => seekTo(Number(event.target.value))}
              aria-label="播放进度"
            />
          </div>

          <div className="player-controls">
            <div className="player-controls-left">
              <button
                type="button"
                className="control-btn"
                disabled={!hasPrev}
                aria-label="上一集"
                onClick={() => onSelectEpisode(playlist[currentIndex - 1])}
              >
                <Icon name="skip-back" size={17} />
              </button>
              <button
                type="button"
                className="control-btn primary"
                onClick={togglePlay}
                aria-label={playing ? '暂停' : '播放'}
              >
                <Icon name={playing ? 'pause' : 'play'} size={20} />
              </button>
              <button
                type="button"
                className="control-btn"
                disabled={!hasNext}
                aria-label="下一集"
                onClick={() => onSelectEpisode(playlist[currentIndex + 1])}
              >
                <Icon name="skip-forward" size={17} />
              </button>

              <div className="player-volume">
                <button
                  type="button"
                  className="control-btn"
                  aria-label={muted ? '取消静音' : '静音'}
                  onClick={() => setMuted(!muted)}
                >
                  <Icon name={muted || volume === 0 ? 'volume-mute' : 'volume'} size={17} />
                </button>
                <input
                  type="range"
                  className="volume-range"
                  min={0}
                  max={100}
                  value={Math.round((muted ? 0 : volume) * 100)}
                  aria-label="音量"
                  onChange={(event) => {
                    const next = Number(event.target.value) / 100
                    setVolume(next)
                    if (next > 0) setMuted(false)
                  }}
                />
              </div>

              <span className="player-time">
                {formatTime(position)} <i>/</i> {formatTime(duration)}
              </span>
            </div>

            <div className="player-controls-right">
              <div className="rate-wrap">
                <button
                  type="button"
                  className="control-btn text"
                  onClick={() => setShowRate(!showRate)}
                  aria-label="倍速"
                >
                  {rate === 1 ? '倍速' : `${rate}x`}
                </button>
                {showRate && (
                  <div className="rate-menu" role="menu">
                    {RATES.map((value) => (
                      <button
                        key={value}
                        type="button"
                        role="menuitemradio"
                        aria-checked={rate === value}
                        className={rate === value ? 'rate-item active' : 'rate-item'}
                        onClick={() => {
                          setRate(value)
                          setShowRate(false)
                        }}
                      >
                        {value === 1 ? '正常' : `${value}x`}
                      </button>
                    ))}
                  </div>
                )}
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

              <button
                type="button"
                className={settings.enabled ? 'control-btn on' : 'control-btn'}
                title={settings.enabled ? '关闭弹幕' : '开启弹幕'}
                aria-label="弹幕开关"
                onClick={() => updateSettings({ enabled: !settings.enabled })}
              >
                <Icon name="danmaku" size={17} />
              </button>
              <button
                type="button"
                className={showSettings ? 'control-btn on' : 'control-btn'}
                title="弹幕设置"
                aria-label="弹幕设置"
                onClick={() => setShowSettings(!showSettings)}
              >
                <Icon name="settings" size={17} />
              </button>
              <button
                type="button"
                className="control-btn"
                title={`字幕：${subtitleName ?? '未加载'}`}
                aria-label="选择字幕"
                onClick={() => void pickSubtitle()}
              >
                <Icon name="subtitles" size={17} />
              </button>
              <button
                type="button"
                className={showBrightness ? 'control-btn on' : 'control-btn'}
                title="显示器亮度"
                aria-label="显示器亮度"
                onClick={openBrightness}
              >
                <Icon name="brightness" size={17} />
              </button>
              {!isRemote && (
                <button
                  type="button"
                  className="control-btn"
                  title="用系统播放器打开"
                  aria-label="外部播放"
                  onClick={() => void openExternal()}
                >
                  <Icon name="expand" size={16} />
                </button>
              )}
              <button
                type="button"
                className="control-btn"
                title={fullscreen ? '退出全屏（F）' : '全屏（F）'}
                aria-label="全屏"
                onClick={toggleFullscreen}
              >
                <Icon name={fullscreen ? 'shrink' : 'expand'} size={17} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 选集抽屉 */}
      {showPlaylist && (
        <div className="player-drawer" role="dialog" aria-label="选集">
          <div className="player-drawer-head">
            <span>选集</span>
            <span className="player-drawer-count">共 {playlist.length} 集</span>
            <button type="button" onClick={() => setShowPlaylist(false)} aria-label="关闭选集">
              <Icon name="close" size={15} />
            </button>
          </div>
          <div className="player-drawer-grid">
            {playlist.map((item) => (
              <button
                key={item.id}
                type="button"
                className={item.id === episode.id ? 'episode-button active' : 'episode-button'}
                onClick={() => {
                  onSelectEpisode(item)
                  setShowPlaylist(false)
                }}
              >
                {item.title}
              </button>
            ))}
          </div>
        </div>
      )}

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

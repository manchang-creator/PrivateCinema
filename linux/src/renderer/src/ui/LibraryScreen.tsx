// ==================== 片库页 ====================
// 两个入口：选文件 / 选文件夹。扫描在主进程完成，这里只负责展示与选择。

import { useCallback, useEffect, useState, type CSSProperties, type JSX } from 'react'
import type { Episode, MediaItem, WatchProgress } from '@private-cinema/core/shared'
import { formatSize, formatTime } from '@private-cinema/core/ui'
import { OnlineLibrary } from './OnlineLibrary'
import { BrightnessMenu } from './BrightnessMenu'
import { ThemeMenu } from './ThemeMenu'

interface Props {
  items: MediaItem[]
  episodes: Episode[]
  onScan: (scan: { items: MediaItem[]; episodes: Episode[] }) => void
  onPlay: (media: MediaItem, episode: Episode, startPosition: number, playlist?: Episode[]) => void
}

/** 取标题首字作为封面字（中英文都可），空标题兜底为问号。 */
function monogram(title: string): string {
  const trimmed = title.trim()
  return trimmed === '' ? '?' : (Array.from(trimmed)[0] ?? '?')
}

/** 由标题稳定生成一个深色渐变，作为无海报时的封面底色。 */
function coverTint(seed: string): CSSProperties {
  let hue = 0
  for (const ch of seed) hue = (hue * 31 + (ch.codePointAt(0) ?? 0)) % 360
  return {
    background: `linear-gradient(135deg, hsl(${hue} 44% 34%), hsl(${(hue + 48) % 360} 42% 14%))`,
  }
}

function percentOf(position: number, duration: number): number {
  if (duration <= 0) return 0
  return Math.max(0, Math.min(100, Math.round((position / duration) * 100)))
}

export function LibraryScreen({ items, episodes, onScan, onPlay }: Props): JSX.Element {
  const [tab, setTab] = useState<'local' | 'online'>('local')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<WatchProgress[]>([])

  const refreshProgress = useCallback(async () => {
    setProgress(await window.cinema.listProgress())
  }, [])

  useEffect(() => {
    void refreshProgress()
  }, [refreshProgress])

  const scan = useCallback(
    async (mode: 'files' | 'folder') => {
      setBusy(true)
      setError(null)
      try {
        const result =
          mode === 'files' ? await window.cinema.pickVideos() : await window.cinema.pickFolder()
        if (result === null) return
        if (result.items.length === 0) {
          setError('没有找到可播放的视频文件（支持 mp4 / m4v / mov / mkv / webm）')
          return
        }
        onScan(result)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : '扫描失败')
      } finally {
        setBusy(false)
      }
    },
    [onScan],
  )

  const playEpisode = useCallback(
    (media: MediaItem, episode: Episode) => {
      const record = progress.find(
        (entry) => entry.mediaId === media.id && entry.episodeId === episode.id,
      )
      onPlay(media, episode, record?.position ?? 0)
    },
    [onPlay, progress],
  )

  return (
    <div className="library-screen">
      <header className="library-head">
        <div className="brand">
          <span className="brand-dot" aria-hidden="true" />
          <h1>PrivateCinema</h1>
        </div>
        <div className="library-tabs" role="tablist" aria-label="片库来源">
          <button
            role="tab"
            aria-selected={tab === 'local'}
            className={tab === 'local' ? 'library-tab active' : 'library-tab'}
            onClick={() => setTab('local')}
          >
            本地片库
          </button>
          <button
            role="tab"
            aria-selected={tab === 'online'}
            className={tab === 'online' ? 'library-tab active' : 'library-tab'}
            onClick={() => setTab('online')}
          >
            在线片库
          </button>
        </div>
        <div className="library-actions">
          <BrightnessMenu />
          <ThemeMenu />
          {tab === 'local' && (
            <>
              <button disabled={busy} onClick={() => void scan('files')}>
                选择视频文件
              </button>
              <button className="btn-primary" disabled={busy} onClick={() => void scan('folder')}>
                选择文件夹
              </button>
            </>
          )}
        </div>
      </header>

      {tab === 'online' && <OnlineLibrary onPlay={onPlay} />}

      {tab === 'local' && (
        <>
          {error !== null && <div className="library-error">{error}</div>}

          {progress.length > 0 && (
            <section className="library-section">
              <h2>继续观看</h2>
              <div className="continue-list">
                {progress.slice(0, 6).map((record) => {
                  const media = items.find((item) => item.id === record.mediaId)
                  const episode = episodes.find((item) => item.id === record.episodeId)
                  const pct = percentOf(record.position, record.duration)
                  const remaining = Math.max(0, record.duration - record.position)
                  return (
                    <button
                      key={`${record.mediaId}:${record.episodeId}`}
                      className="continue-card"
                      disabled={media === undefined || episode === undefined}
                      onClick={() => {
                        if (media !== undefined && episode !== undefined) {
                          onPlay(media, episode, record.position)
                        }
                      }}
                    >
                      <span className="continue-cover" style={coverTint(record.mediaTitle)}>
                        {monogram(record.mediaTitle)}
                      </span>
                      <span className="continue-body">
                        <span className="continue-title">{record.mediaTitle}</span>
                        <span className="continue-sub">{record.episodeTitle}</span>
                        <span className="continue-track">
                          <span className="continue-track-fill" style={{ width: `${pct}%` }} />
                        </span>
                        <span className="continue-meta">
                          <span>
                            {formatTime(record.position)} / {formatTime(record.duration)}
                          </span>
                          <span>{record.completed ? '已看完' : `剩余 ${formatTime(remaining)}`}</span>
                        </span>
                      </span>
                    </button>
                  )
                })}
              </div>
            </section>
          )}

          <section className="library-section">
            <h2>片库 {items.length > 0 && `（${items.length}）`}</h2>
            {items.length === 0 ? (
              <p className="library-empty">还没有内容。点击上方按钮选择本地视频或文件夹。</p>
            ) : (
              <div className="media-grid">
                {items.map((media) => {
                  const own = episodes
                    .filter((episode) => episode.mediaId === media.id)
                    .sort((a, b) => a.seasonIndex - b.seasonIndex || a.index - b.index)
                  const kindLabel = media.kind === 'movie' ? '电影' : `剧集 · ${own.length} 集`
                  return (
                    <article key={media.id} className="media-card">
                      <div className="media-cover" style={coverTint(media.title)}>
                        <span className="media-cover-initial">{monogram(media.title)}</span>
                        <span className="media-kind">{kindLabel}</span>
                      </div>
                      <div className="media-body">
                        <h3>{media.title}</h3>
                        <p className="media-meta">
                          {media.year > 0 ? media.year : ''}
                          {media.sizeBytes ? ` · ${formatSize(media.sizeBytes)}` : ''}
                        </p>
                        <div className="media-episodes">
                          {own.map((episode) => {
                            const record = progress.find(
                              (entry) =>
                                entry.mediaId === media.id && entry.episodeId === episode.id,
                            )
                            const percent = percentOf(record?.position ?? 0, record?.duration ?? 0)
                            return (
                              <button
                                key={episode.id}
                                className="episode-button"
                                onClick={() => playEpisode(media, episode)}
                                title={episode.filePath}
                              >
                                {episode.title}
                                {percent > 0 && <span className="episode-progress">{percent}%</span>}
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    </article>
                  )
                })}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}

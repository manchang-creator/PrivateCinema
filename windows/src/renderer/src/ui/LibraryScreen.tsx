// ==================== 片库页 ====================
// 两个入口：选文件 / 选文件夹。扫描在主进程完成，这里只负责展示与选择。

import { useCallback, useEffect, useState, type JSX } from 'react'
import type { Episode, MediaItem, WatchProgress } from '@private-cinema/core/shared'
import { formatSize, formatTime } from '@private-cinema/core/ui'
import { OnlineLibrary } from './OnlineLibrary'

interface Props {
  items: MediaItem[]
  episodes: Episode[]
  onScan: (scan: { items: MediaItem[]; episodes: Episode[] }) => void
  onPlay: (media: MediaItem, episode: Episode, startPosition: number, playlist?: Episode[]) => void
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
        <h1>PrivateCinema</h1>
        <div className="library-tabs">
          <button
            className={tab === 'local' ? 'library-tab active' : 'library-tab'}
            onClick={() => setTab('local')}
          >
            本地片库
          </button>
          <button
            className={tab === 'online' ? 'library-tab active' : 'library-tab'}
            onClick={() => setTab('online')}
          >
            在线片库
          </button>
        </div>
        {tab === 'local' && (
          <div className="library-actions">
            <button disabled={busy} onClick={() => void scan('files')}>
              选择视频文件
            </button>
            <button disabled={busy} onClick={() => void scan('folder')}>
              选择文件夹
            </button>
          </div>
        )}
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
                  <span className="continue-title">{record.mediaTitle}</span>
                  <span className="continue-sub">{record.episodeTitle}</span>
                  <span className="continue-progress">
                    {formatTime(record.position)} / {formatTime(record.duration)}
                    {record.completed ? ' · 已看完' : ''}
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
              return (
                <article key={media.id} className="media-card">
                  <h3>{media.title}</h3>
                  <p className="media-meta">
                    {media.kind === 'movie' ? '电影' : `剧集 · ${own.length} 集`}
                    {media.sizeBytes ? ` · ${formatSize(media.sizeBytes)}` : ''}
                  </p>
                  <div className="media-episodes">
                    {own.map((episode) => {
                      const record = progress.find(
                        (entry) =>
                          entry.mediaId === media.id && entry.episodeId === episode.id,
                      )
                      const percent =
                        record === undefined || record.duration <= 0
                          ? 0
                          : Math.round((record.position / record.duration) * 100)
                      return (
                        <button
                          key={episode.id}
                          className="episode-button"
                          onClick={() => playEpisode(media, episode)}
                          title={episode.filePath}
                        >
                          {episode.title}
                          {percent > 0 && (
                            <span className="episode-progress">{percent}%</span>
                          )}
                        </button>
                      )
                    })}
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

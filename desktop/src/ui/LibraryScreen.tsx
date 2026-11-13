// ==================== 片库页 ====================
// 参考 cezzu 的影院首页：悬浮玻璃顶栏 → 主推 Hero → 继续观看横排 → 海报网格。
// 本地条目点开详情弹层选集；扫描仍在主进程完成，这里只展示与选择。

import { useCallback, useEffect, useMemo, useState, type CSSProperties, type JSX } from 'react'
import type { Episode, MediaItem, WatchProgress } from '@private-cinema/core/shared'
import { formatSize, formatTime } from '@private-cinema/core/ui'
import { OnlineLibrary } from './OnlineLibrary'
import { DisplayMenu } from './DisplayMenu'
import { Icon } from './icons'
import { Rail } from './Rail'
import { ambientVars, backdropGradient, posterGradient } from './palette'

interface Props {
  items: MediaItem[]
  episodes: Episode[]
  onScan: (scan: { items: MediaItem[]; episodes: Episode[] }) => void
  onPlay: (media: MediaItem, episode: Episode, startPosition: number, playlist?: Episode[]) => void
}

function monogram(title: string): string {
  const trimmed = title.trim()
  return trimmed === '' ? '?' : (Array.from(trimmed)[0] ?? '?')
}

function percentOf(position: number, duration: number): number {
  if (duration <= 0) return 0
  return Math.max(0, Math.min(100, Math.round((position / duration) * 100)))
}

function kindLabel(kind: MediaItem['kind']): string {
  switch (kind) {
    case 'movie':
      return '电影'
    case 'series':
      return '剧集'
    case 'anime':
      return '动漫'
    case 'variety':
      return '综艺'
    default:
      return '影片'
  }
}

function sortEpisodes(list: Episode[]): Episode[] {
  return [...list].sort((a, b) => a.seasonIndex - b.seasonIndex || a.index - b.index)
}

export function LibraryScreen({ items, episodes, onScan, onPlay }: Props): JSX.Element {
  const [tab, setTab] = useState<'local' | 'online'>('local')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<WatchProgress[]>([])
  const [detail, setDetail] = useState<MediaItem | null>(null)

  const refreshProgress = useCallback(async () => {
    setProgress(await window.cinema.listProgress())
  }, [])

  useEffect(() => {
    void refreshProgress()
  }, [refreshProgress])

  // 从播放页返回后，进度可能已更新
  useEffect(() => {
    if (tab === 'local') void refreshProgress()
  }, [tab, refreshProgress])

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

  // ==================== 主推 Hero（轮播，P2） ====================
  const [heroIndex, setHeroIndex] = useState(0)
  const safeHeroIndex = items.length === 0 ? 0 : heroIndex % items.length
  const featured = items.length === 0 ? null : (items[safeHeroIndex] ?? null)

  // 片库变化（重新扫描）时回到第一条
  useEffect(() => {
    setHeroIndex(0)
  }, [items.length])

  // 自动轮播：多部作品时每 7s 换一条主推
  useEffect(() => {
    if (items.length <= 1) return
    const timer = setInterval(() => {
      setHeroIndex((current) => (current + 1) % items.length)
    }, 7000)
    return () => clearInterval(timer)
  }, [items.length])

  const featuredEpisodes = useMemo(
    () => (featured === null ? [] : sortEpisodes(episodes.filter((e) => e.mediaId === featured.id))),
    [episodes, featured],
  )
  const featuredRecord = useMemo(
    () => (featured === null ? undefined : progress.find((p) => p.mediaId === featured.id)),
    [featured, progress],
  )

  const ambientSeed = featured?.title ?? 'PrivateCinema'

  const continueRecords = useMemo(() => {
    const valid = progress.filter(
      (record) =>
        items.some((item) => item.id === record.mediaId) &&
        episodes.some((item) => item.id === record.episodeId),
    )
    // 已看完的沉到末尾；未看完的保持原有（最近优先）顺序，首条走大卡
    const active = valid.filter((record) => !record.completed)
    const done = valid.filter((record) => record.completed)
    return [...active, ...done].slice(0, 14)
  }, [progress, items, episodes])

  const playFeatured = useCallback(() => {
    if (featured === null || featuredEpisodes.length === 0) return
    const record = featuredRecord
    const episode =
      record === undefined
        ? featuredEpisodes[0]
        : (featuredEpisodes.find((e) => e.id === record.episodeId) ?? featuredEpisodes[0])
    onPlay(featured, episode, record?.position ?? 0)
  }, [featured, featuredEpisodes, featuredRecord, onPlay])

  const detailEpisodes = useMemo(
    () => (detail === null ? [] : sortEpisodes(episodes.filter((e) => e.mediaId === detail.id))),
    [detail, episodes],
  )
  const detailRecord = useMemo(
    () => (detail === null ? undefined : progress.find((p) => p.mediaId === detail.id)),
    [detail, progress],
  )

  return (
    <div className="app-shell" style={ambientVars(ambientSeed)}>
      <div className="ambient" aria-hidden="true" />
      <div className="screen">
        <div className="screen-inner">
          <header className="topbar">
            <div className="topbar-bg" aria-hidden="true" />
            <div className="brand">
              <span className="brand-mark" aria-hidden="true">
                <Icon name="play" size={15} />
              </span>
              <span className="brand-name">
                Private<b>Cinema</b>
              </span>
            </div>

            <nav className="topnav" role="tablist" aria-label="片库来源">
              <button
                role="tab"
                aria-selected={tab === 'local'}
                className={tab === 'local' ? 'topnav-item active' : 'topnav-item'}
                onClick={() => setTab('local')}
              >
                <Icon name="grid" size={16} />
                本地片库
              </button>
              <button
                role="tab"
                aria-selected={tab === 'online'}
                className={tab === 'online' ? 'topnav-item active' : 'topnav-item'}
                onClick={() => setTab('online')}
              >
                <Icon name="layers" size={16} />
                在线片库
              </button>
            </nav>

            <div className="topbar-actions">
              <DisplayMenu />
              {tab === 'local' && (
                <>
                  <button className="icon-btn" disabled={busy} onClick={() => void scan('files')}>
                    <Icon name="file" size={16} />
                    <span>选择文件</span>
                  </button>
                  <button className="btn-primary" disabled={busy} onClick={() => void scan('folder')}>
                    <Icon name="folder" size={16} />
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

              {featured !== null && (
                <section className="hero" aria-label="主推内容">
                  <div className="hero-inner" key={featured.id}>
                    <div className="hero-poster" style={posterGradient(featured.title)}>
                      <div className="hero-poster-art">
                        {monogram(featured.title)}
                        <span className="hero-poster-num">
                          {kindLabel(featured.kind)}
                          {featured.kind !== 'movie' && featuredEpisodes.length > 0
                            ? ` · ${featuredEpisodes.length} 集`
                            : ''}
                        </span>
                      </div>
                    </div>

                    <div className="hero-info">
                      <div className="hero-eyebrow">
                        <span className="chip solid">{kindLabel(featured.kind)}</span>
                        {featured.year > 0 && <span className="chip">{featured.year}</span>}
                        <span className="chip">本地片库</span>
                        {featured.kind !== 'movie' && featuredEpisodes.length > 0 && (
                          <span className="chip">全 {featuredEpisodes.length} 集</span>
                        )}
                      </div>

                      <h1 className="hero-title">{featured.title}</h1>

                      <p className="hero-summary">
                        {featured.overview.trim() !== ''
                          ? featured.overview
                          : `私人影院收藏 · ${kindLabel(featured.kind)}${
                              featured.year > 0 ? ` · ${featured.year}` : ''
                            }。选择下方任意一集即可开始播放。`}
                      </p>

                      <div className="hero-facts">
                        {featured.sizeBytes !== undefined && featured.sizeBytes > 0 && (
                          <span className="fact">
                            <Icon name="info" size={14} />
                            {formatSize(featured.sizeBytes)}
                          </span>
                        )}
                        {featured.kind !== 'movie' && featuredEpisodes.length > 0 && (
                          <span className="fact">
                            <Icon name="layers" size={14} />
                            {featuredEpisodes.length} 集
                          </span>
                        )}
                        <span className="fact">
                          <Icon name="clock" size={14} />
                          {featuredEpisodes.length > 0 ? '可播放' : '暂无剧集'}
                        </span>
                      </div>

                      <div className="hero-actions">
                        <button
                          className="btn-primary"
                          disabled={featuredEpisodes.length === 0}
                          onClick={playFeatured}
                        >
                          <Icon name="play" size={16} />
                          {featuredRecord !== undefined ? '继续观看' : '立即观看'}
                        </button>
                        <button className="btn-glass" onClick={() => setDetail(featured)}>
                          <Icon name="info" size={16} />
                          查看详情
                        </button>
                      </div>

                      {items.length > 1 && (
                        <div className="hero-pager" role="tablist" aria-label="主推轮播">
                          {items.slice(0, 10).map((item, index) => (
                            <button
                              key={item.id}
                              role="tab"
                              aria-selected={index === safeHeroIndex}
                              aria-label={`切换主推到 ${item.title}`}
                              className={
                                index === safeHeroIndex ? 'hero-dot active' : 'hero-dot'
                              }
                              onClick={() => setHeroIndex(index)}
                            />
                          ))}
                        </div>
                      )}

                      {featuredEpisodes.length > 1 && (
                        <div className="quick-strip" aria-label="快速选集">
                          {featuredEpisodes.slice(0, 8).map((episode, index) => (
                            <button
                              key={episode.id}
                              className={
                                index === 0 && featuredRecord === undefined
                                  ? 'quick-tile active'
                                  : 'quick-tile'
                              }
                              style={posterGradient(`${featured.title}-${episode.index}`)}
                              title={episode.title}
                              onClick={() => {
                                const record = progress.find(
                                  (entry) =>
                                    entry.mediaId === featured.id && entry.episodeId === episode.id,
                                )
                                onPlay(featured, episode, record?.position ?? 0)
                              }}
                            >
                              {episode.index}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </section>
              )}

              {continueRecords.length > 0 && (
                <section className="section">
                  <div className="section-head">
                    <h2 className="section-title">继续观看</h2>
                    <span className="section-en">Continue Watching</span>
                  </div>
                  <Rail>
                    {continueRecords.map((record, index) => {
                      const media = items.find((item) => item.id === record.mediaId)
                      const episode = episodes.find((item) => item.id === record.episodeId)
                      const pct = percentOf(record.position, record.duration)
                      const remaining = Math.max(0, record.duration - record.position)
                      return (
                        <button
                          key={`${record.mediaId}:${record.episodeId}`}
                          className={index === 0 ? 'cw-card cw-card-lg' : 'cw-card'}
                          disabled={media === undefined || episode === undefined}
                          onClick={() => {
                            if (media !== undefined && episode !== undefined) {
                              onPlay(media, episode, record.position)
                            }
                          }}
                        >
                          <span className="cw-cover" style={posterGradient(record.mediaTitle)}>
                            <span className="cw-cover-art">{monogram(record.mediaTitle)}</span>
                            <span className="cw-cover-scrim" aria-hidden="true" />
                            <span className="cw-play" aria-hidden="true">
                              <Icon name="play" size={18} />
                            </span>
                            <span className="cw-progress" aria-hidden="true">
                              <span className="cw-progress-fill" style={{ width: `${pct}%` }} />
                            </span>
                          </span>
                          <span className="cw-title">{record.mediaTitle}</span>
                          <span className="cw-meta">
                            {record.episodeTitle} ·{' '}
                            {record.completed
                              ? '已看完'
                              : `剩余 ${formatTime(remaining)}`}
                          </span>
                        </button>
                      )
                    })}
                  </Rail>
                </section>
              )}

              <section className="section">
                <div className="section-head">
                  <h2 className="section-title">我的片库</h2>
                  <span className="section-en">Library</span>
                  {items.length > 0 && <span className="section-sub">{items.length} 部作品</span>}
                </div>
                {items.length === 0 ? (
                  <div className="empty-state">
                    <span className="empty-icon">
                      <Icon name="folder" size={30} />
                    </span>
                    <h3>片库还是空的</h3>
                    <p>点击右上角「选择文件夹」或「选择文件」，把本地影片加入私人影院。</p>
                  </div>
                ) : (
                  <div className="media-grid">
                    {items.map((media) => {
                      const own = sortEpisodes(episodes.filter((e) => e.mediaId === media.id))
                      const subtitle = [
                        media.year > 0 ? String(media.year) : '',
                        media.kind === 'movie' ? '电影' : `${own.length} 集`,
                        media.sizeBytes !== undefined && media.sizeBytes > 0
                          ? formatSize(media.sizeBytes)
                          : '',
                      ]
                        .filter((part) => part !== '')
                        .join(' · ')
                      return (
                        <button
                          key={media.id}
                          className="media-card"
                          onClick={() => setDetail(media)}
                        >
                          <span className="poster" style={posterGradient(media.title)}>
                            <span className="poster-art">{monogram(media.title)}</span>
                            <span className="poster-scrim" aria-hidden="true" />
                            <span className="poster-play" aria-hidden="true">
                              <Icon name="play" size={16} />
                            </span>
                            <span className="poster-badge">
                              {media.kind === 'movie' ? '电影' : `剧集 · ${own.length} 集`}
                            </span>
                          </span>
                          <span className="media-title">{media.title}</span>
                          <span className="media-sub">{subtitle}</span>
                        </button>
                      )
                    })}
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </div>

      {detail !== null && (
        <div className="modal-mask" onClick={() => setDetail(null)}>
          <div
            className="detail-modal"
            role="dialog"
            aria-modal="true"
            style={backdropGradient(detail.title) as CSSProperties}
            onClick={(event) => event.stopPropagation()}
          >
            <button className="detail-close" aria-label="关闭" onClick={() => setDetail(null)}>
              <Icon name="close" size={18} />
            </button>

            <div className="detail-hero">
              <div className="detail-poster" style={posterGradient(detail.title)}>
                <div className="detail-poster-art">{monogram(detail.title)}</div>
              </div>
              <div className="detail-info">
                <div className="detail-facts">
                  <span className="chip solid">{kindLabel(detail.kind)}</span>
                  {detail.year > 0 && <span className="chip">{detail.year}</span>}
                  {detailEpisodes.length > 0 && (
                    <span className="chip">共 {detailEpisodes.length} 集</span>
                  )}
                  {detail.sizeBytes !== undefined && detail.sizeBytes > 0 && (
                    <span className="chip">{formatSize(detail.sizeBytes)}</span>
                  )}
                </div>
                <h2 className="detail-title">{detail.title}</h2>
                <p className="detail-summary">
                  {detail.overview.trim() !== '' ? detail.overview : '暂无简介'}
                </p>
                <div className="detail-actions">
                  <button
                    className="btn-primary"
                    disabled={detailEpisodes.length === 0}
                    onClick={() => {
                      if (detailEpisodes.length === 0) return
                      const episode =
                        detailRecord === undefined
                          ? detailEpisodes[0]
                          : (detailEpisodes.find((e) => e.id === detailRecord.episodeId) ??
                            detailEpisodes[0])
                      onPlay(detail, episode, detailRecord?.position ?? 0)
                      setDetail(null)
                    }}
                  >
                    <Icon name="play" size={15} />
                    {detailRecord !== undefined ? '继续观看' : '播放第一集'}
                  </button>
                  <button className="btn-glass" onClick={() => setDetail(null)}>
                    关闭
                  </button>
                </div>
              </div>
            </div>

            {detailEpisodes.length > 0 && (
              <div className="detail-body">
                <div className="detail-section-head">
                  <h3>选集</h3>
                  <span>共 {detailEpisodes.length} 集</span>
                </div>
                <div className="episode-grid">
                  {detailEpisodes.map((episode) => {
                    const record = progress.find(
                      (entry) => entry.mediaId === detail.id && entry.episodeId === episode.id,
                    )
                    const percent = percentOf(record?.position ?? 0, record?.duration ?? 0)
                    return (
                      <button
                        key={episode.id}
                        className="episode-button"
                        title={episode.filePath}
                        onClick={() => {
                          playEpisode(detail, episode)
                          setDetail(null)
                        }}
                      >
                        {episode.title}
                        {percent > 0 && <span className="episode-progress">{percent}%</span>}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

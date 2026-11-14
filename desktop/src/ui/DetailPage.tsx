// ==================== 详情页 ====================
// 参考腾讯视频 / B 站番剧页：整页沉浸式背景 + 左侧竖版封面 + 右侧标题/评分/简介/主演，
// 下面是「选集」分组与「相关推荐」，右侧固定操作栏（收藏 / 分享 / 播放）。
// 详情页是独立路由（不是弹层），返回键回到来源页，符合桌面端使用习惯。

import { useCallback, useEffect, useMemo, useState, type JSX } from 'react'
import type { Episode, MediaItem, RemoteCard, RemoteDetail, RemoteEpisode } from '@private-cinema/core/shared'
import { formatSize } from '@private-cinema/core/ui'
import { kindLabel, sortEpisodes } from '../lib/media-kit'
import { ensureDetail, getMeta, rememberDetail } from '../lib/remote-cache'
import type { DetailTarget } from '../lib/router'
import { useFavorites } from '../lib/store'
import { PosterCard, proxiedPoster } from './PosterCard'
import { Rail, SectionHead } from './Rail'
import { Icon } from './icons'
import { accentVars, backdropGradient, posterGradient } from './palette'

interface Props {
  target: DetailTarget
  items: MediaItem[]
  episodes: Episode[]
  onPlayLocal: (media: MediaItem, episode: Episode, position: number) => void
  onPlayRemote: (
    provider: string,
    card: RemoteCard,
    episodes: ReadonlyArray<{ id: string; number: number; title: string; token: string }>,
    startIndex: number,
  ) => void
  onOpenDetail: (target: DetailTarget) => void
  onBack: () => void
}

interface LocalProgressLite {
  episodeId: string
  position: number
  duration: number
}

export function DetailPage({
  target,
  items,
  episodes,
  onPlayLocal,
  onPlayRemote,
  onOpenDetail,
  onBack,
}: Props): JSX.Element {
  const favorites = useFavorites()
  const [detail, setDetail] = useState<RemoteDetail | null>(null)
  const [remoteEpisodes, setRemoteEpisodes] = useState<RemoteEpisode[]>([])
  const [related, setRelated] = useState<RemoteCard[]>([])
  const [loading, setLoading] = useState(target.source === 'remote')
  const [error, setError] = useState<string | null>(null)
  const [progressMap, setProgressMap] = useState<Record<string, LocalProgressLite>>({})
  const [season, setSeason] = useState(0)

  const localMedia = useMemo(
    () => (target.source === 'local' ? items.find((item) => item.id === target.id) : undefined),
    [items, target],
  )
  const localEpisodes = useMemo(
    () => (localMedia === undefined ? [] : sortEpisodes(episodes.filter((e) => e.mediaId === localMedia.id))),
    [episodes, localMedia],
  )

  // 本地进度：每集看哪儿（用于选集按钮上的百分比）
  useEffect(() => {
    if (target.source !== 'local') return
    void window.cinema
      .listProgress()
      .then((list) => {
        const map: Record<string, LocalProgressLite> = {}
        for (const record of list) {
          if (record.mediaId !== target.id) continue
          map[record.episodeId] = {
            episodeId: record.episodeId,
            position: record.position,
            duration: record.duration,
          }
        }
        setProgressMap(map)
      })
      .catch(() => setProgressMap({}))
  }, [target])

  // 远端详情 + 选集 + 相关推荐
  useEffect(() => {
    if (target.source !== 'remote') return
    const provider = target.provider === 'hongguo' ? 'hongguo' : 'kanju'
    let cancelled = false
    setLoading(true)
    setError(null)
    setDetail(null)
    setRemoteEpisodes([])
    setRelated([])
    void Promise.all([
      ensureDetail(provider, target.id),
      window.cinema.remoteEpisodes(provider, target.id).catch(() => [] as RemoteEpisode[]),
    ])
      .then(([detailResult, episodeResult]) => {
        if (cancelled) return
        if (detailResult !== null) {
          setDetail(detailResult)
          rememberDetail(provider, detailResult)
        }
        setRemoteEpisodes(episodeResult)
        if (detailResult === null && episodeResult.length === 0) {
          setError('详情加载失败，可能是片源接口波动，稍后再试。')
        }
        // 相关推荐：拿详情里的类型词去搜，取前若干条（失败就空着，不报错）
        const keyword = (detailResult?.genres[0] ?? detailResult?.kind ?? '').toString()
        if (keyword !== '') {
          void window.cinema
            .remoteSearch(provider, keyword, 1)
            .then((page) => {
              if (cancelled) return
              setRelated(page.cards.filter((card) => card.id !== target.id).slice(0, 12))
            })
            .catch(() => undefined)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [target])

  const title = detail?.title ?? localMedia?.title ?? target.title
  const cover = detail?.posterUrl ?? target.cover
  const overview =
    detail?.overview ?? localMedia?.overview ?? '这部作品还没有简介，先把名字和集数记在这里。'
  const kinds = detail?.genres ?? localMedia?.genres ?? []
  const year = detail?.year ?? localMedia?.year ?? 0
  const kind = detail?.kind ?? localMedia?.kind ?? 'movie'
  const area = detail?.area ?? ''
  const remarks = detail?.remarks ?? localMedia?.remarks ?? ''
  const actors = detail?.actors ?? []

  // 选集总数 & 首个未看完的集（「继续观看」按钮的目标）
  const episodeCount =
    target.source === 'local' ? localEpisodes.length : remoteEpisodes.length
  const resumeIndex = useMemo(() => {
    if (target.source === 'local') {
      const position = localEpisodes.findIndex((episode) => {
        const record = progressMap[episode.id]
        return record !== undefined && record.duration > 0 && record.position / record.duration < 0.98
      })
      return position < 0 ? 0 : position
    }
    return 0
  }, [localEpisodes, progressMap, target.source])

  const playAt = useCallback(
    (index: number) => {
      if (target.source === 'local') {
        const episode = localEpisodes[index]
        if (episode === undefined || localMedia === undefined) return
        onPlayLocal(localMedia, episode, progressMap[episode.id]?.position ?? 0)
        return
      }
      const card: RemoteCard = {
        id: target.id,
        title,
        kind,
        year,
        area,
        genres: kinds,
        remarks,
        posterUrl: cover,
      }
      onPlayRemote(target.provider, card, remoteEpisodes, index)
    },
    [
      area,
      cover,
      kind,
      kinds,
      localEpisodes,
      localMedia,
      onPlayLocal,
      onPlayRemote,
      progressMap,
      remarks,
      remoteEpisodes,
      target,
      title,
      year,
    ],
  )

  const favorite = favorites.has(target.id)
  const coverStyle = cover === '' ? posterGradient(title) : {}

  // 封面统一走 proxiedPoster：HEIC 由后端转 JPEG；同时给详情页补上「加载失败」兜底 ——
  // 百度的图床 gimg0.baidu.com 偶发 302/限流，且 webp 直连在旧 WebKit 上会失败，
  // 之前这里只显示一块空白底色，看起来像「没有封面」。
  const posterSrc = proxiedPoster(cover)
  const [posterBroken, setPosterBroken] = useState(false)

  // 多季作品：按 seasonIndex 分组（本地常见）
  const seasons = useMemo(() => {
    if (target.source !== 'local') return []
    const map = new Map<number, Episode[]>()
    for (const episode of localEpisodes) {
      const list = map.get(episode.seasonIndex) ?? []
      list.push(episode)
      map.set(episode.seasonIndex, list)
    }
    return [...map.entries()].sort((a, b) => a[0] - b[0])
  }, [localEpisodes, target.source])

  const seasonEpisodes = seasons.length > 1 ? (seasons[season]?.[1] ?? []) : localEpisodes

  return (
    <div className="page detail-page" style={{ ...backdropGradient(title), ...accentVars(title) }}>
      <div className="detail-backdrop" aria-hidden="true">
        {posterSrc !== '' && !posterBroken && (
          <img src={posterSrc} alt="" referrerPolicy="no-referrer" />
        )}
        <span className="detail-backdrop-veil" />
      </div>

      <div className="page-inner detail-inner">
        <button type="button" className="detail-back" onClick={onBack}>
          <Icon name="arrow-left" size={16} />
          返回
        </button>

        <div className="detail-hero">
          <div className="detail-poster" style={coverStyle}>
            {posterSrc === '' || posterBroken ? (
              <span className="detail-poster-fallback" aria-hidden="true">
                <span className="detail-poster-letter">{title.slice(0, 1)}</span>
                <span className="detail-poster-note">{posterBroken ? '封面加载失败' : '暂无海报'}</span>
              </span>
            ) : (
              <img
                src={posterSrc}
                alt={title}
                referrerPolicy="no-referrer"
                onError={() => setPosterBroken(true)}
              />
            )}
            <span className="detail-poster-badge">{kindLabel(kind)}</span>
          </div>

          <div className="detail-info">
            <h1 className="detail-title">{title}</h1>

            <div className="detail-tags">
              {remarks !== '' && <span className="tag solid">{remarks}</span>}
              {year > 0 && <span className="tag">{year}</span>}
              {area !== '' && <span className="tag">{area}</span>}
              <span className="tag">{kindLabel(kind)}</span>
              {episodeCount > 0 && <span className="tag">共 {episodeCount} 集</span>}
              {localMedia?.sizeBytes !== undefined && localMedia.sizeBytes > 0 && (
                <span className="tag">{formatSize(localMedia.sizeBytes)}</span>
              )}
            </div>

            <p className="detail-overview">{overview}</p>

            {kinds.length > 0 && (
              <p className="detail-line">
                <span className="detail-line-key">类型</span>
                {kinds.slice(0, 8).join(' / ')}
              </p>
            )}
            {actors.length > 0 && (
              <p className="detail-line">
                <span className="detail-line-key">主演</span>
                {actors.slice(0, 8).join(' / ')}
              </p>
            )}
            {target.source === 'local' && (
              <p className="detail-line">
                <span className="detail-line-key">来源</span>
                本地文件 · {localEpisodes.length} 集
              </p>
            )}

            <div className="detail-actions">
              <button
                type="button"
                className="btn-primary"
                disabled={episodeCount === 0}
                onClick={() => playAt(resumeIndex)}
              >
                <Icon name="play" size={16} />
                {resumeIndex > 0 ? '继续观看' : '立即播放'}
              </button>
              <button
                type="button"
                className={favorite ? 'btn-glass on' : 'btn-glass'}
                onClick={() =>
                  favorites.toggle({
                    id: target.id,
                    title,
                    cover,
                    kind,
                    source: target.source === 'local' ? 'local' : target.provider,
                  })
                }
              >
                <Icon name={favorite ? 'heart-filled' : 'heart'} size={16} />
                {favorite ? '已追' : '追剧'}
              </button>
            </div>
          </div>
        </div>

        {error !== null && <div className="notice error">{error}</div>}
        {loading && <div className="notice">正在加载详情…</div>}

        {episodeCount > 0 && (
          <section className="section">
            <SectionHead
              title="选集"
              sub={`共 ${episodeCount} 集`}
              action={
                seasons.length > 1 ? (
                  <div className="seg">
                    {seasons.map(([index], position) => (
                      <button
                        key={index}
                        type="button"
                        className={position === season ? 'seg-item active' : 'seg-item'}
                        onClick={() => setSeason(position)}
                      >
                        第 {index + 1} 季
                      </button>
                    ))}
                  </div>
                ) : undefined
              }
            />
            <div className="episode-grid">
              {(target.source === 'local' ? seasonEpisodes : remoteEpisodes).map((episode, position) => {
                const record =
                  target.source === 'local'
                    ? progressMap[(episode as Episode).id]
                    : undefined
                const pct =
                  record !== undefined && record.duration > 0
                    ? Math.min(100, Math.round((record.position / record.duration) * 100))
                    : 0
                return (
                  <button
                    key={episode.id}
                    type="button"
                    className={pct > 0 && pct < 98 ? 'episode-button watching' : 'episode-button'}
                    onClick={() => playAt(position)}
                  >
                    {(episode as Episode).title ?? (episode as RemoteEpisode).title}
                    {pct > 0 && <span className="episode-percent">{pct}%</span>}
                  </button>
                )
              })}
            </div>
          </section>
        )}

        {related.length > 0 && (
          <section className="section">
            <SectionHead title="相关推荐" sub="按类型匹配" />
            <Rail>
              {related.map((card) => (
                <PosterCard
                  key={card.id}
                  title={card.title}
                  cover={card.posterUrl}
                  tag={card.remarks}
                  sub={[card.year > 0 ? String(card.year) : '', card.area].filter(Boolean).join(' · ')}
                  onClick={() =>
                    onOpenDetail({
                      source: 'remote',
                      provider: target.provider,
                      id: card.id,
                      title: card.title,
                      cover: card.posterUrl,
                    })
                  }
                />
              ))}
            </Rail>
          </section>
        )}
      </div>
    </div>
  )
}

/** 远端详情服务端偶发缺字段：这里给出可用的兜底元数据。 */
export function fallbackMeta(provider: string, card: RemoteCard): string {
  return getMeta(provider, card.id)?.title ?? card.title
}

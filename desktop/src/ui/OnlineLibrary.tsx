// ==================== 在线片库（多片源）====================
// 数据全部经主进程代理（看剧AI 另需签名），这里只负责展示与交互：
// 片源切换 / 分类/搜索 → Hero + 分区货架 → 详情弹层（选集）→ 交给 App 进入播放。

import {
  REMOTE_PROVIDERS,
  type Episode,
  type MediaItem,
  type MediaKind,
  type RemoteCard,
  type RemoteDetail,
  type RemoteEpisode,
  type RemoteHomeData,
  type RemoteProviderId,
} from '@private-cinema/core/shared'
import { useCallback, useEffect, useState, type CSSProperties, type JSX } from 'react'
import { Icon } from './icons'
import { Rail } from './Rail'
import { ambientVars, backdropGradient, posterGradient } from './palette'

interface Props {
  onPlay: (media: MediaItem, episode: Episode, startPosition: number, playlist?: Episode[]) => void
}

const KIND_TABS: ReadonlyArray<{ key: MediaKind | null; label: string }> = [
  { key: null, label: '推荐' },
  { key: 'movie', label: '电影' },
  { key: 'series', label: '电视剧' },
  { key: 'anime', label: '动漫' },
  { key: 'variety', label: '综艺' },
]

const PROVIDER_KINDS: Record<
  RemoteProviderId,
  ReadonlyArray<{ key: MediaKind | null; label: string }>
> = {
  kanju: KIND_TABS,
  hongguo: [{ key: null, label: '推荐' }],
}

function messageOf(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback
}

function kindText(kind: MediaKind): string {
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

export function OnlineLibrary({ onPlay }: Props): JSX.Element {
  const [provider, setProvider] = useState<RemoteProviderId>('kanju')
  const [home, setHome] = useState<RemoteHomeData | null>(null)
  const [mode, setMode] = useState<'home' | 'results'>('home')
  const [results, setResults] = useState<RemoteCard[]>([])
  const [heading, setHeading] = useState('')
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [kind, setKind] = useState<MediaKind | null>(null)
  const [keyword, setKeyword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 首页 Hero 轮播：在首屏推荐位之间自动切换（P2）
  const [heroIndex, setHeroIndex] = useState(0)

  const [active, setActive] = useState<RemoteCard | null>(null)
  const [detail, setDetail] = useState<RemoteDetail | null>(null)
  const [episodes, setEpisodes] = useState<RemoteEpisode[]>([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)

  const loadHome = useCallback(async (prov: RemoteProviderId) => {
    setLoading(true)
    setError(null)
    try {
      const data = await window.cinema.remoteHome(prov)
      setHome(data)
      setMode('home')
      setKind(null)
      setKeyword('')
      setResults([])
    } catch (cause) {
      setHome(null)
      setError(messageOf(cause, '在线首页加载失败'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadHome(provider)
  }, [provider, loadHome])

  const loadPage = useCallback(
    async (target: { kind: MediaKind | null; keyword: string }, nextPage: number) => {
      setLoading(true)
      setError(null)
      try {
        const data =
          target.keyword.trim() !== ''
            ? await window.cinema.remoteSearch(provider, target.keyword.trim(), nextPage)
            : await window.cinema.remoteBrowse(provider, target.kind, nextPage)
        setResults((previous) => (nextPage === 1 ? data.cards : [...previous, ...data.cards]))
        setPage(data.page)
        setHasMore(data.hasMore)
        setMode('results')
      } catch (cause) {
        setError(messageOf(cause, '加载失败'))
      } finally {
        setLoading(false)
      }
    },
    [provider],
  )

  const chooseKind = useCallback(
    (nextKind: MediaKind | null) => {
      setKind(nextKind)
      setKeyword('')
      if (nextKind === null) {
        setMode('home')
        setError(null)
        setResults([])
        return
      }
      const label = PROVIDER_KINDS[provider].find((tab) => tab.key === nextKind)?.label ?? '分类'
      setHeading(label)
      void loadPage({ kind: nextKind, keyword: '' }, 1)
    },
    [loadPage, provider],
  )

  const submitSearch = useCallback(() => {
    const trimmed = keyword.trim()
    if (trimmed === '') {
      chooseKind(null)
      return
    }
    setHeading(`搜索：${trimmed}`)
    void loadPage({ kind: null, keyword: trimmed }, 1)
  }, [chooseKind, keyword, loadPage])

  const loadMore = useCallback(() => {
    void loadPage({ kind, keyword }, page + 1)
  }, [kind, keyword, loadPage, page])

  const switchProvider = useCallback((next: RemoteProviderId) => {
    setProvider((current) => (current === next ? current : next))
    setMode('home')
    setKind(null)
    setKeyword('')
    setResults([])
    setError(null)
  }, [])

  const openCard = useCallback(
    async (card: RemoteCard) => {
      setActive(card)
      setDetail(null)
      setEpisodes([])
      setDetailError(null)
      setDetailLoading(true)
      try {
        const [detailResult, episodeResult] = await Promise.all([
          window.cinema.remoteDetail(provider, card.id).catch(() => null),
          window.cinema.remoteEpisodes(provider, card.id),
        ])
        setDetail(detailResult)
        setEpisodes(episodeResult)
        if (episodeResult.length === 0) setDetailError('该作品暂无可用选集')
      } catch (cause) {
        setDetailError(messageOf(cause, '详情加载失败'))
      } finally {
        setDetailLoading(false)
      }
    },
    [provider],
  )

  const playEpisode = useCallback(
    (episode: RemoteEpisode) => {
      const card = active
      if (card === null) return
      const title = detail?.title ?? card.title
      const media: MediaItem = {
        id: card.id,
        title,
        kind: detail?.kind ?? card.kind,
        year: detail?.year ?? card.year,
        genres: detail?.genres ?? card.genres,
        durationMinutes: 0,
        overview: detail?.overview ?? '',
        source: provider,
        posterUrl: detail?.posterUrl ?? card.posterUrl,
        remarks: detail?.remarks ?? card.remarks,
        episodeCount: detail?.episodeCount ?? episodes.length,
      }
      const playlist: Episode[] = episodes.map((item) => ({
        id: item.id,
        mediaId: card.id,
        seasonIndex: 0,
        index: item.number,
        title: item.title,
        duration: 0,
        filePath: '',
        source: provider,
        episodeToken: item.token,
      }))
      const target = playlist.find((item) => item.id === episode.id)
      if (target === undefined) return
      onPlay(media, target, 0, playlist)
    },
    [active, detail, episodes, onPlay, provider],
  )

  const homeSections = home?.sections ?? []
  const featuredCards = homeSections[0]?.cards ?? []
  const safeHeroIndex = featuredCards.length === 0 ? 0 : heroIndex % featuredCards.length
  const heroCard = featuredCards[safeHeroIndex]

  // 首页数据换掉时回到第一条
  useEffect(() => {
    setHeroIndex(0)
  }, [home])

  // 自动轮播：只在首页、且有多条推荐时运行
  useEffect(() => {
    if (mode !== 'home' || featuredCards.length <= 1) return
    const timer = setInterval(() => {
      setHeroIndex((current) => (current + 1) % featuredCards.length)
    }, 6500)
    return () => clearInterval(timer)
  }, [mode, featuredCards.length, home])

  const renderCard = (card: RemoteCard): JSX.Element => (
    <button key={card.id} className="media-card" onClick={() => void openCard(card)}>
      <span className="poster" style={posterGradient(card.title)}>
        <span className="poster-art">{card.title.slice(0, 1)}</span>
        {card.posterUrl !== '' && (
          <img
            className="poster-img"
            src={card.posterUrl}
            alt={card.title}
            loading="lazy"
            onError={(event) => {
              event.currentTarget.style.display = 'none'
            }}
          />
        )}
        <span className="poster-scrim" aria-hidden="true" />
        <span className="poster-play" aria-hidden="true">
          <Icon name="play" size={16} />
        </span>
        {card.remarks !== '' && <span className="poster-badge">{card.remarks}</span>}
      </span>
      <span className="media-title">{card.title}</span>
      <span className="media-sub">
        {[card.year > 0 ? String(card.year) : '', card.area, kindText(card.kind)]
          .filter((part) => part !== '')
          .join(' · ')}
      </span>
    </button>
  )

  const firstEpisode = episodes[0]

  return (
    <div className="online">
      {/* P1 工具栏合并：片源 / 搜索 / 分类压成一行，窄屏自动换行 */}
      <div className="online-toolbar">
        <div className="seg" role="tablist" aria-label="在线片源">
          {REMOTE_PROVIDERS.map((item) => (
            <button
              key={item.id}
              role="tab"
              aria-selected={provider === item.id}
              className={provider === item.id ? 'seg-item active' : 'seg-item'}
              title={item.description}
              onClick={() => switchProvider(item.id)}
            >
              {item.name}
            </button>
          ))}
        </div>

        <form
          className="search-bar"
          onSubmit={(event) => {
            event.preventDefault()
            submitSearch()
          }}
        >
          <Icon name="search" size={17} />
          <input
            className="search-input"
            value={keyword}
            placeholder={provider === 'hongguo' ? '搜索短剧 / 漫剧' : '搜索电影 / 电视剧 / 动漫 / 综艺'}
            onChange={(event) => setKeyword(event.target.value)}
          />
          <button type="submit" className="search-submit" disabled={loading}>
            搜索
          </button>
          <button
            type="button"
            className="search-refresh"
            aria-label="刷新首页"
            disabled={loading}
            onClick={() => void loadHome(provider)}
          >
            <Icon name="refresh" size={16} />
          </button>
        </form>

        <div className="seg seg-kinds" role="tablist" aria-label="分类">
          {PROVIDER_KINDS[provider].map((tab) => (
            <button
              key={tab.label}
              role="tab"
              aria-selected={kind === tab.key && mode !== 'home'}
              className={kind === tab.key && mode !== 'home' ? 'seg-item active' : 'seg-item'}
              onClick={() => chooseKind(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {error !== null && <div className="library-error">{error}</div>}
      {loading && <div className="online-loading">加载中…</div>}

      {mode === 'home' && heroCard !== undefined && (
        <section className="hero" aria-label="主推内容" style={ambientVars(heroCard.title)}>
          <div className="hero-inner" key={heroCard.id}>
            <button
              className="hero-poster"
              style={posterGradient(heroCard.title)}
              onClick={() => void openCard(heroCard)}
              aria-label={`查看 ${heroCard.title} 详情`}
            >
              <div className="hero-poster-art">
                {heroCard.title.slice(0, 1)}
                {heroCard.posterUrl !== '' && (
                  <img
                    src={heroCard.posterUrl}
                    alt={heroCard.title}
                    onError={(event) => {
                      event.currentTarget.style.display = 'none'
                    }}
                  />
                )}
                <span className="hero-poster-num">{kindText(heroCard.kind)}</span>
              </div>
            </button>

            <div className="hero-info">
              <div className="hero-eyebrow">
                <span className="chip solid">{kindText(heroCard.kind)}</span>
                {heroCard.year > 0 && <span className="chip">{heroCard.year}</span>}
                {heroCard.area !== '' && <span className="chip">{heroCard.area}</span>}
                {heroCard.remarks !== '' && <span className="chip">{heroCard.remarks}</span>}
              </div>

              <h1 className="hero-title">{heroCard.title}</h1>

              <p className="hero-summary">
                {heroCard.genres.length > 0
                  ? `${heroCard.area !== '' ? heroCard.area + ' · ' : ''}${heroCard.genres.join(' / ')}。点击查看完整详情与选集。`
                  : '点击查看完整详情与选集。'}
              </p>

              <div className="hero-actions">
                <button className="btn-primary" onClick={() => void openCard(heroCard)}>
                  <Icon name="play" size={16} />
                  立即观看
                </button>
                <button className="btn-glass" onClick={() => void openCard(heroCard)}>
                  <Icon name="info" size={16} />
                  查看详情
                </button>
              </div>

              {featuredCards.length > 1 && (
                <div className="quick-strip" aria-label="快速浏览">
                  {featuredCards.slice(0, 8).map((card, index) => (
                    <button
                      key={card.id}
                      className={index === safeHeroIndex ? 'quick-tile active' : 'quick-tile'}
                      style={posterGradient(card.title)}
                      title={card.title}
                      onClick={() => setHeroIndex(index)}
                    >
                      {card.posterUrl !== '' && (
                        <img
                          src={card.posterUrl}
                          alt={card.title}
                          style={{
                            position: 'absolute',
                            inset: 0,
                            width: '100%',
                            height: '100%',
                            objectFit: 'cover',
                            zIndex: 1,
                          }}
                          onError={(event) => {
                            event.currentTarget.style.display = 'none'
                          }}
                        />
                      )}
                      <span style={{ position: 'relative', zIndex: 0 }}>{card.title.slice(0, 1)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {mode === 'home' && home !== null && (
        <div>
          {home.sections.map((section, index) => (
            <section key={section.id} className="section remote-section">
              <div className="section-head">
                <h2 className="section-title">{section.title}</h2>
                {section.subtitle !== '' && <span className="section-en">{section.subtitle}</span>}
              </div>
              {/* P2 货架分档：首个热门区用大卡 + 常显翻页 + 自动轮播，其余用标准卡 */}
              <Rail
                className={index === 0 ? 'rail-lg' : undefined}
                alwaysNav={index === 0}
                autoPlayMs={index === 0 ? 6000 : undefined}
              >
                {section.cards.map(renderCard)}
              </Rail>
            </section>
          ))}
        </div>
      )}

      {mode === 'results' && (
        <section className="section">
          <div className="section-head results-head">
            <h2 className="section-title">{heading}</h2>
            <span className="section-en">Results</span>
            <span className="section-sub">{results.length} 部</span>
          </div>
          {results.length === 0 && !loading ? (
            <div className="empty-state">
              <span className="empty-icon">
                <Icon name="search" size={28} />
              </span>
              <h3>没有找到相关内容</h3>
              <p>换个关键词或切换片源再试试。</p>
            </div>
          ) : (
            <div className="media-grid">{results.map(renderCard)}</div>
          )}
          {hasMore && (
            <div className="online-loading" style={{ textAlign: 'center', marginTop: 22 }}>
              <button className="btn-glass" disabled={loading} onClick={loadMore}>
                <Icon name="refresh" size={15} />
                加载更多
              </button>
            </div>
          )}
        </section>
      )}

      {active !== null && (
        <div className="modal-mask" onClick={() => setActive(null)}>
          <div
            className="detail-modal"
            role="dialog"
            aria-modal="true"
            style={backdropGradient(detail?.title ?? active.title) as CSSProperties}
            onClick={(event) => event.stopPropagation()}
          >
            <button className="detail-close" aria-label="关闭" onClick={() => setActive(null)}>
              <Icon name="close" size={18} />
            </button>

            <div className="detail-hero">
              <div className="detail-poster" style={posterGradient(detail?.title ?? active.title)}>
                <div className="detail-poster-art">
                  {active.title.slice(0, 1)}
                  {(detail?.posterUrl ?? active.posterUrl) !== '' && (
                    <img
                      src={detail?.posterUrl ?? active.posterUrl}
                      alt={active.title}
                      onError={(event) => {
                        event.currentTarget.style.display = 'none'
                      }}
                    />
                  )}
                </div>
              </div>

              <div className="detail-info">
                <div className="detail-facts">
                  <span className="chip solid">{kindText(detail?.kind ?? active.kind)}</span>
                  {(detail?.year ?? active.year) > 0 && (
                    <span className="chip">{detail?.year ?? active.year}</span>
                  )}
                  {(detail?.area ?? active.area) !== '' && (
                    <span className="chip">{detail?.area ?? active.area}</span>
                  )}
                  {(detail?.remarks ?? active.remarks) !== '' && (
                    <span className="chip">{detail?.remarks ?? active.remarks}</span>
                  )}
                  {episodes.length > 0 && <span className="chip">共 {episodes.length} 集</span>}
                </div>

                <h2 className="detail-title">{detail?.title ?? active.title}</h2>

                {(detail?.genres ?? active.genres).length > 0 && (
                  <div className="detail-facts">
                    {(detail?.genres ?? active.genres).slice(0, 8).map((genre) => (
                      <span key={genre} className="chip">
                        {genre}
                      </span>
                    ))}
                  </div>
                )}

                <p className="detail-summary">
                  {detail?.overview !== undefined && detail.overview !== ''
                    ? detail.overview
                    : '暂无简介'}
                </p>

                {detail !== null && detail.actors.length > 0 && (
                  <p className="detail-summary" style={{ WebkitLineClamp: 2 }}>
                    演员：{detail.actors.slice(0, 8).join(' / ')}
                  </p>
                )}

                <div className="detail-actions">
                  {firstEpisode !== undefined ? (
                    <button className="btn-primary" onClick={() => playEpisode(firstEpisode)}>
                      <Icon name="play" size={15} />
                      播放第 1 集
                    </button>
                  ) : (
                    <button className="btn-primary" disabled>
                      <Icon name="play" size={15} />
                      播放
                    </button>
                  )}
                  <button className="btn-glass" onClick={() => setActive(null)}>
                    关闭
                  </button>
                </div>
              </div>
            </div>

            {detailError !== null && (
              <div className="detail-body">
                <div className="library-error">{detailError}</div>
              </div>
            )}
            {detailLoading && (
              <div className="detail-body">
                <div className="online-loading">选集加载中…</div>
              </div>
            )}

            {episodes.length > 0 && (
              <div className="detail-body">
                <div className="detail-section-head">
                  <h3>选集</h3>
                  <span>共 {episodes.length} 集</span>
                </div>
                <div className="episode-grid">
                  {episodes.map((episode) => (
                    <button
                      key={episode.id}
                      className="episode-button"
                      onClick={() => playEpisode(episode)}
                    >
                      {episode.title}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

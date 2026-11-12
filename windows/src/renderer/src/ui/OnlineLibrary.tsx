// ==================== 在线片库（看剧AI）====================
// 数据全部经主进程签名代理，这里只负责展示与交互：
// 分类/搜索 → 卡片网格 → 详情弹层（选集）→ 交给 App 进入播放。
// 播放地址不在这里解析：进入播放页后由 PlayerScreen 按集 token 现解析。

import { useCallback, useEffect, useState, type JSX } from 'react'
import type {
  Episode,
  MediaItem,
  MediaKind,
  RemoteCard,
  RemoteDetail,
  RemoteEpisode,
  RemoteHomeData,
} from '@private-cinema/core/shared'

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

function messageOf(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback
}

export function OnlineLibrary({ onPlay }: Props): JSX.Element {
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

  const [active, setActive] = useState<RemoteCard | null>(null)
  const [detail, setDetail] = useState<RemoteDetail | null>(null)
  const [episodes, setEpisodes] = useState<RemoteEpisode[]>([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)

  const loadHome = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await window.cinema.remoteHome()
      setHome(data)
      setMode('home')
      setKind(null)
      setKeyword('')
    } catch (cause) {
      setError(messageOf(cause, '在线首页加载失败'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadHome()
  }, [loadHome])

  const loadPage = useCallback(
    async (target: { kind: MediaKind | null; keyword: string }, nextPage: number) => {
      setLoading(true)
      setError(null)
      try {
        const data =
          target.keyword.trim() !== ''
            ? await window.cinema.remoteSearch(target.keyword.trim(), nextPage)
            : await window.cinema.remoteBrowse(target.kind, nextPage)
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
    [],
  )

  const chooseKind = useCallback(
    (nextKind: MediaKind | null) => {
      setKind(nextKind)
      setKeyword('')
      if (nextKind === null) {
        setMode('home')
        setError(null)
        return
      }
      const label = KIND_TABS.find((tab) => tab.key === nextKind)?.label ?? '分类'
      setHeading(label)
      void loadPage({ kind: nextKind, keyword: '' }, 1)
    },
    [loadPage],
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

  const openCard = useCallback(async (card: RemoteCard) => {
    setActive(card)
    setDetail(null)
    setEpisodes([])
    setDetailError(null)
    setDetailLoading(true)
    try {
      const [detailResult, episodeResult] = await Promise.all([
        window.cinema.remoteDetail(card.id).catch(() => null),
        window.cinema.remoteEpisodes(card.id),
      ])
      setDetail(detailResult)
      setEpisodes(episodeResult)
      if (episodeResult.length === 0) setDetailError('该作品暂无可用选集')
    } catch (cause) {
      setDetailError(messageOf(cause, '详情加载失败'))
    } finally {
      setDetailLoading(false)
    }
  }, [])

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
        source: 'kanju',
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
        source: 'kanju',
        episodeToken: item.token,
      }))
      const target = playlist.find((item) => item.id === episode.id)
      if (target === undefined) return
      onPlay(media, target, 0, playlist)
    },
    [active, detail, episodes, onPlay],
  )

  const renderCard = (card: RemoteCard): JSX.Element => (
    <button key={card.id} className="remote-card" onClick={() => void openCard(card)}>
      <div className="remote-poster">
        {card.posterUrl !== '' ? (
          <img src={card.posterUrl} alt={card.title} loading="lazy" />
        ) : (
          <span className="remote-poster-fallback">{card.title.slice(0, 1)}</span>
        )}
        <span className="remote-poster-scrim" aria-hidden="true" />
        <span className="remote-poster-play" aria-hidden="true">
          ▶
        </span>
        {card.remarks !== '' && <span className="remote-badge">{card.remarks}</span>}
      </div>
      <div className="remote-card-title">{card.title}</div>
      <div className="remote-card-meta">
        {card.year > 0 ? card.year : ''}
        {card.area !== '' ? ` · ${card.area}` : ''}
      </div>
    </button>
  )

  const firstEpisode = episodes[0]

  return (
    <div className="online-library">
      <div className="online-toolbar">
        <div className="online-kinds" role="tablist" aria-label="分类">
          {KIND_TABS.map((tab) => (
            <button
              key={tab.label}
              role="tab"
              aria-selected={kind === tab.key && mode !== 'home'}
              className={kind === tab.key && mode !== 'home' ? 'online-kind active' : 'online-kind'}
              onClick={() => chooseKind(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <form
          className="online-search"
          onSubmit={(event) => {
            event.preventDefault()
            submitSearch()
          }}
        >
          <input
            value={keyword}
            placeholder="搜索电影 / 电视剧 / 动漫 / 综艺"
            onChange={(event) => setKeyword(event.target.value)}
          />
          <button type="submit" className="btn-primary" disabled={loading}>
            搜索
          </button>
          <button type="button" className="btn-ghost" disabled={loading} onClick={() => void loadHome()}>
            刷新
          </button>
        </form>
      </div>

      {error !== null && <div className="library-error">{error}</div>}
      {loading && <div className="online-loading">加载中…</div>}

      {mode === 'home' && home !== null && (
        <div className="online-home">
          {home.sections.map((section) => (
            <section key={section.id} className="remote-section">
              <div className="remote-section-head">
                <h2>{section.title}</h2>
                {section.subtitle !== '' && <span>{section.subtitle}</span>}
              </div>
              <div className="remote-rail">{section.cards.map(renderCard)}</div>
            </section>
          ))}
        </div>
      )}

      {mode === 'results' && (
        <section className="remote-section">
          <div className="remote-section-head">
            <h2>{heading}</h2>
            <span>{results.length} 部</span>
          </div>
          {results.length === 0 && !loading ? (
            <p className="library-empty">没有找到相关内容。</p>
          ) : (
            <div className="remote-grid">{results.map(renderCard)}</div>
          )}
          {hasMore && (
            <div className="online-more">
              <button disabled={loading} onClick={loadMore}>
                加载更多
              </button>
            </div>
          )}
        </section>
      )}

      {active !== null && (
        <div className="remote-modal-mask" onClick={() => setActive(null)}>
          <div
            className="remote-modal"
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="remote-modal-head">
              <span className="remote-modal-title">{detail?.title ?? active.title}</span>
              <button className="remote-modal-close" aria-label="关闭" onClick={() => setActive(null)}>
                ×
              </button>
            </div>

            <div className="remote-modal-body">
              <div className="remote-modal-poster">
                {(detail?.posterUrl ?? active.posterUrl) !== '' ? (
                  <img src={detail?.posterUrl ?? active.posterUrl} alt={active.title} />
                ) : (
                  <span className="remote-poster-fallback">{active.title.slice(0, 1)}</span>
                )}
              </div>
              <div className="remote-modal-info">
                <div className="remote-modal-meta">
                  {[
                    (detail?.kind ?? active.kind) === 'movie' ? '电影' : '剧集',
                    (detail?.year ?? active.year) > 0 ? String(detail?.year ?? active.year) : '',
                    detail?.area ?? active.area,
                    detail?.remarks ?? active.remarks,
                  ]
                    .filter((part) => part !== '')
                    .join(' · ')}
                </div>
                <div className="remote-modal-genres">
                  {(detail?.genres ?? active.genres).slice(0, 6).map((genre) => (
                    <span key={genre} className="remote-genre">
                      {genre}
                    </span>
                  ))}
                </div>
                <p className="remote-modal-overview">
                  {detail?.overview !== undefined && detail.overview !== ''
                    ? detail.overview
                    : '暂无简介'}
                </p>
                {detail !== null && detail.actors.length > 0 && (
                  <p className="remote-modal-cast">演员：{detail.actors.slice(0, 8).join(' / ')}</p>
                )}
                {firstEpisode !== undefined && (
                  <button
                    className="btn-primary remote-modal-play"
                    onClick={() => playEpisode(firstEpisode)}
                  >
                    ▶ 播放第 1 集
                  </button>
                )}
              </div>
            </div>

            {detailError !== null && <div className="library-error">{detailError}</div>}
            {detailLoading && <div className="online-loading">选集加载中…</div>}

            {episodes.length > 0 && (
              <>
                <div className="remote-episodes-head">
                  选集 <span>共 {episodes.length} 集</span>
                </div>
                <div className="remote-episodes">
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
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

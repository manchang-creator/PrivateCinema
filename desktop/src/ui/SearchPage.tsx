// ==================== 搜索页 ====================
// 参考 B 站搜索页：搜索词常驻标题、片源切换、结果网格 + 加载更多；
// 没有关键词时给「搜索历史 + 热门推荐」，不做成空白页。

import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import { REMOTE_PROVIDERS, type RemoteCard, type RemoteProviderId } from '@private-cinema/core/shared'
import { kindLabel } from '../lib/media-kit'
import { rememberCard } from '../lib/remote-cache'
import type { DetailTarget } from '../lib/router'
import { useSearchHistory } from '../lib/store'
import { PosterCard } from './PosterCard'
import { SectionHead } from './Rail'
import { Icon } from './icons'

interface Props {
  keyword: string
  onOpenDetail: (target: DetailTarget) => void
  onSearch: (keyword: string) => void
}

const HOT_WORDS: readonly string[] = [
  '热播剧',
  '高分电影',
  '悬疑',
  '国产剧',
  '动漫',
  '综艺',
  '短剧',
  '科幻',
]

export function SearchPage({ keyword, onOpenDetail, onSearch }: Props): JSX.Element {
  const history = useSearchHistory()
  const [provider, setProvider] = useState<RemoteProviderId>('kanju')
  const [cards, setCards] = useState<RemoteCard[]>([])
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestId = useRef(0)

  const run = useCallback(
    async (prov: RemoteProviderId, words: string, nextPage: number) => {
      if (words.trim() === '') {
        setCards([])
        setHasMore(false)
        return
      }
      const id = requestId.current + 1
      requestId.current = id
      setLoading(true)
      setError(null)
      try {
        const data = await window.cinema.remoteSearch(prov, words.trim(), nextPage)
        // 快速连打时丢弃过期响应
        if (requestId.current !== id) return
        for (const card of data.cards) rememberCard(prov, card)
        setCards((previous) => (nextPage === 1 ? data.cards : [...previous, ...data.cards]))
        setPage(data.page)
        setHasMore(data.hasMore)
      } catch (cause) {
        if (requestId.current !== id) return
        setError(cause instanceof Error ? cause.message : '搜索失败')
        if (nextPage === 1) setCards([])
      } finally {
        if (requestId.current === id) setLoading(false)
      }
    },
    [],
  )

  useEffect(() => {
    setPage(1)
    void run(provider, keyword, 1)
  }, [provider, keyword, run])

  const switchProvider = useCallback((next: RemoteProviderId) => {
    setProvider(next)
    setCards([])
    setPage(1)
  }, [])

  const empty = keyword.trim() === ''

  return (
    <div className="page">
      <div className="page-inner">
        <div className="page-head">
          <div>
            <h1 className="page-title">{empty ? '搜索' : `“${keyword}”`}</h1>
            <p className="page-desc">
              {empty ? '在上游片源里找电影、剧集、动漫与短剧' : loading ? '搜索中…' : `共 ${cards.length} 条结果`}
            </p>
          </div>
          <div className="page-head-actions">
            <div className="seg" role="tablist" aria-label="片源">
              {REMOTE_PROVIDERS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={provider === item.id}
                  className={provider === item.id ? 'seg-item active' : 'seg-item'}
                  onClick={() => switchProvider(item.id)}
                >
                  {item.name}
                </button>
              ))}
            </div>
          </div>
        </div>

        {empty && (
          <>
            {history.list.length > 0 && (
              <section className="section">
                <SectionHead
                  title="搜索历史"
                  action={
                    <button type="button" className="link-btn" onClick={history.clear}>
                      <Icon name="trash" size={13} />
                      清空
                    </button>
                  }
                />
                <div className="chip-row">
                  {history.list.map((item) => (
                    <button
                      key={item}
                      type="button"
                      className="chip-btn"
                      onClick={() => onSearch(item)}
                    >
                      {item}
                    </button>
                  ))}
                </div>
              </section>
            )}

            <section className="section">
              <SectionHead title="大家都在搜" sub="点一下直接搜" />
              <div className="chip-row">
                {HOT_WORDS.map((item) => (
                  <button
                    key={item}
                    type="button"
                    className="chip-btn hot"
                    onClick={() => onSearch(item)}
                  >
                    <Icon name="fire" size={13} />
                    {item}
                  </button>
                ))}
              </div>
            </section>

            <div className="empty-state">
              <span className="empty-icon">
                <Icon name="search" size={30} />
              </span>
              <h3>输入关键词开始</h3>
              <p>顶部搜索框随时可用，按 / 键可以直接聚焦。</p>
            </div>
          </>
        )}

        {!empty && error !== null && <div className="notice error">{error}</div>}

        {!empty && cards.length > 0 && (
          <div className="poster-grid">
            {cards.map((card) => (
              <PosterCard
                key={card.id}
                title={card.title}
                cover={card.posterUrl}
                tag={card.remarks}
                sub={[card.year > 0 ? String(card.year) : '', card.area, kindLabel(card.kind)]
                  .filter((part) => part !== '')
                  .join(' · ')}
                onClick={() =>
                  onOpenDetail({
                    source: 'remote',
                    provider,
                    id: card.id,
                    title: card.title,
                    cover: card.posterUrl,
                  })
                }
              />
            ))}
          </div>
        )}

        {!empty && !loading && error === null && cards.length === 0 && (
          <div className="empty-state">
            <span className="empty-icon">
              <Icon name="search" size={26} />
            </span>
            <h3>没有找到「{keyword}」</h3>
            <p>换个词，或切到另一个片源再试试。</p>
          </div>
        )}

        {hasMore && (
          <div className="load-more">
            <button
              type="button"
              className="btn-glass"
              disabled={loading}
              onClick={() => void run(provider, keyword, page + 1)}
            >
              <Icon name="refresh" size={15} />
              {loading ? '加载中…' : '加载更多'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

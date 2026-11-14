// ==================== 搜索页 ====================
// 参考 B 站搜索页：搜索词常驻标题、片源切换、结果网格 + 加载更多；
// 没有关键词时给「搜索历史 + 热门推荐」，不做成空白页。
//
// 加载反馈分两层，各归各位：
//   - 首屏：直接铺骨架卡（数量和真实结果一致），列表位置不跳、不闪；
//   - 底部：显示「正在加载更多…」+ 转圈，「加载更多」按钮只在空闲时出现；
//   - 出错：错误信息贴在结果区下方，并给「重试」，不再跑到页面顶上。

import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import { REMOTE_PROVIDERS, type RemoteCard, type RemoteProviderId } from '@private-cinema/core/shared'
import { kindLabel } from '../lib/media-kit'
import { rememberCard } from '../lib/remote-cache'
import type { DetailTarget } from '../lib/router'
import { useSearchHistory } from '../lib/store'
import { rememberCandidate } from '../lib/weekly'
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

const SKELETON_COUNT = 12

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
        for (const card of data.cards) {
          rememberCard(prov, card)
          rememberCandidate(prov, card)
        }
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
  const firstLoad = !empty && loading && cards.length === 0
  const loadingMore = !empty && loading && cards.length > 0

  return (
    <div className="page">
      <div className="page-inner">
        <div className="page-head">
          <div>
            <h1 className="page-title">{empty ? '搜索' : `“${keyword}”`}</h1>
            <p className="page-desc">
              {empty
                ? '在上游片源里找电影、剧集、动漫与短剧'
                : firstLoad
                  ? '正在搜索…'
                  : `共 ${cards.length} 条结果${hasMore ? '（还有更多）' : ''}`}
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

        {/* 首屏骨架：占住真实网格的位置，结果回来时不会整页跳动 */}
        {firstLoad && (
          <div className="poster-grid" aria-busy="true" aria-label="正在搜索">
            {Array.from({ length: SKELETON_COUNT }).map((_, index) => (
              <div key={index} className="sk-card">
                <span className="sk-poster" />
                <span className="sk-line" />
                <span className="sk-line short" />
              </div>
            ))}
          </div>
        )}

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

        {!empty && error !== null && (
          <div className="grid-status error">
            <Icon name="info" size={14} />
            {error}
            <button type="button" className="link-btn" onClick={() => void run(provider, keyword, 1)}>
              重试
            </button>
          </div>
        )}

        {!empty && !firstLoad && !loading && error === null && cards.length === 0 && (
          <div className="empty-state">
            <span className="empty-icon">
              <Icon name="search" size={26} />
            </span>
            <h3>没有找到「{keyword}」</h3>
            <p>换个词，或切到另一个片源再试试。</p>
          </div>
        )}

        {/* 底部状态：加载中 / 加载更多 / 已到底 */}
        {loadingMore && (
          <div className="grid-status" aria-live="polite">
            <span className="spinner" aria-hidden="true" />
            正在加载更多…
          </div>
        )}
        {hasMore && !loading && (
          <div className="load-more">
            <button
              type="button"
              className="btn-glass"
              onClick={() => void run(provider, keyword, page + 1)}
            >
              <Icon name="refresh" size={15} />
              加载更多
            </button>
          </div>
        )}
        {!hasMore && !loading && cards.length > 0 && (
          <div className="grid-status">已经到底了 · 共 {cards.length} 条</div>
        )}
      </div>
    </div>
  )
}

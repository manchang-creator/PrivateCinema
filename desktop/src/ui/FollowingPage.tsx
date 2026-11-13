// ==================== 追剧页 ====================
// 参考 B 站「我的追番」+ 腾讯视频「我的」：三个分段
//   继续观看（后端进度） / 收藏（本地 + 在线） / 历史（本地点开记录）
// 任何一项都能一键回到播放或详情，条形进度直接显示看到哪儿。

import { useMemo, useState, type JSX } from 'react'
import type { Episode, MediaItem, WatchProgress } from '@private-cinema/core/shared'
import { formatTime } from '@private-cinema/core/ui'
import { kindLabel } from '../lib/media-kit'
import { getMeta } from '../lib/remote-cache'
import type { DetailTarget } from '../lib/router'
import { useFavorites, useHistory } from '../lib/store'
import { PosterCard } from './PosterCard'
import { Icon } from './icons'

interface Props {
  items: MediaItem[]
  episodes: Episode[]
  progress: WatchProgress[]
  onOpenDetail: (target: DetailTarget) => void
  onPlayLocal: (media: MediaItem, episode: Episode, position: number) => void
  onRemoveProgress: (record: WatchProgress) => void
  onBrowse: () => void
}

type Tab = 'continue' | 'favorite' | 'history'

const TABS: ReadonlyArray<{ key: Tab; label: string }> = [
  { key: 'continue', label: '继续观看' },
  { key: 'favorite', label: '我的收藏' },
  { key: 'history', label: '观看历史' },
]

export function FollowingPage({
  items,
  episodes,
  progress,
  onOpenDetail,
  onPlayLocal,
  onRemoveProgress,
  onBrowse,
}: Props): JSX.Element {
  const favorites = useFavorites()
  const history = useHistory()
  const [tab, setTab] = useState<Tab>('continue')

  const records = useMemo(
    () =>
      progress
        .filter(
          (record) =>
            items.some((item) => item.id === record.mediaId) &&
            episodes.some((item) => item.id === record.episodeId),
        )
        .slice(0, 40),
    [progress, items, episodes],
  )

  const playRecord = (record: WatchProgress): void => {
    const media = items.find((item) => item.id === record.mediaId)
    const episode = episodes.find((item) => item.id === record.episodeId)
    if (media === undefined || episode === undefined) return
    onPlayLocal(media, episode, record.position)
  }

  return (
    <div className="page">
      <div className="page-inner">
        <div className="page-head">
          <div>
            <h1 className="page-title">我的</h1>
            <p className="page-desc">
              {records.length} 条在追 · {favorites.list.length} 部收藏 · {history.list.length} 条历史
            </p>
          </div>
          <div className="page-head-actions">
            <button type="button" className="btn-glass" onClick={onBrowse}>
              <Icon name="fire" size={15} />
              去发现更多
            </button>
          </div>
        </div>

        <div className="tab-strip big" role="tablist" aria-label="我的">
          {TABS.map((entry) => (
            <button
              key={entry.key}
              type="button"
              role="tab"
              aria-selected={tab === entry.key}
              className={tab === entry.key ? 'tab-item active' : 'tab-item'}
              onClick={() => setTab(entry.key)}
            >
              {entry.label}
            </button>
          ))}
        </div>

        {tab === 'continue' && (
          <>
            {records.length === 0 ? (
              <Empty
                icon="history"
                title="还没有观看记录"
                text="播放任意一集后，这里会显示看到哪儿，随时接着看。"
                action={{ label: '去片库', onClick: onBrowse }}
              />
            ) : (
              <div className="poster-grid wide">
                {records.map((record) => {
                  const pct =
                    record.duration > 0
                      ? Math.min(100, Math.round((record.position / record.duration) * 100))
                      : 0
                  return (
                    <PosterCard
                      key={`${record.mediaId}:${record.episodeId}`}
                      className="pcard-wide"
                      title={record.mediaTitle}
                      cover=""
                      tag={record.completed ? '已看完' : `${pct}%`}
                      sub={`${record.episodeTitle} · ${
                        record.completed
                          ? '已看完'
                          : `还剩 ${formatTime(Math.max(0, record.duration - record.position))}`
                      }`}
                      progress={pct}
                      done={record.completed}
                      onClick={() => playRecord(record)}
                      onRemove={() => onRemoveProgress(record)}
                      removeLabel="移除这条记录"
                    />
                  )
                })}
              </div>
            )}
          </>
        )}

        {tab === 'favorite' && (
          <>
            {favorites.list.length === 0 ? (
              <Empty
                icon="heart"
                title="还没有收藏"
                text="在详情页点「追剧」，作品会收藏到这里，找起来更快。"
                action={{ label: '去逛逛', onClick: onBrowse }}
              />
            ) : (
              <div className="poster-grid">
                {favorites.list.map((entry) => (
                  <PosterCard
                    key={entry.id}
                    title={entry.title}
                    cover={entry.cover}
                    tag={kindLabel(entry.kind)}
                    onClick={() =>
                      onOpenDetail({
                        source: entry.source === 'local' ? 'local' : 'remote',
                        provider: entry.source,
                        id: entry.id,
                        title: entry.title,
                        cover: entry.cover,
                      })
                    }
                    onRemove={() =>
                      favorites.toggle({
                        id: entry.id,
                        title: entry.title,
                        cover: entry.cover,
                        kind: entry.kind,
                        source: entry.source,
                      })
                    }
                    removeLabel="取消追剧"
                  />
                ))}
              </div>
            )}
          </>
        )}

        {tab === 'history' && (
          <>
            {history.list.length === 0 ? (
              <Empty
                icon="clock"
                title="还没有历史"
                text="打开过的作品会按最近顺序记在这里。"
                action={{ label: '去片库', onClick: onBrowse }}
              />
            ) : (
              <>
                <div className="section-head">
                  <h2 className="section-title">最近打开</h2>
                  <span className="section-sub">{history.list.length} 条</span>
                  <div className="section-action">
                    <button type="button" className="link-btn" onClick={history.clear}>
                      <Icon name="trash" size={13} />
                      清空历史
                    </button>
                  </div>
                </div>
                <div className="history-list">
                  {history.list.map((entry) => {
                    const meta = getMeta('kanju', entry.mediaId) ?? getMeta('hongguo', entry.mediaId)
                    return (
                      <div key={entry.mediaId} className="history-row">
                        <button
                          type="button"
                          className="history-main"
                          onClick={() =>
                            onOpenDetail({
                              source: meta === undefined ? 'local' : 'remote',
                              provider: meta?.provider ?? 'local',
                              id: entry.mediaId,
                              title: entry.title,
                              cover: entry.cover,
                            })
                          }
                        >
                          <span className="history-cover">
                            {entry.cover !== '' ? (
                              <img src={entry.cover} alt="" referrerPolicy="no-referrer" />
                            ) : (
                              <span>{entry.title.slice(0, 1)}</span>
                            )}
                          </span>
                          <span className="history-text">
                            <span className="history-title">{entry.title}</span>
                            <span className="history-time">
                              {new Date(entry.at).toLocaleString('zh-CN', {
                                month: '2-digit',
                                day: '2-digit',
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>
                          </span>
                        </button>
                        <button
                          type="button"
                          className="history-remove"
                          aria-label={`移除「${entry.title}」`}
                          onClick={() => history.remove(entry.mediaId)}
                        >
                          <Icon name="close" size={13} />
                        </button>
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function Empty({
  icon,
  title,
  text,
  action,
}: {
  icon: 'history' | 'heart' | 'clock'
  title: string
  text: string
  action: { label: string; onClick: () => void }
}): JSX.Element {
  return (
    <div className="empty-state large">
      <span className="empty-icon">
        <Icon name={icon} size={30} />
      </span>
      <h3>{title}</h3>
      <p>{text}</p>
      <div className="empty-actions">
        <button type="button" className="btn-primary" onClick={action.onClick}>
          {action.label}
        </button>
      </div>
    </div>
  )
}

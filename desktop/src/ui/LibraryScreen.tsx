// ==================== 片库页（本地） ====================
// 参考 B 站「追番 / 收藏夹」与 Netflix 的库页：双行工具栏 = 类型标签行 + 排序/视图行，
// 卡片支持网格与列表两种排布。顶部区域在库为空时不是空白而是明确的导入引导。

import { useMemo, useState, type JSX } from 'react'
import type { Episode, MediaItem } from '@private-cinema/core/shared'
import { formatSize } from '@private-cinema/core/ui'
import { kindLabel, sortEpisodes } from '../lib/media-kit'
import {
  useLocalKindFilter,
  useLocalSort,
  useViewMode,
  type ViewMode,
} from '../lib/store'
import { PosterCard } from './PosterCard'
import { SectionHead } from './Rail'
import { Icon } from './icons'

interface Props {
  items: MediaItem[]
  episodes: Episode[]
  busy: boolean
  onScan: (mode: 'files' | 'folder') => void
  onOpen: (media: MediaItem) => void
  error: string | null
}

type SortKey = 'recent' | 'name' | 'year' | 'size'

const SORTS: ReadonlyArray<{ key: SortKey; label: string }> = [
  { key: 'recent', label: '最近添加' },
  { key: 'name', label: '名称' },
  { key: 'year', label: '年份' },
  { key: 'size', label: '体积' },
]

const KINDS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'movie', label: '电影' },
  { key: 'series', label: '剧集' },
  { key: 'anime', label: '动漫' },
  { key: 'variety', label: '综艺' },
]

export function LibraryScreen({
  items,
  episodes,
  busy,
  onScan,
  onOpen,
  error,
}: Props): JSX.Element {
  const [kind, setKind] = useLocalKindFilter()
  const [sort, setSort] = useLocalSort()
  const [view, setView] = useViewMode()
  const [query, setQuery] = useState('')

  // 类型过滤：当某一类为空时，标签仍然显示（点进去看到空态比「标签消失」更可预期）
  const filtered = useMemo(() => {
    const searched =
      query.trim() === ''
        ? items
        : items.filter((item) => item.title.toLowerCase().includes(query.trim().toLowerCase()))
    const byKind = kind === 'all' ? searched : searched.filter((item) => item.kind === kind)
    const withCount = (media: MediaItem): number =>
      episodes.filter((entry) => entry.mediaId === media.id).length
    return [...byKind].sort((a, b) => {
      switch (sort as SortKey) {
        case 'name':
          return a.title.localeCompare(b.title, 'zh')
        case 'year':
          return (b.year ?? 0) - (a.year ?? 0)
        case 'size':
          return (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0)
        default:
          // 后端扫描顺序即「最近添加」，这里按集数稳定一下，避免重排后跳动
          return withCount(b) - withCount(a)
      }
    })
  }, [items, episodes, kind, sort, query])

  const totalEpisodes = episodes.length
  const totalBytes = items.reduce((sum, item) => sum + (item.sizeBytes ?? 0), 0)

  return (
    <div className="page">
      <div className="page-inner">
        <div className="page-head">
          <div>
            <h1 className="page-title">片库</h1>
            <p className="page-desc">
              {items.length} 部作品 · {totalEpisodes} 集
              {totalBytes > 0 ? ` · ${formatSize(totalBytes)}` : ''}
            </p>
          </div>
          <div className="page-head-actions">
            <button
              type="button"
              className="icon-btn"
              disabled={busy}
              onClick={() => onScan('files')}
              title="选择单个或多个视频文件"
            >
              <Icon name="file" size={16} />
              选择文件
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={busy}
              onClick={() => onScan('folder')}
            >
              <Icon name="folder-open" size={16} />
              扫描文件夹
            </button>
          </div>
        </div>

        {error !== null && <div className="notice error">{error}</div>}

        {items.length === 0 ? (
          <div className="empty-state large">
            <span className="empty-icon">
              <Icon name="folder-open" size={34} />
            </span>
            <h3>片库还是空的</h3>
            <p>
              选一个装着影片的文件夹，私人影院会把它归成作品与集数，
              自动匹配同名字幕，并在退出时记住看到哪儿。
            </p>
            <div className="empty-actions">
              <button type="button" className="btn-primary" onClick={() => onScan('folder')}>
                <Icon name="folder-open" size={16} />
                扫描文件夹
              </button>
              <button type="button" className="btn-glass" onClick={() => onScan('files')}>
                <Icon name="file" size={16} />
                选择文件
              </button>
            </div>
            <ul className="empty-tips">
              <li>支持 mp4 / m4v / mov / mkv / webm</li>
              <li>同目录同名 .srt / .ass 字幕自动加载</li>
              <li>文件夹层级会识别季节与集号</li>
            </ul>
          </div>
        ) : (
          <>
            {/* 工具行一：类型标签 */}
            <div className="filter-row">
              <div className="tab-strip" role="tablist" aria-label="类型筛选">
                {KINDS.map((entry) => {
                  const count =
                    entry.key === 'all'
                      ? items.length
                      : items.filter((item) => item.kind === entry.key).length
                  return (
                    <button
                      key={entry.key}
                      type="button"
                      role="tab"
                      aria-selected={kind === entry.key}
                      className={kind === entry.key ? 'tab-item active' : 'tab-item'}
                      onClick={() => setKind(entry.key)}
                    >
                      {entry.label}
                      <span className="tab-count">{count}</span>
                    </button>
                  )
                })}
              </div>

              <label className="mini-search">
                <Icon name="search" size={15} />
                <input
                  value={query}
                  placeholder="在片库里查找"
                  aria-label="在片库里查找"
                  onChange={(event) => setQuery(event.target.value)}
                />
                {query !== '' && (
                  <button type="button" aria-label="清空" onClick={() => setQuery('')}>
                    <Icon name="close" size={12} />
                  </button>
                )}
              </label>
            </div>

            {/* 工具行二：排序 + 视图 */}
            <div className="filter-row secondary">
              <div className="sort-strip" role="radiogroup" aria-label="排序">
                <Icon name="sort" size={15} />
                {SORTS.map((entry) => (
                  <button
                    key={entry.key}
                    type="button"
                    role="radio"
                    aria-checked={sort === entry.key}
                    className={sort === entry.key ? 'sort-item active' : 'sort-item'}
                    onClick={() => setSort(entry.key)}
                  >
                    {entry.label}
                  </button>
                ))}
              </div>
              <div className="view-switch" role="radiogroup" aria-label="视图">
                {(['grid', 'list'] as ViewMode[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    role="radio"
                    aria-checked={view === mode}
                    aria-label={mode === 'grid' ? '网格视图' : '列表视图'}
                    title={mode === 'grid' ? '网格视图' : '列表视图'}
                    className={view === mode ? 'view-btn active' : 'view-btn'}
                    onClick={() => setView(mode)}
                  >
                    <Icon name={mode === 'grid' ? 'grid' : 'list'} size={15} />
                  </button>
                ))}
              </div>
            </div>

            {filtered.length === 0 ? (
              <div className="empty-state">
                <span className="empty-icon">
                  <Icon name="search" size={26} />
                </span>
                <h3>没有匹配的作品</h3>
                <p>换个类型或清空搜索词试试。</p>
              </div>
            ) : view === 'list' ? (
              <div className="library-list">
                {filtered.map((media) => {
                  const own = sortEpisodes(episodes.filter((entry) => entry.mediaId === media.id))
                  return (
                    <button
                      key={media.id}
                      type="button"
                      className="library-row"
                      onClick={() => onOpen(media)}
                    >
                      <span className="library-row-poster">
                        <span>{media.title.slice(0, 1)}</span>
                      </span>
                      <span className="library-row-main">
                        <span className="library-row-title">{media.title}</span>
                        <span className="library-row-sub">
                          {[
                            kindLabel(media.kind),
                            media.year > 0 ? String(media.year) : '',
                            `${own.length} 集`,
                            media.sizeBytes !== undefined && media.sizeBytes > 0
                              ? formatSize(media.sizeBytes)
                              : '',
                          ]
                            .filter((part) => part !== '')
                            .join(' · ')}
                        </span>
                      </span>
                      <span className="library-row-play" aria-hidden="true">
                        <Icon name="play" size={15} />
                      </span>
                    </button>
                  )
                })}
              </div>
            ) : (
              <div className="poster-grid">
                {filtered.map((media) => {
                  const own = sortEpisodes(episodes.filter((entry) => entry.mediaId === media.id))
                  return (
                    <PosterCard
                      key={media.id}
                      title={media.title}
                      cover=""
                      tag={kindLabel(media.kind)}
                      badge={media.kind === 'movie' ? '电影' : `全 ${own.length} 集`}
                      sub={[media.year > 0 ? String(media.year) : '', `${own.length} 集`]
                        .filter((part) => part !== '')
                        .join(' · ')}
                      onClick={() => onOpen(media)}
                    />
                  )
                })}
              </div>
            )}

            <section className="section library-more">
              <SectionHead title="想加更多？" sub="继续扫描不会清空已有条目" />
              <div className="import-actions">
                <button type="button" className="btn-glass" disabled={busy} onClick={() => onScan('files')}>
                  <Icon name="file" size={15} />
                  追加单个文件
                </button>
                <button type="button" className="btn-glass" disabled={busy} onClick={() => onScan('folder')}>
                  <Icon name="folder-open" size={15} />
                  追加文件夹
                </button>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  )
}

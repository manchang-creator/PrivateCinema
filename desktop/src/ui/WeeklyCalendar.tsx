// ==================== 本周追剧（更新日历）====================
// 首页顶部 + 追剧页两处共用。上半部分是「7 天格子」，今天高亮、每天写清楚更几部；
// 下半部分按类型分组（电视剧 / 动漫 / 综艺 / 电影），每部作品都挂着「周几 · 更新至第几集」。
// 全部是给自己看的本地视图：星期、集数、类型都可以点，点了就地筛选——
// 点「周六」只看周六的，点「动漫」只看动漫的，再点一次取消。

import { useCallback, useMemo, useState, type JSX } from 'react'
import type { MediaKind } from '@private-cinema/core/shared'
import {
  CALENDAR_KINDS,
  WEEK_LABELS,
  detailCap,
  detailPriority,
  isoWeekLabel,
  weekRangeLabel,
  type DayBucket,
  type ScheduleEntry,
  type WeeklyBoard,
} from '../lib/weekly'
import type { DetailTarget } from '../lib/router'
import { useFavorites } from '../lib/store'
import { proxiedPoster } from './PosterCard'
import { Icon } from './icons'
import { Rail } from './Rail'

export interface WeeklyCalendarProps {
  board: WeeklyBoard
  /** 紧凑版：首页用，类型分组只露一行海报，详情折叠 */
  compact?: boolean
  /** 默认展开详情（首页紧凑版默认收起，追剧页默认展开） */
  defaultExpanded?: boolean
  /** 标题右下方的一句话（首页给「今天更了几部」） */
  headerHint?: string
  /** 只显示已收藏的作品（追剧页的「我的收藏」分段） */
  favoritesOnly?: boolean
  /** 详情和卡片上打星标（收藏即追剧，点一下就能追 / 取关） */
  star?: boolean
  onOpenDetail: (target: DetailTarget) => void
}

type Filter = { weekday: number | null; kind: MediaKind | null }

export function WeeklyCalendar({
  board,
  compact = false,
  defaultExpanded = false,
  headerHint,
  favoritesOnly = false,
  star = false,
  onOpenDetail,
}: WeeklyCalendarProps): JSX.Element {
  const favorites = useFavorites()
  const [filter, setFilter] = useState<Filter>({ weekday: null, kind: null })
  const [filterFavorite, setFilterFavorite] = useState(false)
  const [expanded, setExpanded] = useState(defaultExpanded)
  /** 详情里「类型 × 日期」被折叠的条目：点「展开全部」后不再截断 */
  const [allKinds, setAllKinds] = useState(false)

  /** 收藏键：收藏写的是作品 id（与详情页「追剧」同一个 key），本地/在线同构。 */
  const isStarred = useCallback(
    (card: { id: string }) => favorites.has(card.id),
    [favorites],
  )

  const toggleStar = useCallback(
    (entry: ScheduleEntry) => {
      favorites.toggle({
        id: entry.card.id,
        title: entry.card.title,
        cover: entry.card.posterUrl,
        kind: entry.card.kind,
        source: entry.provider,
      })
    },
    [favorites],
  )

  /** 是否要按收藏过滤：外部强制（追剧页收藏分段）或自己点了星标筛选。 */
  const onlyStarred = favoritesOnly || filterFavorite

  const matches = useCallback(
    (entry: ScheduleEntry): boolean => !onlyStarred || favorites.has(entry.card.id),
    [onlyStarred, favorites],
  )

  /** 本周日历里已经追了的作品数，给「只看已追」做角标。 */
  const starredTotal = useMemo(() => {
    let count = 0
    for (const bucket of board.buckets) {
      for (const entry of bucket.entries) if (favorites.has(entry.card.id)) count += 1
    }
    return count
  }, [board.buckets, favorites])

  /** 「只看已追」时每一天的更新数：格子上的数字要跟着过滤走，否则会和下面列表对不上。 */
  const { starCountByDay, maxCount } = useMemo(() => {
    const byDay = new Array<number>(7).fill(0)
    let starTotal = 0
    for (const bucket of board.buckets) {
      for (const entry of bucket.entries) {
        if (!favorites.has(entry.card.id)) continue
        byDay[entry.weekday] += 1
        starTotal += 1
      }
    }
    const max = onlyStarred
      ? Math.max(1, starTotal)
      : Math.max(1, ...board.days.map((day) => day.count))
    return { starCountByDay: byDay, maxCount: max }
  }, [board.buckets, board.days, onlyStarred, favorites])

  const open = useCallback(
    (entry: ScheduleEntry) => {
      onOpenDetail({
        source: 'remote',
        provider: entry.provider,
        id: entry.card.id,
        title: entry.card.title,
        cover: entry.card.posterUrl,
      })
    },
    [onOpenDetail],
  )

  const toggleWeekday = (index: number): void => {
    setFilter((current) => ({
      ...current,
      weekday: current.weekday === index ? null : index,
    }))
  }

  const shiftWeek = (step: -1 | 1): void => {
    if (step === -1) board.prevWeek()
    else board.nextWeek()
    if (compact) setExpanded(false)
  }

  const toggleKind = (kind: MediaKind): void => {
    setFilter((current) => ({ ...current, kind: current.kind === kind ? null : kind }))
    if (compact) setExpanded(true)
  }

  // 详情区：按当前筛选把 entries 分到「日期 → 类型」两层。
  // 每类只留优先级最高的一部分（备注集数大的），其余折进 +N，展开后仍然给自己看
  const { groups, shownCount, hiddenCount } = useMemo(() => {
    const kept: Array<{ bucket: DayBucket; kinds: DayBucket['byKind'] }> = []
    let hidden = 0
    let shown = 0
    for (const bucket of board.buckets) {
      if (filter.weekday !== null && bucket.day.index !== filter.weekday) continue
      const kinds: DayBucket['byKind'] = []
      for (const group of bucket.byKind) {
        if (filter.kind !== null && group.kind !== filter.kind) continue
        const pool = group.entries.filter(matches)
        if (pool.length === 0) continue
        const sorted = [...pool].sort(
          (a, b) => detailPriority(b) - detailPriority(a) || a.weekday - b.weekday,
        )
        const cap = allKinds ? sorted.length : detailCap(group.kind)
        const visible = sorted.slice(0, cap)
        shown += visible.length
        hidden += sorted.length - visible.length
        kinds.push({ ...group, entries: visible })
      }
      if (kinds.length > 0) kept.push({ bucket, kinds })
    }
    return { groups: kept, shownCount: shown, hiddenCount: hidden }
  }, [board.buckets, filter, allKinds, matches])



  const filtered = filter.weekday !== null || filter.kind !== null

  return (
    <section className={compact ? 'week week-compact' : 'week'}>
      <header className="week-head">
        <span className="week-head-icon" aria-hidden="true">
          <Icon name="calendar" size={17} />
        </span>
        <div className="week-head-text">
          <h2 className="week-title">本周追剧</h2>
          <p className="week-sub">
            按日期查看影片更新 · {isoWeekLabel(board.monday)}
            {headerHint !== undefined && headerHint !== '' && <span>· {headerHint}</span>}
            {board.loading && <span className="week-dot">同步中</span>}
          </p>
        </div>
        <div className="week-head-side">
          <div className="week-nav" role="group" aria-label="切换周">
            <button
              type="button"
              className="week-nav-btn"
              aria-label="返回上一周的更新表"
              title="返回上一周"
              onClick={() => shiftWeek(-1)}
            >
              <Icon name="chevron-left" size={15} />
            </button>
            <span className="week-range">{weekRangeLabel(board.monday)}</span>
            <button
              type="button"
              className="week-nav-btn"
              aria-label="下一周"
              title="下一周"
              onClick={() => shiftWeek(1)}
            >
              <Icon name="chevron-right" size={15} />
            </button>
          </div>
          {!board.atThisWeek && (
            <button type="button" className="link-btn" onClick={board.thisWeek}>
              回到本周
            </button>
          )}
          {!favoritesOnly && (
            <button
              type="button"
              className={filterFavorite ? 'week-star-chip on' : 'week-star-chip'}
              aria-pressed={filterFavorite}
              title={filterFavorite ? '只看已追' : '只看已追的作品'}
              onClick={() => {
                setFilterFavorite((value) => !value)
                if (!filterFavorite) setExpanded(true)
              }}
            >
              <Icon name={filterFavorite ? 'heart-filled' : 'heart'} size={13} />
              只看已追
              <b>{starredTotal}</b>
            </button>
          )}
          <button
            type="button"
            className="link-btn"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
          >
            {expanded ? '收起详情' : '展开详情'}
            <Icon name={expanded ? 'chevron-left' : 'chevron-right'} size={13} />
          </button>
        </div>
      </header>

      {board.error !== null && <div className="notice">{board.error}</div>}

      {/* 7 天格子：今天描边高亮，选中日整块染成主色 */}
      <div className="week-days" role="group" aria-label="按星期查看更新">
        {board.days.map((day) => {
          const active = filter.weekday === day.index
          const count = onlyStarred ? (starCountByDay[day.index] ?? 0) : day.count
          return (
            <button
              key={day.date}
              type="button"
              className={[
                'week-day',
                day.isToday ? 'today' : '',
                active ? 'active' : '',
              ]
                .filter((name) => name !== '')
                .join(' ')}
              aria-pressed={active}
              onClick={() => toggleWeekday(day.index)}
            >
              <span className="week-day-name">{WEEK_LABELS[day.index]}</span>
              <strong className="week-day-num">{day.day}</strong>
              <span className="week-day-bar" aria-hidden="true">
                <i style={{ width: `${barWidth(count, maxCount)}%` }} />
              </span>
              <span className="week-day-count">{count}部</span>
            </button>
          )
        })}
      </div>

      {/* 类型分组：默认每个类型一行横排海报；一条都没有的类型先藏起来，不让版面空转 */}
      <div className="week-kinds">
        {CALENDAR_KINDS.map((kind) => {
          const active = filter.kind === kind.key
          const entries = board.buckets
            .filter((bucket) => filter.weekday === null || bucket.day.index === filter.weekday)
            .flatMap((bucket) => bucket.byKind.find((group) => group.kind === kind.key)?.entries ?? [])
            .filter(matches)
            .sort((a, b) => a.weekday - b.weekday || b.episode - a.episode)
          const total = onlyStarred ? entries.length : board.totalOfKind(kind.key)
          // 空分类只在「被主动筛选」时露出来，避免首页被四块「暂无更新」撑高
          if (total === 0 && !active && !onlyStarred) return null
          return (
            <div key={kind.key} className={active ? 'week-kind active' : 'week-kind'}>
              <div className="week-kind-head">
                <button
                  type="button"
                  className="week-kind-title"
                  aria-pressed={active}
                  onClick={() => toggleKind(kind.key)}
                >
                  {kind.label}
                </button>
                <span className="week-kind-count">{total} 部</span>
                <button
                  type="button"
                  className="week-kind-more"
                  onClick={() => {
                    setFilter({ weekday: null, kind: kind.key })
                    setExpanded(true)
                  }}
                >
                  详情
                  <Icon name="chevron-right" size={12} />
                </button>
              </div>
              {entries.length === 0 ? (
                <div className="week-kind-rail">
                  <span className="week-empty">
                    {onlyStarred ? '已追的作品这一周没排更新' : '这一周暂无更新'}
                  </span>
                </div>
              ) : (
                /* 复用 Rail：纵向滚轮横向翻动 + 左右箭头，别让"只能看到这几张"变成死角 */
                <Rail className="week-kind-rail">
                  {entries.slice(0, compact ? 10 : 24).map((entry) => (
                    <WeekCard
                      key={`${entry.provider}:${entry.card.id}`}
                      entry={entry}
                      star={star}
                      starred={isStarred(entry.card)}
                      onOpen={open}
                      onStar={toggleStar}
                    />
                  ))}
                </Rail>
              )}
            </div>
          )
        })}
      </div>

      {(onlyStarred ? starredTotal === 0 : board.total === 0) && (
        <div className="week-blank">
          <span>{board.loading ? '正在整理这一周的更新表…' : '这一周还没有抓到更新数据，点「同步」再试一次。'}</span>
          {!board.loading && (
            <button type="button" className="btn-glass small" onClick={board.reload}>
              <Icon name="refresh" size={13} />
              同步
            </button>
          )}
        </div>
      )}

      {/* 展开后的行程单：日期 → 类型 → 每部一行，带星期与集数 */}
      {expanded && (
        <div className="week-detail">
          <div className="week-detail-head">
            <span>
              {onlyStarred ? (
                <>
                  已追作品本周共 <b>{starredTotal}</b> 部在更新
                </>
              ) : (
                <>
                  本周共 <b>{board.total}</b> 部在更新
                </>
              )}
              {filtered && <span className="week-detail-filter">（筛选中 {shownCount + hiddenCount} 部）</span>}
              {hiddenCount > 0 && <span>，已展开 {shownCount} 部</span>}
            </span>
            {hiddenCount > 0 && (
              <button type="button" className="link-btn" onClick={() => setAllKinds(true)}>
                展开全部 {hiddenCount} 部
                <Icon name="chevron-down" size={12} />
              </button>
            )}
            {allKinds && hiddenCount === 0 && (
              <button type="button" className="link-btn" onClick={() => setAllKinds(false)}>
                收起到常用
                <Icon name="chevron-left" size={12} />
              </button>
            )}
            {filtered && (
              <button
                type="button"
                className="link-btn"
                onClick={() => {
                  setFilter({ weekday: null, kind: null })
                  setAllKinds(false)
                }}
              >
                <Icon name="close" size={12} />
                清除筛选
              </button>
            )}
          </div>

          {groups.length === 0 && <div className="week-detail-empty">这一周没有符合条件的更新。</div>}

          {groups.map(({ bucket, kinds }) => (
            <div key={bucket.day.date} className="week-day-block">
              <div className="week-day-block-head">
                <strong>
                  {WEEK_LABELS[bucket.day.index]} {bucket.day.day} 日
                </strong>
                {bucket.day.isToday && <span className="week-today-tag">今天</span>}
                <span className="week-day-block-count">
                  {onlyStarred
                    ? `${kinds.reduce((sum, group) => sum + group.entries.reduce((n, e) => n + (isStarred(e.card) ? 1 : 0), 0), 0)} 部已追`
                    : `${bucket.entries.length} 部`}
                </span>
              </div>
              {kinds.map((group) => (
                <div key={group.kind} className="week-rows">
                  <span className="week-rows-kind">{group.label}</span>
                  <ul className="week-rows-list">
                    {group.entries.map((entry) => (
                      <li key={`${entry.provider}:${entry.card.id}`} className="week-row-item">
                        <button type="button" className="week-row" onClick={() => open(entry)}>
                          <span className="week-row-art">
                            {entry.card.posterUrl !== '' && (
                              <img
                                src={proxiedPoster(entry.card.posterUrl)}
                                alt=""
                                loading="lazy"
                                referrerPolicy="no-referrer"
                              />
                            )}
                          </span>
                          <span className="week-row-title">
                            {star && isStarred(entry.card) && (
                              <Icon name="heart-filled" size={11} className="week-row-star" />
                            )}
                            {entry.card.title}
                          </span>
                          <span className="week-row-when">
                            {WEEK_LABELS[entry.weekday]} · {entry.label}
                          </span>
                        </button>
                        {star && (
                          <button
                            type="button"
                            className={
                              isStarred(entry.card) ? 'week-star on' : 'week-star'
                            }
                            aria-pressed={isStarred(entry.card)}
                            aria-label={
                              isStarred(entry.card)
                                ? `取消追「${entry.card.title}」`
                                : `追「${entry.card.title}」`
                            }
                            title={isStarred(entry.card) ? '已追 · 点一下取消' : '点一下加入追剧'}
                            onClick={() => toggleStar(entry)}
                          >
                            <Icon name={isStarred(entry.card) ? 'heart-filled' : 'heart'} size={13} />
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function WeekCard({
  entry,
  star,
  starred,
  onOpen,
  onStar,
}: {
  entry: ScheduleEntry
  star: boolean
  starred: boolean
  onOpen: (entry: ScheduleEntry) => void
  onStar: (entry: ScheduleEntry) => void
}): JSX.Element {
  return (
    <div className={starred ? 'week-card starred' : 'week-card'}>
      <button type="button" className="week-card-main" onClick={() => onOpen(entry)}>
        <span className="week-card-art">
          {entry.card.posterUrl !== '' && (
            <img
              src={proxiedPoster(entry.card.posterUrl)}
              alt=""
              loading="lazy"
              referrerPolicy="no-referrer"
            />
          )}
          <span className="week-card-day">{WEEK_LABELS[entry.weekday]}</span>
        </span>
        <span className="week-card-title">{entry.card.title}</span>
        <span className="week-card-sub">{entry.label}</span>
      </button>
      {star && (
        <button
          type="button"
          className={starred ? 'week-star corner on' : 'week-star corner'}
          aria-pressed={starred}
          aria-label={starred ? `取消追「${entry.card.title}」` : `追「${entry.card.title}」`}
          title={starred ? '已追 · 点一下取消' : '点一下加入追剧'}
          onClick={() => onStar(entry)}
        >
          <Icon name={starred ? 'heart-filled' : 'heart'} size={11} />
        </button>
      )}
    </div>
  )
}

function barWidth(count: number, max: number): number {
  if (count <= 0) return 0
  return Math.max(8, Math.round((count / Math.max(1, max)) * 100))
}

/** 快捷提示：给「今天更了几部」这类文案用。 */
export function todaySummary(board: WeeklyBoard): string {
  const today = board.days.find((day) => day.isToday)
  if (today === undefined) return `${weekRangeLabel(board.monday)}`
  return `今天 ${WEEK_LABELS[today.index]} 更新 ${today.count} 部`
}


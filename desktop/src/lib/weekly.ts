// ==================== 在线片源的「周更日历」====================
// 首页的「本周追剧」和追剧页的「更新日历」共用这一份数据：
//   - 按真实日期取一周（周一起算），今天高亮，前后可翻周；
//   - 在线货架里出现的、正在连载的作品登记进「候选池」，被日历采到的卡片顺手取回完整信息；
//   - 每部作品按标题哈希挂到固定的一天（同一部作品永远落在同一天），
//     并按「总集数 − 已更集数」算出这一周的更新节奏，生成「周N 更新至第E集」；
//   - 结果写进 localStorage 缓存（带 TTL），没网 / 冷启动也不会空着。
// 真正有官方更新表时，只要换掉 `scheduleOf` 的实现，页面不用动。

import { useCallback, useEffect, useMemo, useState } from 'react'
import { REMOTE_PROVIDERS, type MediaKind, type RemoteCard } from '@private-cinema/core/shared'
import { useStored } from './store'

export const WEEK_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'] as const

/** 日历里出现的类型分组，顺序即展示顺序。 */
export const CALENDAR_KINDS: ReadonlyArray<{ key: MediaKind; label: string; short: string }> = [
  { key: 'series', label: '电视剧', short: '剧集' },
  { key: 'anime', label: '动漫', short: '动漫' },
  { key: 'variety', label: '综艺', short: '综艺' },
  { key: 'movie', label: '电影', short: '电影' },
]

export interface WeekDay {
  /** 2026-11-14 */
  date: string
  /** 14 */
  day: number
  /** 0 = 周一 … 6 = 周日 */
  index: number
  isToday: boolean
  /** 这一天的更新条目数（用来决定高亮强度） */
  count: number
}

export interface ScheduleEntry {
  provider: string
  card: RemoteCard
  /** 本周更新的星期（0 = 周一） */
  weekday: number
  /** 本周更新后的集数；0 表示电影 / 资源更新这类没有集数的 */
  episode: number
  /** 周序号：1 起，按「这一周是第几周更新」推 */
  week: number
  /** 「更新至第199集」「资源更新」 */
  label: string
  /** 排序用的更新时间（越晚越先排） */
  rank: number
  /** 备注里已经更到第几集（0 = 未知）；只有它 ≥ 本档上限才值得展开成一行 */
  current: number
  /** 备注里写的总集数（0 = 未知） */
  total: number
}

/** 电视剧最多 30 行、动漫 40 行、综艺 15 行、电影 30 行：超过就只留前面更得多的。 */
const DETAIL_CAP: Record<MediaKind, number> = { series: 30, anime: 40, variety: 15, movie: 30 }

/** 展开详情的截断依据：备注里集数越大越靠前，没写集数的排后面。 */
export function detailPriority(entry: ScheduleEntry): number {
  return entry.current
}

/** 分类在展开详情里能占的行数上限。 */
export function detailCap(kind: MediaKind): number {
  return DETAIL_CAP[kind] ?? 20
}

export interface DayBucket {
  day: WeekDay
  entries: ScheduleEntry[]
  byKind: Array<{ kind: MediaKind; label: string; entries: ScheduleEntry[] }>
}

// ==================== 日期工具 ====================

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value)
}

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** 这一周的周一（本地时区零点）。 */
export function mondayOf(date: Date): Date {
  const copy = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const weekday = (copy.getDay() + 6) % 7
  copy.setDate(copy.getDate() - weekday)
  return copy
}

function addDays(date: Date, days: number): Date {
  const copy = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  copy.setDate(copy.getDate() + days)
  return copy
}

/** 「11月9日 - 11月15日」 */
export function weekRangeLabel(monday: Date): string {
  const sunday = addDays(monday, 6)
  return `${monday.getMonth() + 1}月${monday.getDate()}日 - ${sunday.getMonth() + 1}月${sunday.getDate()}日`
}

/** 「2026 第46周」——以该年第一个周一为第 1 周。 */
export function isoWeekLabel(monday: Date): string {
  const jan1 = new Date(monday.getFullYear(), 0, 1)
  const firstMonday = mondayOf(jan1)
  const weeks = Math.round((monday.getTime() - firstMonday.getTime()) / 604_800_000) + 1
  return `${monday.getFullYear()} 第${weeks}周`
}

// ==================== 候选池 ====================

const CANDIDATE_LIMIT = 260
const candidates = new Map<string, { provider: string; card: RemoteCard }>()
const listeners = new Set<() => void>()
let revision = 0

function candidateKey(provider: string, id: string): string {
  return `${provider}:${id}`
}

export function subscribeCandidates(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/** 登记一部「可能在追」的作品。已经登记过就跳过，不触发重渲染。 */
export function rememberCandidate(provider: string, card: RemoteCard): void {
  const key = candidateKey(provider, card.id)
  if (candidates.has(key)) return
  if (candidates.size >= CANDIDATE_LIMIT) {
    const oldest = candidates.keys().next()
    if (oldest.done !== true) candidates.delete(oldest.value)
  }
  candidates.set(key, { provider, card })
  revision += 1
  for (const fn of listeners) fn()
}

export function candidateRevision(): number {
  return revision
}

// ==================== 更新表生成 ====================

/** 稳定哈希：同一部作品永远落在同一天，翻周也不会乱跳。 */
function hashOf(text: string): number {
  let hash = 2166136261
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return Math.abs(hash)
}

/** 从备注里抠总集数：「全36集」「更新至20集」「全24集 已完结」。 */
function totalOf(remarks: string): number {
  const all = /全\s*(\d{1,4})\s*集/.exec(remarks)
  if (all !== null) return Number(all[1])
  const upto = /(?:更新至|第)\s*(\d{1,4})\s*集/.exec(remarks)
  if (upto !== null) return Number(upto[1])
  return 0
}

/** 从备注里抠「现在更到第几集」。没有就当作未知。 */
function currentOf(remarks: string): number {
  const upto = /(?:更新至|至第|第)\s*(\d{1,4})\s*集/.exec(remarks)
  if (upto !== null) return Number(upto[1])
  return 0
}

/** 一周更几集：剧集 / 动漫大多一周 2 集，综艺一周 1 期，电影一次性上。 */
function perWeekOf(kind: MediaKind): number {
  if (kind === 'anime' || kind === 'series') return 2
  return 1
}

function scheduleOf(provider: string, card: RemoteCard, monday: Date): ScheduleEntry {
  const seed = hashOf(`${provider}:${card.id}`)
  const weekday = seed % 7
  const total = totalOf(card.remarks)
  const current = currentOf(card.remarks)
  const perWeek = perWeekOf(card.kind)

  // 目标是「这一周应该更到哪」：有总集数就按周进度推进，没有就从备注里的数字往后滚。
  let episode = 0
  let week = 1
  if (card.kind !== 'movie') {
    const weekIndex = Math.round((monday.getTime() - new Date(monday.getFullYear(), 0, 1).getTime()) / 604_800_000)
    const anchor = current > 0 ? current : (seed % 12) + 1
    episode = anchor + (weekIndex % 24) * perWeek + (weekday % perWeek)
    if (total > 0) episode = Math.min(total, episode)
    week = Math.max(1, Math.ceil(episode / perWeek) - 0)
  }

  let label = '资源更新'
  if (card.kind !== 'movie') {
    if (total > 0 && episode >= total) label = `全${total}集 本周完结`
    else if (current > 0) label = `更新至${Math.max(current, episode)}集`
    else label = `更新至${Math.max(1, episode)}集`
  }

  return {
    provider,
    card,
    weekday,
    episode,
    week,
    label,
    rank: card.year > 0 ? card.year : 0,
    current,
    total,
  }
}

// ==================== 缓存 ====================

const CACHE_KEY = 'weekly-cache-v1'
const CACHE_TTL = 6 * 60 * 60 * 1000
const CACHE_MAX = 1400

interface CacheShape {
  at: number
  items: Array<{ p: string; w: string; card: RemoteCard; weekday: number; episode: number; week: number; label: string }>
}

function readCache(): CacheShape | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (raw === null) return null
    const parsed = JSON.parse(raw) as CacheShape
    if (Date.now() - parsed.at > CACHE_TTL) return null
    return parsed
  } catch {
    return null
  }
}

function writeCache(items: CacheShape['items']): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), items } as CacheShape))
  } catch {
    // 配额满就放弃缓存，内存里照样有
  }
}

// ==================== Hook ====================

export interface WeeklyBoard {
  monday: Date
  days: WeekDay[]
  buckets: DayBucket[]
  /** 每一类的总数，标题旁显示「45 部」 */
  totalOfKind: (kind: MediaKind) => number
  /** 本周全部条目数 */
  total: number
  /** 还在从在线片源补数据 */
  loading: boolean
  /** 在线补拉失败（缓存/货架数据仍然可看） */
  error: string | null
  prevWeek: () => void
  nextWeek: () => void
  thisWeek: () => void
  /** 是否就停在当前这一周 */
  atThisWeek: boolean
  reload: () => void
}

export function useWeeklyBoard(weekOffset: number, onWeekOffset: (next: number) => void): WeeklyBoard {
  const [, setTick] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const revisionNow = candidateRevision()

  // 货架登记 → 重算
  useEffect(() => subscribeCandidates(() => setTick((value) => value + 1)), [])

  // 在线补拉：类型页各拿一页，把卡片塞进候选池，之后按同一套规则排期
  const reload = useCallback(() => {
    let alive = true
    setLoading(true)
    setError(null)
    const jobs = REMOTE_PROVIDERS.flatMap((provider) =>
      CALENDAR_KINDS.map((kind) =>
        window.cinema
          .remoteBrowse(provider.id, kind.key, 1)
          .then((data) => {
            if (!alive) return 0
            for (const card of data.cards) {
              if (card.kind !== kind.key) continue
              rememberCandidate(provider.id, card)
            }
            return data.cards.length
          })
          .catch(() => 0),
      ),
    )
    void Promise.all(jobs).then((counts) => {
      if (!alive) return
      setLoading(false)
      if (counts.every((count) => count === 0)) setError('在线片源暂时取不到更新表，先看已缓存的部分。')
    })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    const stop = reload()
    return stop
  }, [reload])

  const today = useMemo(() => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), now.getDate())
  }, [])

  const thisMonday = useMemo(() => mondayOf(today), [today])
  const monday = useMemo(() => addDays(thisMonday, weekOffset * 7), [thisMonday, weekOffset])

  const { buckets, days, totals } = useMemo(() => {
    const cached = readCache()
    const pool = new Map<string, { provider: string; card: RemoteCard }>()
    // 缓存当底，候选池（货架 / 搜索 / 分类页刚拉到的）覆盖掉同 id 的旧卡片
    if (cached !== null) {
      for (const item of cached.items) {
        pool.set(candidateKey(item.p, item.card.id), { provider: item.p, card: item.card })
      }
    }
    for (const [key, value] of candidates) pool.set(key, value)
    // 片源翻到过同一部作品的两个 id（聚合站常见）时按标题去重，日历里一部只出现一次
    const byTitle = new Set<string>()
    const unique = new Map<string, { provider: string; card: RemoteCard }>()
    for (const [key, value] of pool) {
      const titleKey = `${value.card.kind}:${value.card.title}`
      if (byTitle.has(titleKey)) continue
      byTitle.add(titleKey)
      unique.set(key, value)
    }
    pool.clear()
    for (const [key, value] of unique) pool.set(key, value)

    const entries: ScheduleEntry[] = []
    for (const value of pool.values()) entries.push(scheduleOf(value.provider, value.card, monday))

    // 每类最多 60 条，避免一天里挤成一长串
    const byKind = new Map<MediaKind, ScheduleEntry[]>()
    for (const entry of entries) {
      const list = byKind.get(entry.card.kind) ?? []
      list.push(entry)
      byKind.set(entry.card.kind, list)
    }
    // 总数超上限时，把「全N集 本周完结」这类先排到后面再裁，留正在连载的在前面——
    // 全量仍留在候选池与缓存里，被裁掉的作品清掉筛选或展开全部还在。
    for (const [kind, list] of byKind) {
      if (list.length <= 60) continue
      list.sort((a, b) => Number(a.label.includes('完结')) - Number(b.label.includes('完结')))
      byKind.set(kind, list.slice(0, 60))
    }

    const flat = [...byKind.values()].flat().sort((a, b) => b.rank - a.rank || b.episode - a.episode)

    const counts = new Array<number>(7).fill(0)
    for (const entry of flat) counts[entry.weekday] += 1

    const dayList: WeekDay[] = Array.from({ length: 7 }).map((_, index) => {
      const date = addDays(monday, index)
      return {
        date: dateKey(date),
        day: date.getDate(),
        index,
        isToday: date.getTime() === today.getTime(),
        count: counts[index] ?? 0,
      }
    })

    const dayBuckets: DayBucket[] = dayList.map((day) => {
      const own = flat.filter((entry) => entry.weekday === day.index)
      return {
        day,
        entries: own,
        byKind: CALENDAR_KINDS.map((kind) => ({
          kind: kind.key,
          label: kind.label,
          entries: own.filter((entry) => entry.card.kind === kind.key),
        })),
      }
    })

    const kindTotals = new Map<MediaKind, number>()
    for (const [kind, list] of byKind) kindTotals.set(kind, list.length)

    // 写缓存：合并旧缓存与本次结果，最多 CACHE_MAX 条
    const merged = new Map<string, CacheShape['items'][number]>()
    if (cached !== null) for (const item of cached.items) merged.set(candidateKey(item.p, item.card.id), item)
    for (const entry of flat.slice(0, CACHE_MAX)) {
      merged.set(candidateKey(entry.provider, entry.card.id), {
        p: entry.provider,
        w: dateKey(monday),
        card: entry.card,
        weekday: entry.weekday,
        episode: entry.episode,
        week: entry.week,
        label: entry.label,
      })
    }
    writeCache([...merged.values()].slice(-CACHE_MAX))

    return { buckets: dayBuckets, days: dayList, totals: kindTotals }
  }, [monday, revisionNow, loading])

  return {
    monday,
    days,
    buckets,
    totalOfKind: (kind) => totals.get(kind) ?? 0,
    total: days.reduce((sum, day) => sum + day.count, 0),
    loading,
    error,
    prevWeek: () => onWeekOffset(weekOffset - 1),
    nextWeek: () => onWeekOffset(weekOffset + 1),
    thisWeek: () => onWeekOffset(0),
    atThisWeek: weekOffset === 0,
    reload,
  }
}

/** 一周偏移持久化：重开应用还停在你看的那一周。 */
export function useWeekOffset(): [number, (next: number) => void] {
  return useStored<number>('weekly-week-offset', 0)
}

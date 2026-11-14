// ==================== 本地偏好与用户数据 ====================
// 全部走 localStorage（桌面端单机、无账号体系）。用一个极小的订阅式 store
// 统一「读 / 写 / 通知」，避免每个组件各自 localStorage.getItem + 手动刷新。
//
// 设计约束：
//   1. 读取永远返回可用值（坏数据 / 版本不符 → 回落默认值，不抛异常）；
//   2. 写入后同步广播，任何组件订阅同一个 key 都能立刻拿到新值；
//   3. 播放器相关的记忆项（音量 / 倍速 / 线路）单独命名空间，方便一键清空。

import { useSyncExternalStore } from 'react'

const PREFIX = 'pc:'

export interface WatchRecord {
  mediaId: string
  episodeId: string
  title: string
  cover: string
  at: number
}

export interface SearchRecord {
  keyword: string
  at: number
}

// ==================== 底层存储 ====================

function keyOf(key: string): string {
  return PREFIX + key
}

function readRaw<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(keyOf(key))
    if (raw === null) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

const listeners = new Map<string, Set<() => void>>()
// useSyncExternalStore 要求快照在两次调用之间保持同一引用，否则会无限重渲染。
// 这里给每个 key 缓存「最后解析出的对象」，写入时才换新引用。
const cache = new Map<string, unknown>()

function snapshot<T>(key: string, fallback: T): T {
  if (!cache.has(key)) cache.set(key, readRaw(key, fallback))
  return cache.get(key) as T
}

function emit(key: string): void {
  const set = listeners.get(key)
  if (set === undefined) return
  for (const fn of set) fn()
}

function write<T>(key: string, value: T): void {
  try {
    localStorage.setItem(keyOf(key), JSON.stringify(value))
  } catch {
    // 配额满 / 隐私模式：内存态照样生效，只是不跨会话保留
  }
  cache.set(key, value)
  emit(key)
}

function subscribe(key: string, fn: () => void): () => void {
  const set = listeners.get(key) ?? new Set<() => void>()
  set.add(fn)
  listeners.set(key, set)
  return () => {
    set.delete(fn)
    if (set.size === 0) listeners.delete(key)
  }
}

/** 订阅一个 localStorage 键，返回 [值, 写入函数]。 */
export function useStored<T>(key: string, fallback: T): [T, (next: T | ((prev: T) => T)) => void] {
  const value = useSyncExternalStore(
    (fn) => subscribe(key, fn),
    () => snapshot(key, fallback),
    () => fallback,
  )
  const set = (next: T | ((prev: T) => T)): void => {
    const resolved =
      typeof next === 'function' ? (next as (prev: T) => T)(snapshot(key, fallback)) : next
    write(key, resolved)
  }
  return [value, set]
}

// ==================== 通用列表操作 ====================

function insertFront<T>(list: T[], item: T, limit: number, same: (a: T, b: T) => boolean): T[] {
  return [item, ...list.filter((entry) => !same(entry, item))].slice(0, limit)
}

// ==================== 收藏（追剧） ====================

export interface FavoriteEntry {
  /** 作品 id（本地 / 在线同构） */
  id: string
  title: string
  cover: string
  kind: string
  source: string
  at: number
}

export function useFavorites(): {
  list: FavoriteEntry[]
  has: (id: string) => boolean
  toggle: (entry: Omit<FavoriteEntry, 'at'>) => boolean
} {
  const [list, setList] = useStored<FavoriteEntry[]>('favorites', [])
  return {
    list,
    has: (id) => list.some((entry) => entry.id === id),
    toggle: (entry) => {
      const exists = list.some((item) => item.id === entry.id)
      setList(
        exists
          ? list.filter((item) => item.id !== entry.id)
          : insertFront(list, { ...entry, at: Date.now() }, 500, (a, b) => a.id === b.id),
      )
      return !exists
    },
  }
}

// ==================== 观看历史（本地条目，点击即记） ====================

export function useHistory(): {
  list: WatchRecord[]
  push: (record: Omit<WatchRecord, 'at'>) => void
  remove: (mediaId: string) => void
  clear: () => void
} {
  const [list, setList] = useStored<WatchRecord[]>('history', [])
  return {
    list,
    push: (record) =>
      setList(insertFront(list, { ...record, at: Date.now() }, 60, (a, b) => a.mediaId === b.mediaId)),
    remove: (mediaId) => setList(list.filter((entry) => entry.mediaId !== mediaId)),
    clear: () => setList([]),
  }
}

// ==================== 搜索历史 ====================

export function useSearchHistory(): {
  list: string[]
  push: (keyword: string) => void
  remove: (keyword: string) => void
  clear: () => void
} {
  const [list, setList] = useStored<string[]>('search-history', [])
  return {
    list,
    push: (keyword) => {
      const trimmed = keyword.trim()
      if (trimmed === '') return
      setList([trimmed, ...list.filter((item) => item !== trimmed)].slice(0, 12))
    },
    remove: (keyword) => setList(list.filter((item) => item !== keyword)),
    clear: () => setList([]),
  }
}

// ==================== 追剧页分段 ====================

export type FollowingTab = 'continue' | 'favorite' | 'history'

export function useFollowingTab(): [FollowingTab, (next: FollowingTab) => void] {
  return useStored<FollowingTab>('following-tab', 'continue')
}

// ==================== 界面偏好 ====================

export type ViewMode = 'grid' | 'list'

export function useRailCollapsed(): [boolean, (next: boolean) => void] {
  return useStored<boolean>('rail-collapsed', false)
}

export function useViewMode(): [ViewMode, (next: ViewMode) => void] {
  return useStored<ViewMode>('view-mode', 'grid')
}

export function useLocalKindFilter(): [string, (next: string) => void] {
  return useStored<string>('local-kind', 'all')
}

export function useLocalSort(): [string, (next: string) => void] {
  return useStored<string>('local-sort', 'recent')
}

export function useAutoNext(): [boolean, (next: boolean) => void] {
  return useStored<boolean>('auto-next', true)
}

// ==================== 播放器记忆 ====================

export function usePlayerVolume(): [number, (next: number) => void] {
  return useStored<number>('player-volume', 1)
}

export function usePlayerRate(): [number, (next: number) => void] {
  return useStored<number>('player-rate', 1)
}

export function usePlayerMuted(): [boolean, (next: boolean) => void] {
  return useStored<boolean>('player-muted', false)
}

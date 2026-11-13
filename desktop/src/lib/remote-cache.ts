// ==================== 在线片源：跨页共享的元数据 ====================
// 首页、片库、搜索、详情、追剧都需要「把一张卡片变成可播的作品」，而远端详情
// 需要额外一次请求。这里起一份进程内缓存：
//   - 卡片元数据（标题 / 封面 / 类型 / 年份 / 备注）随浏览被动收集；
//   - `ensureDetail` 按需补拉，同一部作品只拉一次，并发调用共享同一个 Promise。
// 这样「继续观看 / 收藏 / 历史」里只剩 id 时，也能还原标题与封面。

import type { RemoteCard, RemoteDetail } from '@private-cinema/core/shared'

export interface RemoteMeta {
  id: string
  title: string
  cover: string
  kind: string
  year: number
  area: string
  remarks: string
  provider: string
}

const metas = new Map<string, RemoteMeta>()
const details = new Map<string, RemoteDetail>()
const inflight = new Map<string, Promise<RemoteDetail | null>>()
const listeners = new Set<() => void>()

function metaKey(provider: string, id: string): string {
  return `${provider}:${id}`
}

function emit(): void {
  for (const fn of listeners) fn()
}

export function subscribeMeta(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/** 卡片 → 元数据（浏览时顺手登记，之后任何页面都能取回）。 */
export function rememberCard(provider: string, card: RemoteCard): RemoteMeta {
  const meta: RemoteMeta = {
    id: card.id,
    title: card.title,
    cover: card.posterUrl,
    kind: card.kind,
    year: card.year,
    area: card.area,
    remarks: card.remarks,
    provider,
  }
  metas.set(metaKey(provider, card.id), meta)
  return meta
}

export function rememberDetail(provider: string, detail: RemoteDetail): RemoteMeta {
  const meta: RemoteMeta = {
    id: detail.id,
    title: detail.title,
    cover: detail.posterUrl,
    kind: detail.kind,
    year: detail.year,
    area: detail.area,
    remarks: detail.remarks,
    provider,
  }
  metas.set(metaKey(provider, detail.id), meta)
  emit()
  return meta
}

export function getMeta(provider: string, id: string): RemoteMeta | undefined {
  return metas.get(metaKey(provider, id))
}

export function getDetail(provider: string, id: string): RemoteDetail | undefined {
  return details.get(metaKey(provider, id))
}

/**
 * 取详情：命中缓存直接返回；否则发一次请求，并发调用共享同一个 Promise。
 * 失败返回 null（调用方决定是显示错误还是退化到卡片元数据），不抛。
 */
export function ensureDetail(
  provider: 'kanju' | 'hongguo',
  id: string,
): Promise<RemoteDetail | null> {
  const key = metaKey(provider, id)
  const cached = details.get(key)
  if (cached !== undefined) return Promise.resolve(cached)
  const running = inflight.get(key)
  if (running !== undefined) return running
  const task = window.cinema
    .remoteDetail(provider, id)
    .then((detail) => {
      details.set(key, detail)
      rememberDetail(provider, detail)
      return detail
    })
    .catch(() => null)
    .finally(() => {
      inflight.delete(key)
    })
  inflight.set(key, task)
  return task
}

/** 「热门」种子：没有浏览记录时，首页仍能摆出一排便当式推荐。 */
export const TRENDING: ReadonlyArray<{ keyword: string; provider: 'kanju' | 'hongguo' }> = [
  { keyword: '热播剧', provider: 'kanju' },
  { keyword: '高分电影', provider: 'kanju' },
  { keyword: '动漫', provider: 'kanju' },
  { keyword: '综艺', provider: 'kanju' },
  { keyword: '短剧', provider: 'hongguo' },
]

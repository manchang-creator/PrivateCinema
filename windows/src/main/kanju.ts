// ==================== 在线片源客户端（看剧AI / kanju1.com）====================
// 主进程独占：渲染进程不接触签名密钥与原始报文，只拿到归一化后的领域对象。
//
// 该站是一个聚合前端，所有内容接口都要求请求签名（HMAC-SHA256）：
//   message = `${METHOD}\n${path?query}\n${timestamp}\n${nonce}`
//   signature = HMAC_SHA256(SECRET, message)  (hex)
// 头部：x-ai-movie-timestamp / x-ai-movie-nonce / x-ai-movie-signature +
//       固定的客户端标识头，服务端据此判定为本站前端而非爬虫。
//
// 播放链路：catalog → episodes（拿每集 token）→ playback/resolve（拿线路）
//   → 线路 url 为 `resolve://<ticket>` 时再经 playback/resolve-line 换成真实直链。
// 返回的 mp4 直链带时效签名，播放器按需重解析即可。

import { createHmac, randomBytes } from 'node:crypto'
import type {
  MediaKind,
  RemoteBrowsePage,
  RemoteCard,
  RemoteDetail,
  RemoteEpisode,
  RemoteHomeData,
  RemoteLine,
  RemotePlayback,
  RemoteSection,
} from '@private-cinema/core/shared'

const BASE = 'https://kanju1.com'
const SECRET = '557d0e4ae929f438da6bd84412374e6086b8af09b3fed54bf22601d5bf8c54a0'
const CLIENT_NAME = 'dianyingtiantang-frontend'
const CLIENT_VERSION = '1.0.0'
const BUILD_VERSION = 'dianyingtiantang-v2026.11.06.2-search-header-f6f73501a448-web'
const PROTOCOL_VERSION = '2026-07-05.library-v2.playback-v1'

// ==================== 签名请求 ====================

function buildQuery(query?: Record<string, string | number | undefined>): string {
  if (query === undefined) return ''
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === '') continue
    params.set(key, String(value))
  }
  const text = params.toString()
  return text === '' ? '' : `?${text}`
}

async function request<T>(
  pathname: string,
  options: {
    method?: 'GET' | 'POST'
    query?: Record<string, string | number | undefined>
    body?: unknown
  } = {},
): Promise<T> {
  const method = options.method ?? 'GET'
  const path = `${pathname}${buildQuery(options.query)}`
  const timestamp = String(Date.now())
  const nonce = randomBytes(16).toString('hex')
  const message = `${method}\n${path}\n${timestamp}\n${nonce}`
  const signature = createHmac('sha256', SECRET).update(message).digest('hex')

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'x-ai-movie-client-name': CLIENT_NAME,
    'x-ai-movie-client-version': CLIENT_VERSION,
    'x-ai-movie-build-version': BUILD_VERSION,
    'x-ai-movie-protocol-version': PROTOCOL_VERSION,
    'x-ai-movie-timestamp': timestamp,
    'x-ai-movie-nonce': nonce,
    'x-ai-movie-signature': signature,
    'x-ai-movie-site-host': 'kanju1.com',
    Origin: 'https://kanju1.com',
    Referer: 'https://kanju1.com/',
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
  }
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'

  const response = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
  if (!response.ok) {
    throw new Error(`看剧AI 接口失败：${method} ${pathname} → HTTP ${response.status}`)
  }
  return (await response.json()) as T
}

// ==================== 原始报文类型（仅本文件内使用）====================

interface RawCard {
  id: string
  title: string
  content_kind?: string
  year?: number
  area?: string
  genres?: string[]
  poster_url?: string
  remarks?: string
}

interface RawHome {
  sections?: Array<{
    id?: string
    title?: string
    subtitle?: string
    cards?: RawCard[]
  }>
}

interface RawBrowse {
  cards?: RawCard[]
  pagination?: { page?: number; has_more?: boolean }
}

interface RawDetail {
  id: string
  title: string
  content_kind?: string
  year?: number
  area?: string
  genres?: string[]
  description?: string
  poster_url?: string
  remarks?: string
  actors?: string[]
  directors?: string[]
  episode_count?: number
  total_episode_count?: number
}

interface RawEpisodes {
  episodes?: Array<{ id: string; token: string; number?: number; title?: string }>
}

interface RawLineOption {
  playback_source_id?: string
  id?: string
  label?: string
  display_label?: string
  provider_name?: string
  provider_id?: string
  url?: string
  url_kind?: string
  resolve_mode?: string
  resolve_ticket?: string
  selected?: boolean
}

interface RawResolve {
  line_options?: RawLineOption[]
}

interface RawResolveLine {
  line?: { url?: string; url_kind?: string; label?: string; provider_id?: string }
}

// ==================== 归一化 ====================

function mapKind(raw?: string): MediaKind {
  switch (raw) {
    case 'movie':
    case 'documentary':
      return 'movie'
    case 'anime':
      return 'anime'
    case 'variety':
    case 'sports':
      return 'variety'
    case 'series':
    case 'short_drama':
    case 'tv':
    default:
      return 'series'
  }
}

function mapCard(card: RawCard): RemoteCard {
  return {
    id: card.id,
    title: card.title,
    kind: mapKind(card.content_kind),
    year: card.year ?? 0,
    area: card.area ?? '',
    genres: card.genres ?? [],
    remarks: card.remarks ?? '',
    posterUrl: card.poster_url ?? '',
  }
}

// ==================== 对外接口 ====================

/** 首页聚合：所有分区。 */
export async function kanjuHome(): Promise<RemoteHomeData> {
  const raw = await request<RawHome>('/v1/feed/home', {
    query: { scope: 'public', mode: 'preview', sections: 6, cards: 12 },
  })
  const sections: RemoteSection[] = (raw.sections ?? [])
    .filter((section) => Array.isArray(section.cards) && section.cards.length > 0)
    .map((section, index) => ({
      id: section.id ?? `section-${index}`,
      title: section.title ?? '推荐',
      subtitle: section.subtitle ?? '',
      cards: (section.cards ?? []).map(mapCard),
    }))
  return { sections }
}

/** 分类浏览。kind 为 null 表示不限。 */
export async function kanjuBrowse(kind: MediaKind | null, page: number): Promise<RemoteBrowsePage> {
  const query: Record<string, string | number | undefined> = {
    page: Math.max(1, Math.trunc(page)),
    limit: 24,
    intent: 'latest_catalog',
  }
  if (kind !== null) query.kind = kind
  const raw = await request<RawBrowse>('/v1/browse/catalog', { query })
  return {
    cards: (raw.cards ?? []).map(mapCard),
    page: raw.pagination?.page ?? Math.max(1, Math.trunc(page)),
    hasMore: raw.pagination?.has_more === true,
  }
}

/** 搜索。 */
export async function kanjuSearch(keyword: string, page: number): Promise<RemoteBrowsePage> {
  const query: Record<string, string | number | undefined> = {
    q: keyword,
    page: Math.max(1, Math.trunc(page)),
    limit: 24,
  }
  const raw = await request<RawBrowse>('/v1/browse/catalog', { query })
  return {
    cards: (raw.cards ?? []).map(mapCard),
    page: raw.pagination?.page ?? Math.max(1, Math.trunc(page)),
    hasMore: raw.pagination?.has_more === true,
  }
}

/** 作品详情。 */
export async function kanjuDetail(mediaId: string): Promise<RemoteDetail> {
  const raw = await request<RawDetail>(`/v1/catalog/${encodeURIComponent(mediaId)}`)
  return {
    id: raw.id,
    title: raw.title,
    kind: mapKind(raw.content_kind),
    year: raw.year ?? 0,
    area: raw.area ?? '',
    genres: raw.genres ?? [],
    overview: raw.description ?? '',
    posterUrl: raw.poster_url ?? '',
    remarks: raw.remarks ?? '',
    actors: raw.actors ?? [],
    directors: raw.directors ?? [],
    episodeCount: raw.total_episode_count ?? raw.episode_count ?? 0,
  }
}

/** 选集列表。 */
export async function kanjuEpisodes(mediaId: string): Promise<RemoteEpisode[]> {
  const raw = await request<RawEpisodes>(`/v1/catalog/${encodeURIComponent(mediaId)}/episodes`)
  return (raw.episodes ?? []).map((episode, index) => ({
    id: episode.id,
    token: episode.token,
    number: episode.number ?? index + 1,
    title: episode.title ?? `第 ${episode.number ?? index + 1} 集`,
  }))
}

// ==================== 播放解析 ====================

function deriveUrlKind(url: string, declared?: string): 'mp4' | 'hls' {
  if (declared === 'hls' || declared === 'm3u8') return 'hls'
  if (declared === 'mp4') return 'mp4'
  if (/\.m3u8(?:$|[?#])/i.test(url)) return 'hls'
  return 'mp4'
}

/** 单条线路 → 真实直链。`resolve://<ticket>` 需二次兑换。 */
async function resolveLine(option: RawLineOption): Promise<{ url: string; urlKind: 'mp4' | 'hls' }> {
  const url = (option.url ?? '').trim()
  if (url.startsWith('http')) {
    return { url, urlKind: deriveUrlKind(url, option.url_kind) }
  }
  const ticket = url.startsWith('resolve://')
    ? url.slice('resolve://'.length)
    : (option.resolve_ticket ?? '').trim()
  if (ticket === '') throw new Error('线路缺少解析票据')
  const raw = await request<RawResolveLine>('/v1/playback/resolve-line', {
    method: 'POST',
    query: { view: 'compact' },
    body: { ticket },
  })
  const resolved = (raw.line?.url ?? '').trim()
  if (resolved === '') throw new Error('解析结果为空')
  return { url: resolved, urlKind: deriveUrlKind(resolved, raw.line?.url_kind) }
}

function toRemoteLines(options: RawLineOption[]): RemoteLine[] {
  return options.map((option, index) => {
    const id = option.playback_source_id ?? option.id ?? `line-${index}`
    const urlKind = deriveUrlKind(option.url ?? '', option.url_kind)
    return {
      id,
      label: option.label ?? option.display_label ?? option.provider_name ?? id,
      providerId: option.provider_id ?? '',
      urlKind,
    }
  })
}

/** 候选线路顺序：指定线路 > 默认选中 > 其余。 */
function orderOptions(options: RawLineOption[], lineId?: string): RawLineOption[] {
  const ordered: RawLineOption[] = []
  const seen = new Set<string>()
  const push = (option: RawLineOption): void => {
    const id = option.playback_source_id ?? option.id ?? ''
    if (seen.has(id)) return
    seen.add(id)
    ordered.push(option)
  }
  if (lineId !== undefined && lineId !== '') {
    const picked = options.find((option) => (option.playback_source_id ?? option.id) === lineId)
    if (picked !== undefined) push(picked)
  }
  const selected = options.find((option) => option.selected === true)
  if (selected !== undefined) push(selected)
  for (const option of options) push(option)
  return ordered
}

/**
 * 按集 token 解析播放地址。
 * 优先返回 mp4 直链（Chromium 原生可播）；全部为 HLS 时返回首个可解析结果。
 */
export async function kanjuResolve(episodeToken: string, lineId?: string): Promise<RemotePlayback> {
  const raw = await request<RawResolve>(`/v1/playback/resolve/${encodeURIComponent(episodeToken)}`)
  const options = raw.line_options ?? []
  if (options.length === 0) throw new Error('该集暂无可用线路')
  const remoteLines = toRemoteLines(options)

  let fallback: { url: string; urlKind: 'mp4' | 'hls'; option: RawLineOption } | null = null
  for (const option of orderOptions(options, lineId).slice(0, 12)) {
    let resolved: { url: string; urlKind: 'mp4' | 'hls' }
    try {
      resolved = await resolveLine(option)
    } catch {
      continue
    }
    if (resolved.urlKind === 'mp4') {
      return {
        url: resolved.url,
        urlKind: 'mp4',
        lineId: option.playback_source_id ?? option.id ?? '',
        lineLabel: option.label ?? option.display_label ?? option.provider_name ?? '',
        lines: remoteLines,
      }
    }
    if (fallback === null) fallback = { ...resolved, option }
  }

  if (fallback !== null) {
    return {
      url: fallback.url,
      urlKind: fallback.urlKind,
      lineId: fallback.option.playback_source_id ?? fallback.option.id ?? '',
      lineLabel: fallback.option.label ?? fallback.option.display_label ?? '',
      lines: remoteLines,
    }
  }
  throw new Error('全部线路解析失败')
}

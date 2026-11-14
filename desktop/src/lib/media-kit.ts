// ==================== 作品 → 可播播放列表 ====================
// 首页 / 片库 / 搜索 / 追剧 / 详情都可能发起播放。这里把「远端作品 → Episode[]」
// 与「本地作品 → Episode[]」的拼装收在一处，避免五处各写一份、字段逐渐漂移。

import type { Episode, MediaItem } from '@private-cinema/core/shared'

export function sortEpisodes(list: Episode[]): Episode[] {
  return [...list].sort((a, b) => a.seasonIndex - b.seasonIndex || a.index - b.index)
}

/** 远端作品：把详情 + 选集（token）拍成本地同构的 MediaItem / Episode。 */
export function remotePlaylist(
  provider: string,
  card: { id: string; title: string; kind: string; year: number; cover?: string; remarks?: string },
  episodes: ReadonlyArray<{ id: string; number: number; title: string; token: string }>,
  extra?: {
    overview?: string
    genres?: string[]
    posterUrl?: string
    episodeCount?: number
    remarks?: string
  },
): { media: MediaItem; playlist: Episode[] } {
  const media: MediaItem = {
    id: card.id,
    title: card.title,
    kind: card.kind as MediaItem['kind'],
    year: card.year,
    genres: extra?.genres ?? [],
    durationMinutes: 0,
    overview: extra?.overview ?? '',
    source: provider as MediaItem['source'],
    posterUrl: extra?.posterUrl ?? card.cover ?? '',
    remarks: extra?.remarks ?? card.remarks ?? '',
    episodeCount: extra?.episodeCount ?? episodes.length,
  }
  const playlist: Episode[] = episodes.map((item) => ({
    id: item.id,
    mediaId: card.id,
    seasonIndex: 0,
    index: item.number,
    title: item.title,
    duration: 0,
    filePath: '',
    source: provider as Episode['source'],
    episodeToken: item.token,
  }))
  return { media, playlist }
}

/** 本地作品：作品下的所有集，按季/集排序。 */
export function localPlaylist(
  media: MediaItem,
  allEpisodes: ReadonlyArray<Episode>,
): { media: MediaItem; playlist: Episode[] } {
  return {
    media,
    playlist: sortEpisodes(allEpisodes.filter((item) => item.mediaId === media.id)),
  }
}

/**
 * 空封面兜底用的短标题：最多 4 个字，按字数决定字号。
 * 只取首字（monogram）时用户分不清「本来没图」和「图挂了」，所以整段短标题更好认。
 */
export function shortTitle(title: string): string {
  const chars = Array.from(title.trim())
  if (chars.length === 0) return '暂无片名'
  return chars.length > 4 ? `${chars.slice(0, 4).join('')}…` : chars.join('')
}

/** 兜底标题字号：2 字最大，4 字最小，保证在 3:4 卡面里不溢出。 */
export function shortTitleSize(title: string): number {
  const n = Math.min(Math.max(Array.from(title.trim()).length, 2), 4)
  return [0, 0, 26, 22, 19][n] ?? 19
}

export function kindLabel(kind: string): string {
  switch (kind) {
    case 'movie':
      return '电影'
    case 'series':
      return '剧集'
    case 'anime':
      return '动漫'
    case 'variety':
      return '综艺'
    default:
      return '影片'
  }
}

export function percentOf(position: number, duration: number): number {
  if (duration <= 0) return 0
  return Math.max(0, Math.min(100, Math.round((position / duration) * 100)))
}

// ==================== 本地媒体扫描 ====================
// 移植自 iOS `LocalMediaProvider`，语义对齐：
// - 只认本地视频扩展名（mp4 / m4v / mov / mkv / webm）
// - 单文件 = 单集
// - 同一目录下文件名匹配 `SxxEyy` 且前缀相同的文件归为同一部剧
//
// 与 iOS 的差异：Windows 端没有沙盒，路径是绝对路径；
// 剧集归组放在扫描阶段完成（iOS 是每个文件一部作品）。

import { readdir, stat } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import type { Episode, MediaItem, MediaKind } from '@shared/types'
import type { LibraryScan } from '@shared/ipc'

const VIDEO_EXTENSIONS = new Set(['.mp4', '.m4v', '.mov', '.mkv', '.webm'])

/** 剧集命名：`名字.S01E02.标题.mp4`；大小写与分隔符都放宽。 */
const EPISODE_PATTERN = /^(.*?)[.\s_-]*[Ss](\d{1,2})[.\s_-]*[Ee](\d{1,3})(.*)$/

export function isVideoFile(path: string): boolean {
  return VIDEO_EXTENSIONS.has(extname(path).toLowerCase())
}

/** 从文件名推断剧集信息；不匹配返回 null。 */
export function parseEpisodeName(fileName: string): {
  seriesTitle: string
  seasonIndex: number
  index: number
  episodeTitle: string
} | null {
  const stem = basename(fileName, extname(fileName))
  const match = EPISODE_PATTERN.exec(stem)
  if (match === null) return null

  const [, rawTitle, rawSeason, rawEpisode, rawRest] = match
  const seriesTitle = cleanTitle(rawTitle)
  if (seriesTitle === '') return null

  const episodeTitle = rawRest.replace(/^[.\s_-]+/, '').replace(/[._]/g, ' ').trim()
  return {
    seriesTitle,
    seasonIndex: Number.parseInt(rawSeason, 10),
    index: Number.parseInt(rawEpisode, 10),
    episodeTitle: episodeTitle === '' ? `第 ${Number.parseInt(rawEpisode, 10)} 集` : episodeTitle,
  }
}

/** 把 `[组名] 片名 (2020) 1080p` 收敛成可读标题。 */
export function cleanTitle(raw: string): string {
  return raw
    .replace(/^\[[^\]]*\]\s*/, '')
    .replace(/[._]+/g, ' ')
    .replace(/\s*\(\d{4}\)\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 递归列出目录下的视频文件（最多 4 层，避免误扫盘根）。 */
export async function collectVideoFiles(root: string, depth = 4): Promise<string[]> {
  const found: string[] = []
  const entries = await readdir(root, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const full = join(root, entry.name)
    if (entry.isDirectory()) {
      if (depth > 0) found.push(...(await collectVideoFiles(full, depth - 1)))
      continue
    }
    if (entry.isFile() && isVideoFile(full)) found.push(full)
  }
  return found.sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
}

/** 把一批视频文件归组成媒体条目。 */
export async function buildLibrary(files: string[]): Promise<LibraryScan> {
  const grouped = new Map<string, { title: string; files: EpisodeDraft[] }>()
  const movies: EpisodeDraft[] = []

  for (const path of files) {
    const parsed = parseEpisodeName(path)
    if (parsed === null) {
      movies.push({ path, title: cleanTitle(basename(path, extname(path))), index: 1, season: 1 })
      continue
    }
    const key = parsed.seriesTitle
    const bucket = grouped.get(key) ?? { title: parsed.seriesTitle, files: [] }
    bucket.files.push({
      path,
      title: parsed.episodeTitle,
      index: parsed.index,
      season: parsed.seasonIndex,
    })
    grouped.set(key, bucket)
  }

  const items: MediaItem[] = []
  const episodes: Episode[] = []

  for (const draft of movies) {
    const mediaId = `local-${items.length}-${slug(draft.title)}`
    const media = await makeMediaItem(mediaId, draft.title, 'movie', draft.path)
    items.push(media)
    episodes.push(makeEpisode(media, draft))
  }

  for (const bucket of grouped.values()) {
    const mediaId = `local-${items.length}-${slug(bucket.title)}`
    const first = bucket.files[0].path
    const media = await makeMediaItem(mediaId, bucket.title, 'series', first)
    items.push(media)
    const ordered = [...bucket.files].sort((a, b) => a.season - b.season || a.index - b.index)
    for (const draft of ordered) episodes.push(makeEpisode(media, draft))
  }

  return { items, episodes }
}

interface EpisodeDraft {
  path: string
  title: string
  index: number
  season: number
}

function makeEpisode(media: MediaItem, draft: EpisodeDraft): Episode {
  return {
    id: `${media.id}#s${draft.season}e${draft.index}`,
    mediaId: media.id,
    seasonIndex: draft.season,
    index: draft.index,
    title: draft.title,
    // 时长为 0：以视频实际解码时长为准，扫描阶段不解码
    duration: 0,
    filePath: draft.path,
  }
}

async function makeMediaItem(
  id: string,
  title: string,
  kind: MediaKind,
  samplePath: string,
): Promise<MediaItem> {
  const info = await stat(samplePath).catch(() => null)
  return {
    id,
    title,
    kind,
    year: extractYear(title),
    genres: [],
    durationMinutes: 0,
    overview: '',
    filePath: samplePath,
    // 供界面展示「文件大小」，缺失时留空
    sizeBytes: info?.size ?? 0,
  }
}

function extractYear(title: string): number {
  const match = /\((\d{4})\)/.exec(title)
  return match === null ? 0 : Number.parseInt(match[1], 10)
}

/** 生成稳定的 ASCII id 片段，避免中文路径进入 id。 */
function slug(title: string): string {
  const ascii = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (ascii !== '') return ascii
  // 纯中文标题：用简单哈希保证同一标题每次得到同一 id
  let hash = 0
  for (let i = 0; i < title.length; i += 1) {
    hash = (hash * 31 + title.charCodeAt(i)) >>> 0
  }
  return `h${hash.toString(36)}`
}

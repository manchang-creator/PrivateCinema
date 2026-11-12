// ==================== 领域模型 ====================
// 与 iOS 端 CinemaKit 保持同名同义：两端共用一套概念，便于对照移植。
// 字段命名用 camelCase，时间单位统一为「秒」。

/** 内容类型。与 iOS `MediaKind` 对齐。 */
export type MediaKind = 'movie' | 'series' | 'anime' | 'variety'

/** 媒体来源标识：本地扫描的文件，或在线片源（如「看剧AI」）。 */
export type MediaSourceId = 'local' | 'kanju'

/** 统一的媒体条目。电影与剧集共用一个模型，用 `kind` 区分。 */
export interface MediaItem {
  id: string
  title: string
  kind: MediaKind
  year: number
  genres: string[]
  durationMinutes: number
  overview: string
  /** 本地文件路径；远端源为空 */
  filePath?: string
  /** 文件大小（字节）；0 表示未知，仅用于界面展示 */
  sizeBytes?: number
  /** 来源标识；缺省视为本地 */
  source?: MediaSourceId
  /** 远端源封面图 URL */
  posterUrl?: string
  /** 更新信息 / 备注（如「更新至 16 集」） */
  remarks?: string
  /** 剧集总数；0 或未提供表示未知 */
  episodeCount?: number
}

/** 单集。本地源一文件一集；远端源靠 `episodeToken` 现解析播地址。 */
export interface Episode {
  id: string
  mediaId: string
  seasonIndex: number
  /** 1-based 集序号 */
  index: number
  title: string
  /** 秒；0 表示未知（以视频实际时长为准） */
  duration: number
  /** 本地文件路径；远端源为空字符串 */
  filePath: string
  /** 来源标识；缺省视为本地 */
  source?: MediaSourceId
  /** 远端源解析播放所需的集 token（本地源为空） */
  episodeToken?: string
}

/** 播放线路描述：只说明「有哪些线路」，不含地址。 */
export interface PlayLine {
  id: string
  name: string
}

/** 某条线路解析出的、可直接交给播放器的地址。 */
export interface ResolvedPlayback {
  url: string
  urlKind: 'mp4' | 'hls' | 'file'
}

/** 一次播放会话的请求描述。 */
export interface PlaybackRequest {
  media: MediaItem
  episode: Episode
  /** 同一部作品的完整播放列表（供上一集 / 下一集使用） */
  playlist: Episode[]
  /** 起始位置（秒）；null 表示读取历史进度 */
  startPosition: number | null
}

/** 弹幕类型。 */
export type DanmakuType = 'scroll' | 'top' | 'bottom'

/** 弹幕领域模型：`time` 为视频时间点（秒）。 */
export interface DanmakuItem {
  id: string
  mediaId: string
  episodeId: string
  time: number
  content: string
  type: DanmakuType
  /** "#FFFFFF" 十六进制颜色 */
  color: string
  userId: string
  createdAt: string
}

/** 播放进度。 */
export interface WatchProgress {
  mediaId: string
  episodeId: string
  mediaTitle: string
  episodeTitle: string
  episodeIndex: number
  /** 秒 */
  position: number
  /** 秒 */
  duration: number
  lastPlayedAt: string
  completed: boolean
}

/** 播放超过 90% 视为看完。与 iOS `WatchProgress.isCompleted` 一致。 */
export function isCompleted(position: number, duration: number): boolean {
  if (duration <= 0) return false
  return position / duration >= 0.9
}

/** 进度百分比，0 ~ 1。 */
export function progressPercent(position: number, duration: number): number {
  if (duration <= 0) return 0
  return Math.min(1, Math.max(0, position / duration))
}

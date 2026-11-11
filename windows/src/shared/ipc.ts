// ==================== IPC 契约 ====================
// 主进程 / 预加载 / 渲染进程三方共享的唯一接口定义。
// 改这里 = 改协议，三端必须同步；渲染进程只通过 `window.cinema` 访问。

import type { Episode, MediaItem, WatchProgress } from './types'

/** 扫描结果：一部「作品」对应一个条目 + 至少一集。 */
export interface LibraryScan {
  items: MediaItem[]
  episodes: Episode[]
}

/** 播放进度读写的最小单元。 */
export interface ProgressQuery {
  mediaId: string
  episodeId: string
}

/**
 * 一台显示器的亮度状态。
 * 可用与不可用互斥，用联合类型表达 —— 让「available 但没有范围」这种非法状态无法构造。
 */
export type DisplayBrightness =
  | {
      /** 稳定标识：`\\.\DISPLAY1` 这类设备名，同一台机器上稳定。 */
      id: string
      /** 界面展示名：优先物理显示器描述，取不到时退回设备名。 */
      label: string
      primary: boolean
      available: true
      current: number
      min: number
      max: number
    }
  | {
      id: string
      label: string
      primary: boolean
      available: false
      /** 不可用原因（中文）。不可用必须给原因，不允许静默。 */
      reason: string
    }

/** 亮度写入结果：失败必须带原因。 */
export type BrightnessWriteResult = { ok: true } | { ok: false; reason: string }

/** 主进程暴露给渲染进程的能力集合。 */
export interface CinemaApi {
  /** 选择视频文件（可多选），返回扫描结果。取消返回 null。 */
  pickVideos(): Promise<LibraryScan | null>
  /** 选择文件夹并递归扫描其中的视频，返回扫描结果。取消返回 null。 */
  pickFolder(): Promise<LibraryScan | null>
  /** 在视频同目录下按同名规则查找字幕，找到则返回文本内容。 */
  findSubtitle(videoPath: string): Promise<SubtitleFile | null>
  /** 手动选择字幕文件。取消返回 null。 */
  pickSubtitle(): Promise<SubtitleFile | null>
  /** 读取某集的播放进度；无记录返回 null。 */
  loadProgress(query: ProgressQuery): Promise<WatchProgress | null>
  /** 写入某集的播放进度。 */
  saveProgress(progress: WatchProgress): Promise<void>
  /** 列出全部进度（按最近播放倒序），用于「继续观看」。 */
  listProgress(): Promise<WatchProgress[]>
  /** 删除某集进度。 */
  removeProgress(query: ProgressQuery): Promise<void>
  /** 列出所有显示器的亮度状态；不可用的也会返回并附带原因。 */
  listDisplays(): Promise<DisplayBrightness[]>
  /** 设置某台显示器的亮度，值会被收敛到该显示器支持的范围。 */
  setBrightness(id: string, value: number): Promise<BrightnessWriteResult>
}

/** 字幕文件内容：文件名仅用于界面展示。 */
export interface SubtitleFile {
  name: string
  content: string
}

// ==================== IPC 通道名 ====================
// 集中定义，禁止在两端各写字符串字面量 —— 拼错只会静默失败。

export const IPC = {
  pickVideos: 'library:pick-videos',
  pickFolder: 'library:pick-folder',
  findSubtitle: 'subtitle:find',
  pickSubtitle: 'subtitle:pick',
  loadProgress: 'progress:load',
  saveProgress: 'progress:save',
  listProgress: 'progress:list',
  removeProgress: 'progress:remove',
  listDisplays: 'brightness:list',
  setBrightness: 'brightness:set',
} as const

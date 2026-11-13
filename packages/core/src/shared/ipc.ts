// ==================== IPC 契约 ====================
// 主进程 / 预加载 / 渲染进程三方共享的唯一接口定义。
// 改这里 = 改协议，三端必须同步；渲染进程只通过 `window.cinema` 访问。

import type { DanmakuItem, Episode, MediaItem, MediaKind, WatchProgress } from './types'

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

// ==================== 在线片源（多源）====================
// 主进程代渲染进程请求远端并签名；渲染进程只拿到已归一化的领域数据。
// 播放地址按集 token 现解析，所得 URL 短时有效，过期后由播放器重新解析。
// 具体片源由 `provider` 参数区分：`kanju`（看剧AI）/ `hongguo`（红果短剧）。

/** 在线片源标识。与本地 `local` 一起构成 `MediaSourceId`。 */
export type RemoteProviderId = 'kanju' | 'hongguo'

/** 在线片源的展示元信息（渲染进程据此渲染片源切换按钮）。 */
export interface RemoteProviderInfo {
  id: RemoteProviderId
  name: string
  description: string
}

/** 已接入的在线片源清单，唯一事实源。 */
export const REMOTE_PROVIDERS: ReadonlyArray<RemoteProviderInfo> = [
  { id: 'kanju', name: '看剧AI', description: '聚合片源（电影 / 剧集 / 动漫 / 综艺）' },
  { id: 'hongguo', name: '红果短剧', description: '短剧专区（真人短剧 / 漫剧）' },
]

/** 远端片库卡片。字段已归一化为领域模型所需的最小集。 */
export interface RemoteCard {
  id: string
  title: string
  kind: MediaKind
  year: number
  area: string
  genres: string[]
  remarks: string
  posterUrl: string
}

/** 首页聚合的一个分区（如「大家都在看」「高分电影」）。 */
export interface RemoteSection {
  id: string
  title: string
  subtitle: string
  cards: RemoteCard[]
}

/** 首页聚合数据。 */
export interface RemoteHomeData {
  sections: RemoteSection[]
}

/** 分类浏览 / 搜索的一页结果。 */
export interface RemoteBrowsePage {
  cards: RemoteCard[]
  page: number
  hasMore: boolean
}

/** 远端作品详情。 */
export interface RemoteDetail {
  id: string
  title: string
  kind: MediaKind
  year: number
  area: string
  genres: string[]
  overview: string
  posterUrl: string
  remarks: string
  actors: string[]
  directors: string[]
  episodeCount: number
}

/** 远端作品的一集（token 用于解析播放地址）。 */
export interface RemoteEpisode {
  id: string
  token: string
  number: number
  title: string
}

/** 可用播放线路（只描述线路，不含地址）。 */
export interface RemoteLine {
  id: string
  label: string
  providerId: string
  urlKind: 'mp4' | 'hls'
}

/** 解析后的播放结果：可直接交给 `<video>` 的地址 + 可选线路清单。 */
export interface RemotePlayback {
  url: string
  urlKind: 'mp4' | 'hls'
  lineId: string
  lineLabel: string
  lines: RemoteLine[]
}

/**
 * 一台显示器的亮度状态。
 * 可用与不可用互斥，用联合类型表达 —— 让「available 但没有范围」这种非法状态无法构造。
 */
export type DisplayBrightness =
  | {
      /**
       * 稳定标识，由各平台主进程定义命名空间：
       * Windows = 系统设备名（如 `\\.\DISPLAY1`）；Linux = `sysfs:<背光名>` / `ddc:<i2c 总线号>`。
       */
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
  /**
   * 用外部播放器打开一个本地文件（MKV 等 WebView 不支持的容器）。
   * 返回所用播放器名。可选：旧 Electron 壳未实现。
   */
  playExternal?(filePath: string): Promise<string>

  // ---------- 在线片源（多源）----------
  /** 拉取在线首页聚合（多个分区）。 */
  remoteHome(provider: RemoteProviderId): Promise<RemoteHomeData>
  /** 在线分类浏览；kind 为 null 表示不限类型。 */
  remoteBrowse(
    provider: RemoteProviderId,
    kind: MediaKind | null,
    page: number,
  ): Promise<RemoteBrowsePage>
  /** 在线搜索。 */
  remoteSearch(
    provider: RemoteProviderId,
    keyword: string,
    page: number,
  ): Promise<RemoteBrowsePage>
  /** 在线作品详情。 */
  remoteDetail(provider: RemoteProviderId, mediaId: string): Promise<RemoteDetail>
  /** 在线作品选集列表。 */
  remoteEpisodes(provider: RemoteProviderId, mediaId: string): Promise<RemoteEpisode[]>
  /** 按集 token 解析出可直接播放的地址；lineId 指定线路时优先使用该线路。 */
  remoteResolve(
    provider: RemoteProviderId,
    episodeToken: string,
    lineId?: string,
  ): Promise<RemotePlayback>
  /** 拉取一集的弹幕（红果有真实精选弹幕，其余片源返回空）。 */
  remoteDanmaku(
    provider: RemoteProviderId,
    seriesId: string,
    episodeId: string,
  ): Promise<DanmakuItem[]>

  // ---------- 应用更新 ----------
  /** 应用与更新元信息（版本 / 平台 / 是否启用更新 / 自动更新开关）。 */
  appInfo(): Promise<AppInfo>
  /** 检查更新（未启用更新的构建返回 enabled=false）。 */
  checkUpdate(): Promise<UpdateInfo>
  /** 下载并安装检查到的更新（不自动重启）。 */
  installUpdate(): Promise<void>
  /** 重启应用，让已安装的更新生效。 */
  restartApp(): Promise<void>
  /** 读取「自动更新」开关。 */
  getAutoUpdate(): Promise<boolean>
  /** 设置「自动更新」开关。 */
  setAutoUpdate(enabled: boolean): Promise<void>
}

/** 应用与更新元信息。 */
export interface AppInfo {
  version: string
  platform: string
  isDev: boolean
  updatesEnabled: boolean
  autoUpdate: boolean
}

/** 一次「检查更新」的结果。 */
export interface UpdateInfo {
  enabled: boolean
  available: boolean
  current: string
  version: string
  notes: string
  date: string
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
  remoteHome: 'remote:home',
  remoteBrowse: 'remote:browse',
  remoteSearch: 'remote:search',
  remoteDetail: 'remote:detail',
  remoteEpisodes: 'remote:episodes',
  remoteResolve: 'remote:resolve',
} as const

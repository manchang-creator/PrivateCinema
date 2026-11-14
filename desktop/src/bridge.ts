// ==================== window.cinema 适配层 ====================
// 现有 React 组件全部通过 window.cinema 调后端（原 Electron preload 注入）。
// mygo 用 `mygo generate` 生成的类型化客户端调用 Go；这里把客户端包成与旧 CinemaApi
// 完全相同的对象，组件代码无需改动。启动时先取媒体基址，再挂载 React。
//
// 说明：生成客户端的类型与 `@private-cinema/core` 的联合类型在“字面量/可空”上不完全一致
// （如 available: boolean vs 判别联合、urlKind: string vs "mp4"|"hls"），这里在边界处
// 统一收敛为 CinemaApi，避免把两套类型定义强行合并。

import type { CinemaApi } from "@private-cinema/core/shared";
import { Cinema } from "./mygo";
import { setMediaBase } from "./media";

export async function installCinemaBridge(): Promise<void> {
  const base = await Cinema.mediaBase();
  setMediaBase(base);

  const api = {
    pickVideos: () => Cinema.pickVideos(),
    pickFolder: () => Cinema.pickFolder(),
    findSubtitle: (videoPath: string) => Cinema.findSubtitle(videoPath),
    pickSubtitle: () => Cinema.pickSubtitle(),
    loadProgress: (query: Parameters<typeof Cinema.loadProgress>[0]) => Cinema.loadProgress(query),
    saveProgress: (progress: Parameters<typeof Cinema.saveProgress>[0]) => Cinema.saveProgress(progress),
    listProgress: () => Cinema.listProgress(),
    removeProgress: (query: Parameters<typeof Cinema.removeProgress>[0]) => Cinema.removeProgress(query),
    listDisplays: () => Cinema.listDisplays(),
    setBrightness: (id: string, value: number) => Cinema.setBrightness(id, value),
    playExternal: (filePath: string) => Cinema.playExternal(filePath),
    remoteHome: (provider: Parameters<typeof Cinema.remoteHome>[0]) => Cinema.remoteHome(provider),
    remoteBrowse: (provider: Parameters<typeof Cinema.remoteBrowse>[0], kind: string | null, page: number) =>
      Cinema.remoteBrowse(provider, kind ?? "", page),
    remoteSearch: (provider: Parameters<typeof Cinema.remoteSearch>[0], keyword: string, page: number) =>
      Cinema.remoteSearch(provider, keyword, page),
    remoteDetail: (provider: Parameters<typeof Cinema.remoteDetail>[0], mediaId: string) =>
      Cinema.remoteDetail(provider, mediaId),
    remoteEpisodes: (provider: Parameters<typeof Cinema.remoteEpisodes>[0], mediaId: string) =>
      Cinema.remoteEpisodes(provider, mediaId),
    remoteResolve: (provider: Parameters<typeof Cinema.remoteResolve>[0], episodeToken: string, lineId?: string) =>
      Cinema.remoteResolve(provider, episodeToken, lineId ?? ""),
    remoteDanmaku: (provider: Parameters<typeof Cinema.remoteDanmaku>[0], seriesId: string, episodeId: string) =>
      Cinema.remoteDanmaku(provider, seriesId, episodeId),
    appInfo: () => Cinema.appInfo(),
    checkUpdate: () => Cinema.checkUpdate(),
    installUpdate: () => Cinema.installUpdate(),
    restartApp: () => Cinema.restartApp(),
    getAutoUpdate: () => Cinema.getAutoUpdate(),
    setAutoUpdate: (enabled: boolean) => Cinema.setAutoUpdate(enabled),
    compactMode: () => Cinema.compactMode(),
    setCompactMode: (enabled: boolean) => Cinema.setCompactMode(enabled),
    alwaysOnTop: () => Cinema.alwaysOnTop(),
    setAlwaysOnTop: (enabled: boolean) => Cinema.setAlwaysOnTop(enabled),
  } as unknown as CinemaApi;

  window.cinema = api;
}

// ==================== 预加载脚本 ====================
// 唯一职责：把主进程的 IPC 通道包成一份最小、显式的能力对象挂到 `window.cinema`。
// contextIsolation 开启，渲染进程拿不到 Node 与 ipcRenderer 本体，
// 只能调用这里列出的方法 —— 能力边界即安全边界。

import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type CinemaApi, type ProgressQuery, type SubtitleFile } from '@private-cinema/core/shared'
import type { WatchProgress } from '@private-cinema/core/shared'

const api: CinemaApi = {
  pickVideos: () => ipcRenderer.invoke(IPC.pickVideos),
  pickFolder: () => ipcRenderer.invoke(IPC.pickFolder),
  findSubtitle: (videoPath: string) => ipcRenderer.invoke(IPC.findSubtitle, videoPath),
  pickSubtitle: (): Promise<SubtitleFile | null> => ipcRenderer.invoke(IPC.pickSubtitle),
  loadProgress: (query: ProgressQuery) => ipcRenderer.invoke(IPC.loadProgress, query),
  saveProgress: (progress: WatchProgress) => ipcRenderer.invoke(IPC.saveProgress, progress),
  listProgress: () => ipcRenderer.invoke(IPC.listProgress),
  removeProgress: (query: ProgressQuery) => ipcRenderer.invoke(IPC.removeProgress, query),
  listDisplays: () => ipcRenderer.invoke(IPC.listDisplays),
  setBrightness: (id: string, value: number) => ipcRenderer.invoke(IPC.setBrightness, id, value),
}

contextBridge.exposeInMainWorld('cinema', api)

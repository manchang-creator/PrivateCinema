import { app, BrowserWindow, dialog, ipcMain, protocol, shell } from 'electron'
import { join } from 'node:path'
import { IPC, type ProgressQuery, type SubtitleFile } from '@shared/ipc'
import { MEDIA_SCHEME } from '@shared/media-url'
import type { WatchProgress } from '@shared/types'
import { buildLibrary, collectVideoFiles } from './library'
import { MediaAccessRegistry } from './media-access'
import { handleMediaRequest } from './media-protocol'
import { ProgressStore } from './progress'
import { findSubtitleFor, readSubtitle } from './subtitle-file'

// ==================== 主进程入口 ====================
// 职责边界：窗口生命周期 + IPC 处理 + 本地文件访问。
// 播放解码、弹幕、字幕渲染全部在渲染进程，主进程不碰媒体数据。

let mainWindow: BrowserWindow | null = null
let progressStore: ProgressStore | null = null

/** 协议层授权表：只放行用户在本进程内主动选择过的文件。 */
const mediaAccess = new MediaAccessRegistry()

function store(): ProgressStore {
  progressStore ??= new ProgressStore(app.getPath('userData'))
  return progressStore
}

// ==================== 本地媒体协议 ====================
// 渲染进程拿不到 `file://`（webSecurity 开启），而 `<video src>` 需要可流式读取的 URL。
// 这里注册专用协议，只放行媒体 / 字幕扩展名，避免渲染进程获得任意文件读取能力。
// `stream: true` 是拖动进度条（Range 请求）的前提。
protocol.registerSchemesAsPrivileged([
  {
    scheme: MEDIA_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
])

function registerMediaProtocol(): void {
  protocol.handle(MEDIA_SCHEME, (request) =>
    handleMediaRequest(request, (filePath) => mediaAccess.isAllowed(filePath)),
  )
}

// ==================== 窗口 ====================
function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#0b0b0d',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
    },
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())

  // 外部链接交给系统浏览器，不在应用内打开
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  const devServer = process.env.ELECTRON_RENDERER_URL
  if (devServer !== undefined && devServer !== '') {
    void mainWindow.loadURL(devServer)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// ==================== IPC ====================
function registerIpc(): void {
  ipcMain.handle(IPC.pickVideos, async () => {
    const result = await dialog.showOpenDialog({
      title: '选择视频文件',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: '视频', extensions: ['mp4', 'm4v', 'mov', 'mkv', 'webm'] },
        { name: '全部文件', extensions: ['*'] },
      ],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    mediaAccess.authorize(result.filePaths)
    return buildLibrary(result.filePaths)
  })

  ipcMain.handle(IPC.pickFolder, async () => {
    const result = await dialog.showOpenDialog({
      title: '选择媒体文件夹',
      properties: ['openDirectory'],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const files = await collectVideoFiles(result.filePaths[0])
    if (files.length === 0) return { items: [], episodes: [] }
    mediaAccess.authorize(files)
    return buildLibrary(files)
  })

  ipcMain.handle(IPC.findSubtitle, async (_event, videoPath: unknown) => {
    if (typeof videoPath !== 'string') return null
    return findSubtitleFor(videoPath)
  })

  ipcMain.handle(IPC.pickSubtitle, async (): Promise<SubtitleFile | null> => {
    const result = await dialog.showOpenDialog({
      title: '选择字幕文件',
      properties: ['openFile'],
      filters: [{ name: '字幕', extensions: ['srt', 'vtt'] }],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return readSubtitle(result.filePaths[0])
  })

  ipcMain.handle(IPC.loadProgress, async (_event, query: ProgressQuery) =>
    store().load(query.mediaId, query.episodeId),
  )

  ipcMain.handle(IPC.saveProgress, async (_event, progress: WatchProgress) => {
    await store().save(progress)
  })

  ipcMain.handle(IPC.listProgress, async () => store().list())

  ipcMain.handle(IPC.removeProgress, async (_event, query: ProgressQuery) => {
    await store().remove(query.mediaId, query.episodeId)
  })

  // 亮度：FFI 是同步的，DDC/CI 单次读写通常在几十毫秒量级，直接在主进程跑。
  // 失败一律返回带原因的结果，不抛异常 —— 异常经 IPC 序列化后只剩一句字符串，丢掉错误码。
  // 动态导入：koffi 是原生模块，加载失败不该拖垮整个应用启动，只让亮度能力失效。
  // 加载失败就让异常冒到渲染进程 —— 那里会显示真实原因，不静默返回空列表。
  ipcMain.handle(IPC.listDisplays, async () => {
    const { listDisplays } = await import('./brightness')
    return listDisplays()
  })

  ipcMain.handle(IPC.setBrightness, async (_event, id: unknown, value: unknown) => {
    if (typeof id !== 'string' || typeof value !== 'number') {
      return { ok: false, reason: '参数非法：需要显示器标识与数字亮度' }
    }
    const { setDisplayBrightness } = await import('./brightness')
    return setDisplayBrightness(id, value)
  })
}

// ==================== 生命周期 ====================
void app.whenReady().then(() => {
  registerMediaProtocol()
  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

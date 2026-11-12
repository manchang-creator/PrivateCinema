import { app, BrowserWindow, dialog, ipcMain, protocol, shell } from 'electron'
import { join } from 'node:path'
import {
  IPC,
  MEDIA_SCHEME,
  type BrightnessWriteResult,
  type MediaKind,
  type ProgressQuery,
  type SubtitleFile,
  type WatchProgress,
} from '@private-cinema/core/shared'
import { buildLibrary, collectVideoFiles } from './library'
import {
  kanjuBrowse,
  kanjuDetail,
  kanjuEpisodes,
  kanjuHome,
  kanjuResolve,
  kanjuSearch,
} from './kanju'
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
    // Linux 下自绘外观：不加菜单栏，标题栏走桌面环境默认
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

  // 亮度：sysfs 读写在主进程里是微秒级；ddcutil 走子进程（8s 超时），
  // 两次调用之间靠渲染层的「最多一个在途」节流控制节奏，这里不做额外排队。
  // 失败一律返回带原因的结果，不抛异常 —— 异常经 IPC 序列化后只剩一句字符串。
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

  // 在线片源：所有远端请求（含签名）都在主进程完成，密钥不出主进程。
  ipcMain.handle(IPC.remoteHome, async () => kanjuHome())

  ipcMain.handle(IPC.remoteBrowse, async (_event, kind: MediaKind | null, page: number) =>
    kanjuBrowse(kind ?? null, Number(page) || 1),
  )

  ipcMain.handle(IPC.remoteSearch, async (_event, keyword: string, page: number) =>
    kanjuSearch(String(keyword ?? ''), Number(page) || 1),
  )

  ipcMain.handle(IPC.remoteDetail, async (_event, mediaId: string) => kanjuDetail(String(mediaId)))

  ipcMain.handle(IPC.remoteEpisodes, async (_event, mediaId: string) =>
    kanjuEpisodes(String(mediaId)),
  )

  ipcMain.handle(IPC.remoteResolve, async (_event, episodeToken: string, lineId?: string) =>
    kanjuResolve(String(episodeToken), lineId),
  )
}

// ==================== 命令行自检 ====================
// `--self-check` 走与界面完全相同的 IPC 处理函数，把结果打到 stdout 后退出。
// 用途：无键盘 / 远程 / CI 环境下确认「主进程能起来、IPC 能通、亮度能枚举」，
// 不必靠人眼看窗口。它不测播放（那需要真实视频文件与交互）。
// 注意：必须用 electron-builder 产出的包运行（`release/linux-unpacked/private-cinema
// --self-check`）。直接 `electron out/main/index.js --self-check` 在本机 X11 环境会卡住，
// 已确认与自检代码无关（连空脚本都卡），属 Electron 直跑的环境问题，不要去改它。

// 自检结果必须先把 stdout 写完再退出：stdout 指向管道时 write 是异步的，
// 直接 app.exit 会截断输出；而入口处的进程级 exit 又会让 Electron 继续跑事件循环。
function writeSelfCheck(text: string): void {
  process.stdout.write(text, () => app.exit(0))
}

async function runSelfCheck(): Promise<void> {
  const { listDisplays, setDisplayBrightness } = await import('./brightness')
  const displays = await listDisplays()

  // 可用的显示器做一次「读当前值再写回原值」的往返：绝不改变用户的实际亮度，
  // 但能把写权限问题在自检里暴露出来（无权限时返回带原因的失败）。
  const writeProbe: { id: string; result: BrightnessWriteResult }[] = []
  for (const display of displays) {
    if (!display.available) continue
    writeProbe.push({ id: display.id, result: await setDisplayBrightness(display.id, display.current) })
  }

  // 在线片源连通性探针：失败不影响自检结论，只把原因带进报告。
  let remote: { ok: boolean; sections?: number; sample?: string; error?: string }
  try {
    const home = await kanjuHome()
    remote = {
      ok: true,
      sections: home.sections.length,
      sample: home.sections[0]?.cards[0]?.title,
    }
  } catch (error) {
    remote = { ok: false, error: (error as Error).message }
  }

  const report = {
    platform: process.platform,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    userData: app.getPath('userData'),
    displays,
    writeProbe,
    remote,
  }
  writeSelfCheck(`SELF_CHECK ${JSON.stringify(report, null, 2)}\n`)
}

const selfCheck = process.argv.includes('--self-check')

void app.whenReady().then(async () => {
  registerMediaProtocol()
  registerIpc()

  if (selfCheck) {
    try {
      await runSelfCheck()
    } catch (error) {
      process.stderr.write(`SELF_CHECK_FAILED ${(error as Error).message}\n`)
      app.exit(1)
      return
    }
    return
  }

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

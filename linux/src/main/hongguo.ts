// ==================== 在线片源客户端（红果短剧 / openhongguo）====================
// 主进程独占：渲染进程不接触匿名设备档案、解密密钥与原始报文，只拿到归一化后的领域对象。
//
// 底层用非官方 SDK `openhongguo`（Go 编译的 WebAssembly）。它是 ESM-only 包，且运行时
// 需要按自身模块路径读取 `dist/openhongguo.wasm`，因此必须保持 external（不打进 bundle），
// 用原生动态 import 在运行时从 node_modules 加载。
//
// 这里用 `new Function('s', 'return import(s)')` 构造 import()，原因：主进程产物是 CJS，
// Rollup 会把静态 `import()` 改写成 `require()`，而 `require()` 无法加载 ESM 包。运行期
// 构造的动态 import 不经过打包器，因此在 CJS 里也能正确加载该 ESM 包。
//
// 播放链路：discover / search → listEpisodes（每集分集 id）→ resolvePlayback（各清晰度直链
// + 内容密钥）。红果的分集是 CENC（cenc-aes-ctr）加密的 HEVC/bytevc1，Chromium 无法直接
// 播放，所以这里用系统 ffmpeg 以 `-decryption_key` 解密并转码成 H.264/AAC 单文件，落地到本地
// 缓存目录后交给播放器；同一集同一清晰度只解密一次。

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
import type {
  Client as OhgClient,
  Episode as OhgEpisode,
  Series as OhgSeries,
  SeriesSummary as OhgSeriesSummary,
  Stream as OhgStream,
} from 'openhongguo'

/** 原生动态 import（绕过打包器改写），见文件头说明。 */
const nativeImport = new Function('s', 'return import(s)') as (
  specifier: string,
) => Promise<unknown>

// ==================== 运行配置 ====================

interface HongguoConfig {
  /** 解密产物的落地目录（建议放在 userData 下，可跨重启复用）。 */
  cacheDir: string
  /** ffmpeg 可执行文件；默认走 PATH。 */
  ffmpegPath: string
}

let config: HongguoConfig = {
  cacheDir: join(tmpdir(), 'private-cinema-hongguo'),
  ffmpegPath: process.env.FFMPEG_PATH ?? 'ffmpeg',
}

/** 主进程启动时注入实际缓存目录 / ffmpeg 路径。 */
export function configureHongguo(next: Partial<HongguoConfig>): void {
  config = { ...config, ...next }
}

let clientPromise: Promise<OhgClient> | null = null

/** 惰性创建单例客户端：WASM 全进程只加载一次，匿名设备档案由 SDK 自行持久化。 */
function getClient(): Promise<OhgClient> {
  if (clientPromise === null) {
    clientPromise = (async () => {
      const mod = (await nativeImport('openhongguo')) as typeof import('openhongguo')
      return mod.createClient({
        retryAttempts: 2,
        deviceResets: 3,
        timeoutMs: 20_000,
        log: (line: string) => {
          if (process.env.HONGUO_DEBUG === '1') console.log('[hongguo]', line)
        },
      })
    })()
  }
  return clientPromise
}

// ==================== 归一化 ====================

/** 红果 ContentType：5=电影，6=电视剧，1004=漫剧，其余（真人短剧/场景剧等）按剧集处理。 */
function mapKind(contentType?: number): MediaKind {
  switch (contentType) {
    case 5:
      return 'movie'
    case 1004:
      return 'anime'
    default:
      return 'series'
  }
}

/** 封面 URL。`cover_expires_at` 为零值表示服务端没给有效封面。 */
function coverOf(summary: { cover_url?: string; cover_expires_at?: string }): string {
  const url = (summary.cover_url ?? '').trim()
  if (url === '') return ''
  if (summary.cover_expires_at === '0001-01-01T00:00:00Z') return url
  return url
}

function mapSummary(summary: OhgSeriesSummary): RemoteCard {
  const count = summary.episode_count ?? 0
  return {
    id: summary.id,
    title: summary.title,
    kind: 'series',
    year: 0,
    area: '',
    genres: summary.category !== undefined && summary.category !== '' ? [summary.category] : [],
    remarks: count > 0 ? `共 ${count} 集` : '',
    posterUrl: coverOf(summary),
  }
}

/** 把 `created_at`（RFC3339 字符串或 unix 秒字符串）换成发布年份；解析不出返回 0。 */
function yearOf(createdAt?: string): number {
  if (createdAt === undefined || createdAt === '') return 0
  const rfc = /^(\d{4})-/.exec(createdAt)
  if (rfc !== null) return Number.parseInt(rfc[1], 10)
  if (/^\d{9,}$/.test(createdAt)) return new Date(Number(createdAt) * 1000).getFullYear()
  return 0
}

/** 从详情次要信息行里抽取标签：InfoCategory=3、InfoTags=9。 */
function genresFromRows(series: OhgSeries): string[] {
  const set = new Set<string>()
  if (series.category !== undefined && series.category !== '') set.add(series.category)
  for (const row of series.rows ?? []) {
    if (row.kind === 3 || row.kind === 9) {
      for (const part of row.text.split(/[·/、,\s]+/)) {
        if (part !== '') set.add(part)
      }
    }
  }
  return [...set].slice(0, 8)
}

/** 从详情次要信息行里抽取演员：InfoTwoActors=33，文本形如「演员·张三 李四」。 */
function actorsFromRows(series: OhgSeries): string[] {
  const names: string[] = []
  for (const row of series.rows ?? []) {
    if (row.kind !== 33) continue
    for (const part of row.text.replace(/^演员[·:：\s]*/, '').split(/[·/、,\s]+/)) {
      if (part !== '') names.push(part)
    }
  }
  return [...new Set(names)].slice(0, 12)
}

// ==================== 对外接口 ====================

/** 首页聚合：推荐频道 + 各热搜榜（取得到的才加入）。 */
export async function hongguoHome(): Promise<RemoteHomeData> {
  const client = await getClient()
  const sections: RemoteSection[] = []

  try {
    const page = await client.discover()
    const cards = (page.items ?? []).map(mapSummary)
    if (cards.length > 0) sections.push({ id: 'hg-recommend', title: '推荐', subtitle: '', cards })
  } catch {
    // 推荐频道失败不阻塞其它分区
  }

  try {
    const hot = await client.hotSearch()
    for (const board of hot.boards ?? []) {
      const cards: RemoteCard[] = (board.items ?? []).map((item) => ({
        id: item.series_id,
        title: item.title,
        kind: 'series',
        year: 0,
        area: '',
        genres: [],
        remarks:
          item.episode_count !== undefined && item.episode_count > 0
            ? `共 ${item.episode_count} 集`
            : (item.tag ?? ''),
        posterUrl: coverOf(item),
      }))
      if (cards.length > 0) {
        sections.push({ id: `hg-board-${board.name}`, title: board.name, subtitle: '', cards })
      }
    }
  } catch {
    // 热搜榜失败不影响首页
  }

  if (sections.length === 0) throw new Error('红果首页暂无内容，请稍后重试')
  return { sections }
}

// 红果列表是游标分页（不是页码）。UI 只会按 1、2、3… 顺序翻页，
// 这里缓存上一页游标，只有请求的页码正好接在上一页之后才续取，否则从头/返回空。
interface CursorState {
  page: number
  cursor?: string
}
let browseState: CursorState | null = null
let searchState: (CursorState & { keyword: string }) | null = null

function cursorFor(state: CursorState | null, page: number): string | undefined | null {
  // 返回 undefined=从第一页取；null=拿不到续取游标（请求页 >1 且状态不连续）
  if (page === 1) return undefined
  if (state === null || state.page !== page - 1 || state.cursor === undefined) return null
  return state.cursor
}

/** 分类浏览（红果无电影/综艺等频道，沿用推荐流，游标分页）。 */
export async function hongguoBrowse(
  _kind: MediaKind | null,
  page: number,
): Promise<RemoteBrowsePage> {
  const client = await getClient()
  const safePage = Math.max(1, Math.trunc(Number(page) || 1))
  const cursor = cursorFor(browseState, safePage)
  if (cursor === null) return { cards: [], page: safePage, hasMore: false }

  const result = await client.discover(cursor !== undefined ? { cursor } : {})
  const cards = (result.items ?? []).map(mapSummary)
  browseState = { page: safePage, cursor: result.cursor }
  return {
    cards,
    page: safePage,
    hasMore: result.has_more === true && (result.cursor ?? '') !== '',
  }
}

/** 搜索（游标分页）。 */
export async function hongguoSearch(keyword: string, page: number): Promise<RemoteBrowsePage> {
  const client = await getClient()
  const safePage = Math.max(1, Math.trunc(Number(page) || 1))
  const q = keyword.trim()
  if (q === '') return { cards: [], page: 1, hasMore: false }

  const key = q
  const sameSearch = searchState !== null && searchState.keyword === key ? searchState : null
  const cursor = cursorFor(sameSearch, safePage)
  if (cursor === null) return { cards: [], page: safePage, hasMore: false }

  const result = await client.search(q, cursor !== undefined ? { cursor } : {})
  const cards = (result.items ?? []).map(mapSummary)
  searchState = { page: safePage, cursor: result.cursor, keyword: key }
  return {
    cards,
    page: safePage,
    hasMore: result.has_more === true && (result.cursor ?? '') !== '',
  }
}

/** 作品详情。 */
export async function hongguoDetail(mediaId: string): Promise<RemoteDetail> {
  const client = await getClient()
  const series = await client.getSeries(mediaId)
  const count = series.episode_count ?? 0
  return {
    id: series.id,
    title: series.title,
    kind: mapKind(series.content_type),
    year: yearOf(series.created_at),
    area: '',
    genres: genresFromRows(series),
    overview: series.description ?? '',
    posterUrl: coverOf(series),
    remarks: series.right_text !== undefined && series.right_text !== '' ? series.right_text : count > 0 ? `共 ${count} 集` : '',
    actors: actorsFromRows(series),
    directors: [],
    episodeCount: count,
  }
}

/** 分集列表。红果一部剧可能有数百集，服务端通常一页返回全部，这里最多续取若干页。 */
export async function hongguoEpisodes(mediaId: string): Promise<RemoteEpisode[]> {
  const client = await getClient()
  const collected: OhgEpisode[] = []
  let cursor: string | undefined
  for (let i = 0; i < 10; i += 1) {
    const page = await client.listEpisodes(mediaId, cursor !== undefined ? { cursor } : {})
    collected.push(...(page.items ?? []))
    if (page.has_more !== true || (page.cursor ?? '') === '') break
    cursor = page.cursor
  }
  return collected
    .filter((episode) => episode.playable !== false)
    .map((episode) => ({
      id: episode.id,
      // resolvePlayback 接受分集 id，作为 token 透传给播放页
      token: episode.id,
      number: episode.number,
      title: episode.title !== undefined && episode.title !== '' ? episode.title : `第 ${episode.number} 集`,
    }))
}

// ==================== 播放解析 ====================

function labelOf(stream: OhgStream, index: number): string {
  const definition = stream.definition !== undefined && stream.definition !== '' ? stream.definition : undefined
  const quality = stream.quality !== undefined && stream.quality !== '' ? stream.quality : undefined
  return definition ?? quality ?? `线路 ${index + 1}`
}

/** 默认清晰度优先级：优先给转码成本较低的 480p，再退到 360p / 更高。 */
const PREFERRED_DEFINITIONS = ['480p', '360p', '540p', '720p', '1080p']

function pickStreamIndex(streams: OhgStream[], lineId?: string): number {
  if (lineId !== undefined && lineId !== '') {
    const byId = /^hg-(\d+)$/.exec(lineId)
    if (byId !== null) {
      const index = Number.parseInt(byId[1], 10)
      if (index >= 0 && index < streams.length) return index
    }
    const byLabel = streams.findIndex((stream) => stream.definition === lineId)
    if (byLabel >= 0) return byLabel
  }
  for (const definition of PREFERRED_DEFINITIONS) {
    const index = streams.findIndex(
      (stream) => stream.definition === definition && stream.hls !== true && stream.dash !== true,
    )
    if (index >= 0) return index
  }
  const progressive = streams.findIndex((stream) => stream.hls !== true && stream.dash !== true)
  return progressive >= 0 ? progressive : 0
}

/** 把 SDK 的原始错误码翻译成给用户看的中文，保留可诊断信息。 */
function friendlyResolveError(error: unknown): string {
  const code = (error as { code?: string }).code
  switch (code) {
    case 'ANONYMOUS_LIMITED':
      return '红果匿名播放额度暂时用尽（上游限制），请稍后重试'
    case 'AUTHENTICATION_REQUIRED':
      return '该集需要登录，匿名接口无法播放'
    case 'RATE_LIMITED':
      return '请求过于频繁，已被红果限流，请稍后重试'
    case 'CONTENT_UNAVAILABLE':
      return '该集已下架或不可用'
    case 'DRM_PROTECTED':
      return '该集为加密内容，暂不支持直接播放'
    default:
      return error instanceof Error ? error.message : '播放地址解析失败'
  }
}

/** 调一次 ffmpeg；失败把 stderr 末尾带出来，便于定位。 */
function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(config.ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error('ffmpeg 解密超时（5 分钟）'))
    }, 5 * 60_000)
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
      if (stderr.length > 8000) stderr = stderr.slice(-8000)
    })
    child.on('error', (error: NodeJS.ErrnoException) => {
      clearTimeout(timer)
      if (error.code === 'ENOENT') reject(new Error('未找到 ffmpeg：请先安装 ffmpeg 并加入 PATH'))
      else reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg 解密失败（退出码 ${code}）：${stderr.split('\n').slice(-3).join(' ').trim()}`))
    })
  })
}

/** 解密 + 转码一集到本地缓存；已存在则直接复用。key 为 16 字节 AES 十六进制。 */
const decryptInFlight = new Map<string, Promise<string>>()

async function ensureDecrypted(episodeId: string, stream: OhgStream, key: string): Promise<string> {
  // 缓存键只用「分集 + 清晰度」：播放直链每次带新的签名，不能进哈希，否则永远不命中。
  const hash = createHash('sha1')
    .update(`${episodeId}|${stream.definition ?? ''}`)
    .digest('hex')
    .slice(0, 20)
  const output = join(config.cacheDir, `${hash}.mp4`)
  const cached = await stat(output).catch(() => null)
  if (cached !== null && cached.size > 0) return output

  // 同一集同清晰度可能被并发请求（React StrictMode / 连点）：复用同一个解密任务，
  // 避免两个 ffmpeg 抢写同一文件（这正是之前“Unable to re-open ... No such file”的来源）。
  const running = decryptInFlight.get(output)
  if (running !== undefined) return running

  const task = (async (): Promise<string> => {
    await mkdir(config.cacheDir, { recursive: true })
    // 临时文件带 pid + 时间戳，杜绝并发写同一路径。
    const temp = `${output}.${process.pid}.${Date.now()}.part.mp4`
    try {
      // 红果是 cenc-aes-ctr + bytevc1(HEVC)：-decryption_key 解密，再转成 Chromium 能解的 H.264/AAC。
      // 不加 -movflags +faststart：本地文件走 Range 读取，moov 位置无所谓，而 faststart 需要二次
      // 读写同一个文件，遇到并发/短时文件句柄问题就会像上面那样炸掉。
      await runFfmpeg([
        '-hide_banner', '-loglevel', 'error', '-y',
        '-decryption_key', key,
        '-i', stream.url ?? '',
        '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '26',
        '-maxrate', '1400k', '-bufsize', '2800k',
        '-c:a', 'aac', '-b:a', '96k',
        temp,
      ])
      await rename(temp, output)
      return output
    } catch (error) {
      await rm(temp, { force: true })
      throw error
    }
  })()

  decryptInFlight.set(output, task)
  try {
    return await task
  } finally {
    decryptInFlight.delete(output)
  }
}

export interface HongguoResolveContext {
  /** 把本地解密后的文件路径换成渲染进程可播放的 URL；未提供则拒绝走本地解密。 */
  serveLocal?: (localPath: string) => string
}

/**
 * 解析一集的播放地址。
 * - 未加密：直接返回 http 直链；
 * - 加密（红果常态）：用 ffmpeg 解密 + 转码成 H.264 落到本地缓存，再经 `serveLocal` 换成 cinema:// URL。
 * 指定 lineId（hg-<index> 或清晰度标签）时用对应清晰度；否则默认 480p/360p。
 */
export async function hongguoResolve(
  episodeId: string,
  lineId?: string,
  ctx: HongguoResolveContext = {},
): Promise<RemotePlayback> {
  const client = await getClient()
  let resolved: Awaited<ReturnType<OhgClient['resolvePlayback']>>
  try {
    resolved = await client.resolvePlayback(episodeId)
  } catch (error) {
    throw new Error(friendlyResolveError(error))
  }
  const { playback, contentKey } = resolved

  const streams = (playback.streams ?? []).filter((stream) => (stream.url ?? '') !== '')
  if (streams.length === 0) throw new Error('该集暂无可用播放地址')

  const lines: RemoteLine[] = streams.map((stream, index) => ({
    id: `hg-${index}`,
    label: labelOf(stream, index),
    providerId: 'hongguo',
    urlKind: stream.hls === true ? 'hls' : 'mp4',
  }))

  const chosenIndex = pickStreamIndex(streams, lineId)
  const chosen = streams[chosenIndex]
  const base = {
    lineId: `hg-${chosenIndex}`,
    lineLabel: labelOf(chosen, chosenIndex),
    lines,
  }

  // 非加密：直接交给播放器
  if (chosen.protected !== true) {
    return { ...base, url: chosen.url ?? '', urlKind: chosen.hls === true ? 'hls' : 'mp4' }
  }

  // 加密：解密 + 转码成本地文件
  const key = contentKey?.key
  if (key === undefined || key === '') {
    throw new Error('该集为加密内容，但未能取得解密密钥，暂时无法播放')
  }
  if (chosen.hls === true || chosen.dash === true) {
    throw new Error('该清晰度不是可直接解密的单文件，请切换其它线路')
  }
  if (ctx.serveLocal === undefined) {
    throw new Error('该集为加密内容，需要本地解密后才能播放')
  }
  const localPath = await ensureDecrypted(episodeId, chosen, key)
  return { ...base, url: ctx.serveLocal(localPath), urlKind: 'mp4' }
}

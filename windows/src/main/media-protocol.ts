// ==================== 本地媒体协议（Range 支持） ====================
// `net.fetch(file://...)` 不处理 Range 请求，Chromium 的 file loader 会忽略该头，
// 结果是 `<video>.seekable` 恒为 [0,0] —— 拖动进度条与续播全部失效。
// 因此这里手写分段读取：解析 Range → 206 + Content-Range + 文件片段流。

import { createReadStream } from 'node:fs'
import { realpath, stat } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { ALLOWED_MEDIA_EXTENSIONS, fromMediaUrl } from '@shared/media-url'

/** 扩展名 → MIME。Chromium 会嗅探，但显式声明更稳。 */
const CONTENT_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  // `.mov` 绝大多数是 ISO-BMFF，与 MP4 同族。Chromium 的容器白名单里没有
  // `video/quicktime`（canPlayType 恒返回空串），按 MP4 声明才能进解码器。
  '.mov': 'video/mp4',
  '.mkv': 'video/x-matroska',
  '.webm': 'video/webm',
  '.srt': 'text/plain; charset=utf-8',
  '.vtt': 'text/vtt; charset=utf-8',
}

/** Range 头解析结果。三种状态互斥，调用方据此决定响应码。 */
export type ParsedRange =
  | { kind: 'full' }
  | { kind: 'partial'; start: number; end: number }
  | { kind: 'unsatisfiable' }

/**
 * 解析 `Range: bytes=...`。
 * 语法非法或多段 Range 一律按整文件处理（RFC 9110 允许服务器忽略 Range）；
 * 只有「语法合法但超出文件范围」才返回 unsatisfiable，对应 416。
 */
export function parseRangeHeader(header: string | null, size: number): ParsedRange {
  if (header === null || size <= 0) return { kind: 'full' }

  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (match === null) return { kind: 'full' }

  const [, rawStart, rawEnd] = match
  if (rawStart === '' && rawEnd === '') return { kind: 'full' }

  // bytes=-N：取末尾 N 字节
  if (rawStart === '') {
    const suffix = Number.parseInt(rawEnd, 10)
    if (!Number.isFinite(suffix) || suffix <= 0) return { kind: 'unsatisfiable' }
    return { kind: 'partial', start: Math.max(0, size - suffix), end: size - 1 }
  }

  const start = Number.parseInt(rawStart, 10)
  if (!Number.isFinite(start) || start >= size) return { kind: 'unsatisfiable' }

  // bytes=N-：从 N 到文件末尾
  const end = rawEnd === '' ? size - 1 : Math.min(Number.parseInt(rawEnd, 10), size - 1)
  if (!Number.isFinite(end) || end < start) return { kind: 'unsatisfiable' }

  return { kind: 'partial', start, end }
}

/** 文件 → 可流式 body；绝不把整个文件读进内存。 */
function streamOf(filePath: string, start?: number, end?: number): ReadableStream {
  const options = start === undefined ? {} : { start, end }
  return Readable.toWeb(createReadStream(filePath, options)) as unknown as ReadableStream
}

/** 小写扩展名；无扩展名返回空串。 */
function extensionOf(filePath: string): string {
  const dot = filePath.lastIndexOf('.')
  return dot < 0 ? '' : filePath.slice(dot).toLowerCase()
}

/** 处理一次 `cinema://` 请求。`isAllowed` 来自 `MediaAccessRegistry`。 */
export async function handleMediaRequest(
  request: Request,
  isAllowed: (filePath: string) => boolean,
): Promise<Response> {
  const requestedPath = fromMediaUrl(request.url)
  if (requestedPath === null) return new Response('非法请求', { status: 400 })

  // 只放行用户在本进程内主动选择过的文件。
  // 扩展名白名单挡不住「渲染进程自行构造任意路径」——路径就在 URL 里。
  if (!isAllowed(requestedPath)) return new Response('未授权的文件', { status: 403 })

  // 先做廉价的白名单判断，避免为任意路径都打一次磁盘
  if (!ALLOWED_MEDIA_EXTENSIONS.has(extensionOf(requestedPath))) {
    return new Response('不允许的文件类型', { status: 403 })
  }

  // 解析符号链接后再验一次扩展名：`影片.mp4` 指向别的文件时，真实名字会露馅。
  // 后续读取一律用解析后的路径，保证「校验的文件」与「读取的文件」是同一个。
  const filePath = await realpath(requestedPath).catch(() => null)
  if (filePath === null) return new Response('文件不存在', { status: 404 })

  const ext = extensionOf(filePath)
  if (!ALLOWED_MEDIA_EXTENSIONS.has(ext)) {
    return new Response('不允许的文件类型', { status: 403 })
  }

  const info = await stat(filePath).catch(() => null)
  if (info === null || !info.isFile()) return new Response('文件不存在', { status: 404 })

  const contentType = CONTENT_TYPES[ext] ?? 'application/octet-stream'
  const parsed = parseRangeHeader(request.headers.get('range'), info.size)

  if (parsed.kind === 'unsatisfiable') {
    return new Response(null, {
      status: 416,
      headers: {
        'Content-Range': `bytes */${info.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': '0',
      },
    })
  }

  if (parsed.kind === 'partial') {
    const { start, end } = parsed
    return new Response(streamOf(filePath, start, end), {
      status: 206,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(end - start + 1),
        'Content-Range': `bytes ${start}-${end}/${info.size}`,
        'Accept-Ranges': 'bytes',
      },
    })
  }

  return new Response(streamOf(filePath), {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(info.size),
      'Accept-Ranges': 'bytes',
    },
  })
}

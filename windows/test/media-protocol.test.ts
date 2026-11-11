import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { handleMediaRequest, parseRangeHeader } from '../src/main/media-protocol'
import { MediaAccessRegistry } from '../src/main/media-access'
import { toMediaUrl } from '../src/shared/media-url'

// ==================== Range 解析 ====================
// 这是拖动进度条与续播的命门：解析错 = seek 静默失效（seekable 恒为 [0,0]）。

const SIZE = 1000

describe('parseRangeHeader 常规区间', () => {
  it('无 Range 头按整文件处理', () => {
    expect(parseRangeHeader(null, SIZE)).toEqual({ kind: 'full' })
  })

  it('bytes=0-99 取前 100 字节', () => {
    expect(parseRangeHeader('bytes=0-99', SIZE)).toEqual({ kind: 'partial', start: 0, end: 99 })
  })

  it('bytes=500- 取到文件末尾', () => {
    expect(parseRangeHeader('bytes=500-', SIZE)).toEqual({
      kind: 'partial',
      start: 500,
      end: 999,
    })
  })

  it('bytes=-100 取末尾 100 字节', () => {
    expect(parseRangeHeader('bytes=-100', SIZE)).toEqual({
      kind: 'partial',
      start: 900,
      end: 999,
    })
  })

  it('结束位置超出文件长度时收敛到末字节', () => {
    expect(parseRangeHeader('bytes=900-99999', SIZE)).toEqual({
      kind: 'partial',
      start: 900,
      end: 999,
    })
  })

  it('末尾后缀超过文件长度时从头开始', () => {
    expect(parseRangeHeader('bytes=-5000', SIZE)).toEqual({
      kind: 'partial',
      start: 0,
      end: 999,
    })
  })
})

describe('parseRangeHeader 非法输入', () => {
  it('起点超出文件长度返回 unsatisfiable', () => {
    expect(parseRangeHeader('bytes=1000-', SIZE)).toEqual({ kind: 'unsatisfiable' })
  })

  it('起点大于终点返回 unsatisfiable', () => {
    expect(parseRangeHeader('bytes=500-100', SIZE)).toEqual({ kind: 'unsatisfiable' })
  })

  it('多段 Range 按整文件处理（RFC 允许忽略）', () => {
    expect(parseRangeHeader('bytes=0-99,200-299', SIZE)).toEqual({ kind: 'full' })
  })

  it('非 bytes 单位按整文件处理', () => {
    expect(parseRangeHeader('items=0-99', SIZE)).toEqual({ kind: 'full' })
  })

  it('语法残缺按整文件处理', () => {
    expect(parseRangeHeader('bytes=', SIZE)).toEqual({ kind: 'full' })
  })

  it('空文件一律整文件（无可分段）', () => {
    expect(parseRangeHeader('bytes=0-99', 0)).toEqual({ kind: 'full' })
  })
})

// ==================== 响应头与授权 ====================
// 用真实临时文件走一遍 handler：断言的是「响应头与响应体一致」，
// 而不是解析函数的返回值。mock 不能替代这一段。

describe('handleMediaRequest', () => {
  let dir = ''
  let videoPath = ''
  let textPath = ''
  let registry: MediaAccessRegistry

  const BODY = Buffer.alloc(SIZE, 0x41) // 1000 字节 'A'

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pc-protocol-'))
    videoPath = join(dir, 'sample.mp4')
    textPath = join(dir, 'notes.txt')
    await writeFile(videoPath, BODY)
    await writeFile(textPath, 'hello')
    registry = new MediaAccessRegistry()
    registry.authorize([videoPath, textPath])
  })

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  const allow = (path: string): boolean => registry.isAllowed(path)
  const request = (path: string, range?: string): Request =>
    new Request(toMediaUrl(path), range === undefined ? {} : { headers: { range } })

  it('无 Range 返回 200 + 完整长度', async () => {
    const response = await handleMediaRequest(request(videoPath), allow)
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Length')).toBe(String(SIZE))
    expect(response.headers.get('Accept-Ranges')).toBe('bytes')
    expect(response.headers.get('Content-Type')).toBe('video/mp4')
    expect((await response.arrayBuffer()).byteLength).toBe(SIZE)
  })

  it('分段请求返回 206，头与体长度一致', async () => {
    const response = await handleMediaRequest(request(videoPath, 'bytes=100-199'), allow)
    expect(response.status).toBe(206)
    expect(response.headers.get('Content-Range')).toBe(`bytes 100-199/${SIZE}`)
    expect(response.headers.get('Content-Length')).toBe('100')
    expect((await response.arrayBuffer()).byteLength).toBe(100)
  })

  it('后缀范围的头与体一致', async () => {
    const response = await handleMediaRequest(request(videoPath, 'bytes=-100'), allow)
    expect(response.status).toBe(206)
    expect(response.headers.get('Content-Range')).toBe(`bytes 900-999/${SIZE}`)
    expect((await response.arrayBuffer()).byteLength).toBe(100)
  })

  it('越界范围返回 416，且 Content-Length 为 0', async () => {
    const response = await handleMediaRequest(request(videoPath, 'bytes=5000-'), allow)
    expect(response.status).toBe(416)
    expect(response.headers.get('Content-Range')).toBe(`bytes */${SIZE}`)
    expect(response.headers.get('Content-Length')).toBe('0')
    expect((await response.arrayBuffer()).byteLength).toBe(0)
  })

  it('多段 Range 退回 200，体长度与 Content-Length 一致', async () => {
    const response = await handleMediaRequest(request(videoPath, 'bytes=0-99,200-299'), allow)
    expect(response.status).toBe(200)
    expect(Number(response.headers.get('Content-Length'))).toBe(
      (await response.arrayBuffer()).byteLength,
    )
  })

  it('未授权路径一律 403，即使扩展名合法且文件存在', async () => {
    const response = await handleMediaRequest(request(videoPath), () => false)
    expect(response.status).toBe(403)
  })

  it('授权表精确匹配，不做目录级放宽', () => {
    expect(allow(videoPath)).toBe(true)
    expect(allow(join(dir, 'other.mp4'))).toBe(false)
    expect(allow(join(dir, 'sub', 'sample.mp4'))).toBe(false)
  })

  it('扩展名不在白名单返回 403', async () => {
    const response = await handleMediaRequest(request(textPath), allow)
    expect(response.status).toBe(403)
  })

  it('授权但文件不存在返回 404', async () => {
    const missing = join(dir, 'missing.mp4')
    const permissive = new MediaAccessRegistry()
    permissive.authorize([missing])
    const response = await handleMediaRequest(request(missing), (path) =>
      permissive.isAllowed(path),
    )
    expect(response.status).toBe(404)
  })

  it('非 cinema:// 协议返回 400', async () => {
    const response = await handleMediaRequest(new Request('https://example.com/a.mp4'), allow)
    expect(response.status).toBe(400)
  })

  it('.mov 按 video/mp4 声明（Chromium 不认 video/quicktime）', async () => {
    // Chromium 的容器表里没有 video/quicktime，按原名声明会 canPlayType 返回空串、
    // 直接进不了解码器。.mov 与 MP4 同属 ISO-BMFF，按 MP4 声明才可播。
    const movPath = join(dir, 'clip.mov')
    await writeFile(movPath, BODY)
    const permissive = new MediaAccessRegistry()
    permissive.authorize([movPath])
    const response = await handleMediaRequest(request(movPath), (path) =>
      permissive.isAllowed(path),
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('video/mp4')
  })

  it('URL 解码失败返回 400', async () => {
    const response = await handleMediaRequest(
      new Request('cinema://local/%E0%A4%A'),
      allow,
    )
    expect(response.status).toBe(400)
  })
})

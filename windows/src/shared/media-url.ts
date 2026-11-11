// ==================== 本地媒体 URL ====================
// `<video src>` 不能直接用 Windows 绝对路径：`file://` 在渲染进程被禁用，
// 而自定义协议需要一份「路径 → URL」的确定性编码。
// 编码规则：UTF-8 → base64 → URL 安全，规避盘符 `C:`、反斜杠与中文的转义差异。
// 主进程与渲染进程共用本文件（Node 20 与 Chromium 都提供 btoa/atob 与 TextEncoder）。

export const MEDIA_SCHEME = 'cinema'

/** 允许经自定义协议读取的扩展名：只放行媒体与字幕。 */
export const ALLOWED_MEDIA_EXTENSIONS = new Set([
  '.mp4',
  '.m4v',
  '.mov',
  '.mkv',
  '.webm',
  '.srt',
  '.vtt',
])

/** 绝对路径 → `cinema://local/<base64>`。 */
export function toMediaUrl(filePath: string): string {
  return `${MEDIA_SCHEME}://local/${encodePath(filePath)}`
}

/** `cinema://` 请求 → 绝对路径；非法输入返回 null。 */
export function fromMediaUrl(requestUrl: string): string | null {
  let url: URL
  try {
    url = new URL(requestUrl)
  } catch {
    return null
  }
  if (url.protocol !== `${MEDIA_SCHEME}:`) return null
  if (url.hostname !== 'local') return null

  const encoded = url.pathname.replace(/^\//, '')
  if (encoded === '') return null
  return decodePath(encoded)
}

function encodePath(filePath: string): string {
  const bytes = new TextEncoder().encode(filePath)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  // base64 里的 `+` `/` `=` 需要转义，否则会在 URL 路径里被改写
  return encodeURIComponent(btoa(binary))
}

function decodePath(encoded: string): string | null {
  try {
    const binary = atob(decodeURIComponent(encoded))
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
    return new TextDecoder().decode(bytes)
  } catch {
    return null
  }
}

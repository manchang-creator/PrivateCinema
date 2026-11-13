// ==================== 本地媒体 URL（loopback HTTP） ====================
// 旧 Electron 用 cinema://local/<base64>；mygo 的 WebKitGTK 无法从自定义协议播放媒体，
// 改用 Go 起的 127.0.0.1 HTTP 服务。基址由 `Cinema.mediaBase()` 提供，启动时注入。
// 编码必须与 Go 端 decodeMediaPath 对应：base64 RawURLEncoding（无填充，+ / 换成 - _）。

let mediaBase = "";

export function setMediaBase(base: string): void {
  mediaBase = base.endsWith("/") ? base : base + "/";
}

export function getMediaBase(): string {
  return mediaBase;
}

/** 绝对路径 → 可交给 <video src> 的本地 HTTP URL。基址未就绪时返回空串。 */
export function localMediaUrl(filePath: string): string {
  if (mediaBase === "" || filePath === "") return "";
  const bytes = new TextEncoder().encode(filePath);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const encoded = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return mediaBase + encoded;
}

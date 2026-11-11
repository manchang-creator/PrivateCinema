// ==================== 媒体访问授权表 ====================
// `cinema://` 是渲染进程唯一的文件读取通道。仅靠扩展名白名单不够：
// base64 编码的路径是渲染进程可以自由构造的，等于把「整机任意 mp4 的读取权」
// 交给了它。一旦渲染进程被注入脚本，攻击面就是全盘媒体文件。
//
// 因此主进程维护一份「用户在本进程内明确选择过的路径」白名单，
// 协议处理器只放行表内文件。授权来源仅有两处：选文件 / 选文件夹。
// 应用重启后片库状态本就重新扫描，白名单不跨进程持久化是正确的。

export class MediaAccessRegistry {
  private readonly allowed = new Set<string>()

  /** 登记用户主动选择的文件（扫描结果）。重复登记无副作用。 */
  authorize(filePaths: readonly string[]): void {
    for (const filePath of filePaths) this.allowed.add(filePath)
  }

  /** 是否为已授权路径。精确匹配，不做前缀或目录级放宽。 */
  isAllowed(filePath: string): boolean {
    return this.allowed.has(filePath)
  }
}

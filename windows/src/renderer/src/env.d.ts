// ==================== 全局类型补充 ====================
// `window.cinema` 由预加载脚本注入，渲染进程只认这个类型。

import type { CinemaApi } from '@shared/ipc'

declare global {
  interface Window {
    cinema: CinemaApi
  }
}

export {}

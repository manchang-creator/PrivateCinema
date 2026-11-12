import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

// ==================== 测试配置 ====================
// 只测本壳目录内与平台相关的部分：播放进度 JSON 落盘、文件名归组、
// cinema:// 协议响应头与授权、亮度纯逻辑。
// 弹幕引擎 / 字幕解析 / 设置收敛属于 `packages/core`，在那边单测，这里不重复。

export default defineConfig({
  resolve: {
    alias: { '@': resolve('src/renderer/src') },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
})

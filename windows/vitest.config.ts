import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

// ==================== 测试配置 ====================
// 测纯逻辑与无界面可验证的部分：字幕解析与时间轴、弹幕车道 / 时间基准 / 播完释放、
// 进度判定与 JSON 落盘往返、文件名归组、弹幕生成、cinema:// 响应头与授权。
// 不测 React 渲染与真实解码 —— 那需要真实窗口与真实视频，属于手工验收范围。

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve('src/shared'),
      '@': resolve('src/renderer/src'),
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
})

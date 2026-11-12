import { defineConfig } from 'vitest/config'

// ==================== 测试配置 ====================
// 只测纯逻辑：弹幕车道 / 时间基准 / 播完释放、设置收敛、字幕解析与时间轴、演示弹幕生成。
// 平台相关实现（扫描、进度存储、cinema:// 协议）留在各壳目录各自测试。

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
})

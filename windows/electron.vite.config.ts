import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

// ==================== 构建配置 ====================
// 三个入口各自独立打包：主进程 / 预加载 / 渲染进程。
// 主进程与预加载走 Node 环境，依赖外部化（不打进 bundle）；
// 渲染进程是普通 Web 应用，走 React 插件。
//
// 跨进程契约、弹幕引擎、字幕解析来自 `packages/core`（`@private-cinema/core`），
// 它是源码包（exports 直接指向 .ts）：必须解析到同一份源码并参与打包，
// 因此不能出现在 `externalizeDepsPlugin` 的排除名单之外 —— 已列入 `exclude`。

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ['@private-cinema/core'] })],
    build: { rollupOptions: { input: { index: resolve('src/main/index.ts') } } },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: ['@private-cinema/core'] })],
    build: { rollupOptions: { input: { index: resolve('src/preload/index.ts') } } },
  },
  renderer: {
    root: resolve('src/renderer'),
    resolve: { alias: { '@': resolve('src/renderer/src') } },
    plugins: [react()],
    build: { rollupOptions: { input: { index: resolve('src/renderer/index.html') } } },
  },
})

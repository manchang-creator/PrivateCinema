import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

// ==================== 构建配置 ====================
// 三个入口各自独立打包：主进程 / 预加载 / 渲染进程。
// 主进程与预加载走 Node 环境，依赖外部化（不打进 bundle）；
// 渲染进程是普通 Web 应用，走 React 插件。
// `@shared` 指向跨进程共享的类型与 IPC 契约，三端必须解析到同一份源码。

const shared = resolve('src/shared')

export default defineConfig({
  main: {
    resolve: { alias: { '@shared': shared } },
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: { index: resolve('src/main/index.ts') } } },
  },
  preload: {
    resolve: { alias: { '@shared': shared } },
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: { index: resolve('src/preload/index.ts') } } },
  },
  renderer: {
    root: resolve('src/renderer'),
    resolve: { alias: { '@': resolve('src/renderer/src'), '@shared': shared } },
    plugins: [react()],
    build: { rollupOptions: { input: { index: resolve('src/renderer/index.html') } } },
  },
})

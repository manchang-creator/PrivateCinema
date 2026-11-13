import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// mygo dev 会让窗口加载 http://localhost:5173；构建产物输出到 dist/ 供 mygo build 内嵌。
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    // 允许读取仓库内 ../packages/core（file: 依赖，源码是 .ts，需参与打包）。
    fs: { allow: [".."] },
    watch: { ignored: ["**/.mygo/**", "**/build/**"] },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});

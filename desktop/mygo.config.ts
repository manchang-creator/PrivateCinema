import { defineConfig } from "mygo-cli";

// mygo 工程配置。dev 用 Vite 5173；build 用 Vite 产物 dist/ 内嵌进二进制。
export default defineConfig({
  name: "私人影院",
  slug: "private-cinema",
  identifier: "com.private.cinema",
  version: "0.1.0",
  devUrl: "http://localhost:5173",
  devCommand: "bun run dev:web",
  buildCommand: "bun run build:web",
  frontendDist: "dist",
  bindings: "src/mygo.ts",
  out: "build",
});

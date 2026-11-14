import { defineConfig } from "mygo-cli";

// mygo 工程配置。dev 用 Vite 5173；build 用 Vite 产物 dist/ 内嵌进二进制。
export default defineConfig({
  name: "私人影院",
  slug: "private-cinema",
  identifier: "com.private.cinema",
  version: "0.1.10",
  devUrl: "http://localhost:5173",
  devCommand: "bun run dev:web",
  buildCommand: "bun run build:web",
  frontendDist: "dist",
  bindings: "src/mygo.ts",
  out: "build",
  // 应用图标（正方形 1024）：打包进桌面入口、任务栏/窗口图标与 deb/rpm。
  icon: "resources/icon.png",
  // resources/ 下的文件会复制到可执行文件旁（macOS 是 Contents/Resources），
  // 其中 windows-amd64/、linux-amd64/ 这两个按平台命名的目录只随对应平台发布。
  // 红果加密分集靠 ffmpeg 解密，所以 Windows 包自带 resources/windows-amd64/ffmpeg.exe
  // （构建前由 desktop/scripts/fetch-ffmpeg.sh 下载并校验；不入库，见 .gitignore）。
  // Go 侧查找顺序见 desktop/ffmpeg.go：FFMPEG_PATH → 应用同目录 → 平台常见安装位 → PATH。
  // 签名更新：mygo.Updater 用这个公钥校验更新包。私钥（mygo-update.key）不入库，
  // 放在发布机的 ~/.config/mygo/update-keys/ 或 CI 的 MYGO_UPDATER_PRIVATE_KEY。
  // `mygo build` 会按 github 的 release 约定产出并（加 -upload 时）上传签名更新。
  updates: {
    publicKey: "pIYIKW4Qne/6KXmSBr1SniVVF4KjFGd5HXj94Ij/3cw=",
    github: "manchang-creator/PrivateCinema",
    tagPrefix: "v",
    deltas: 3,
  },
});

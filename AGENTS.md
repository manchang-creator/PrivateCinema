# AGENTS.md — AI 协作者须知

本文件面向所有 AI 编码助手（Codex / Claude Code / DSH 等）。动手前先读，收尾前必须执行「完成门禁」。

## 项目一句话

`PrivateCinema` 私人影院：桌面端已从 Electron 重构为 **mygo（Go 后端 + React 前端的 WebView 壳）**，主代码在 `desktop/`；旧 `linux/`、`windows/` 仅作对照。

## 完成门禁（每次改完必须跑）

**任何对 `desktop/` 的改动，报告完成前必须运行下面这条命令，并让它输出 `[PASS]`：**

```bash
bash desktop/scripts/mygo-smoke.sh
```

- 退出码非 0 或没有 `[PASS]`，视为**未完成**：先修复，再重新跑，直到 PASS。
- 不要用「`go build` 通过」代替它——冒烟会真的把应用启动、读取页面、切 tab、截图。
- 脚本会覆盖生成 [docs/mygo-smoke.png](docs/mygo-smoke.png)（本次真实运行截图），可随 PR 附上。

脚本做的事：构建前端（`bun run build:web`）→ 编译 e2e 版 Go 后端 → 启动真实窗口 → 用 `mygo-automation` 断言 `document.title`、页面文案「本地片库/在线片库」→ 切到「在线片库」断言「看剧AI/红果短剧」→ 截图 → 清理。

常用开关：

```bash
SMOKE_SKIP_WEB=1 bash desktop/scripts/mygo-smoke.sh   # 跳过前端构建，直接用现有 dist/
SMOKE_KEEP=1     bash desktop/scripts/mygo-smoke.sh   # 保留并打印应用日志
SMOKE_OUT=/tmp/x.png SMOKE_TIMEOUT=40 bash desktop/scripts/mygo-smoke.sh
```

## 本地文件 GUI 端到端测试（选片 → 播放 → 字幕/弹幕 → 续播）

改到本地播放/进度/字幕相关逻辑，或需要一次真机端到端验收时，跑：

```bash
bash desktop/scripts/local-e2e.sh        # 输出 [PASS]
```

脚本会：ffmpeg 生成 65s mp4 + 同名 srt → 启动 e2e 应用 → 用仅 e2e 构建编入的
`Cinema.SeedPaths` 通道播种片库（**绕过无法自动化的原生 GTK 文件对话框**，其余全走真实代码）→ 断言
`video.duration≈65`、字幕层文案、弹幕 canvas 与开关、退出落盘后「继续观看」、点击后续播起点≈原位置 → 截图到
[docs/local-e2e/](docs/local-e2e/)。

常用开关：`E2E_SKIP_WEB=1`、`E2E_KEEP=1`、`E2E_OUT_DIR=<dir>`、`E2E_TIMEOUT=<sec>`。

## 环境要求

- 有图形会话：`DISPLAY` 必须存在（脚本在无 `DISPLAY` 时直接失败）。
- Go：`GOTOOLCHAIN=auto`（mygo v0.9.0 要求 Go ≥ 1.27.3）；`go build` 需 `-buildvcs=false`（本仓库 `.git` 配置损坏）。
- `bun`、`mygo-automation`（v0.9.0，已在 PATH）。
- 依赖：`libwebkit2gtk-4.1`、GTK3、ffmpeg（本机已装）。

## mygo 关键事实（别踩坑）

- `desktop/` 是 **Web 前端模式**：窗口 `kind=page`。用 `mygo-automation` 时：
  - 可用：`windows`、`eval`、`screenshot`、`wait`；
  - **不可用**：`snapshot` / `press` / `fill` / `click`（这些只对 native UI 窗口有效，网页窗口返回 `unsupported`）——网页一律走 `eval`。
- 自动化开关文件是 [desktop/automation_e2e.go](desktop/automation_e2e.go)（`//go:build e2e` + blank import 插件），只在 `go build -tags e2e` 编入；`mygo build` 发布包不含它。
- 同理 [desktop/automation_seed.go](desktop/automation_seed.go) 是仅 e2e 编入的 `Cinema.SeedPaths(paths)` 测试通道（绕过原生文件对话框播种片库），前端用 `globalThis.mygo.call("Cinema.SeedPaths", paths)` 直接调，不写进生成的 `src/mygo.ts`、不进发布包。
- 媒体播放走 `127.0.0.1` loopback HTTP（`media_server.go` + `http.ServeContent`），不是自定义协议。
- 相关技能：`mygo-automation`（DSH 已安装）。需要完整用法时执行 `mygo-automation skills`。

## 通用约定

- 未明确要求时，**不要** `git commit` / `git push`。
- 改 UI/生命周期遵循 mygo 的 `ui` 规范；纯前端（`desktop/src`）改动仍要过冒烟。
- 文档同步：架构与阶段进展写进 [docs/2026-11-13-mygo-refactor.md](docs/2026-11-13-mygo-refactor.md)。

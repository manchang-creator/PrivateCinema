# 桌面端 mygo 重构（阶段一）

日期：2026-11-13
目标：把桌面端（Windows / Linux）从 Electron 重构为 [egoist/mygo](https://github.com/egoist/mygo)（Go 桌面框架）。

---

## 1. 决策：怎么用 mygo

mygo 有两种窗口形态：**原生 Go UI** 或 **Web 前端（系统 WebView）**。本次选 **Web 前端模式**，理由：

- 现有 `linux/`、`windows/` 的 UI 是成熟的 React + TS（片库、播放、弹幕、字幕、在线片库），换原生
  UI 等于把界面全部重写，收益低、风险高；
- mygo 的 Web 前端模式 = **保留现有 React 前端**，只把「Electron 主进程」换成「Go 后端」，
  通过 mygo 的**类型化 IPC**（`mygo.Bind`）替代 `ipcMain` / `preload`；
- 一套 Go 代码同时构建 Windows / Linux（mygo 纯 Go、无 cgo），**两套 Electron 壳合并成一套**。

架构对照：

| 旧（Electron） | 新（mygo） |
|---|---|
| `linux/` + `windows/` 两套主进程 | `desktop/` 一套 Go 后端 |
| `ipcMain.handle` + `preload` contextBridge | `mygo.Bind(&Cinema{})` → 生成 `src/mygo.ts` 类型化客户端 |
| `cinema://` 自定义协议 + Range | `media_server.go`：loopback HTTP + `http.ServeContent`（Range 流式） |
| 渲染进程 React | `desktop/src/`（原样复用），只加 `bridge.ts` 把客户端包成 `window.cinema` |
| `packages/core` TS（主进程与渲染共用） | 纯逻辑仍留在前端用（弹幕/字幕/格式化）；后端逻辑用 Go 重写 |

> 为什么媒体不能继续用自定义协议：mygo 官方文档明确——**WebKitGTK 的媒体播放器无法从自定义协议播放**
> （Linux 上 `<video src="cinema://…">` 一律 `MEDIA_ERR_SRC_NOT_SUPPORTED`），Windows WebView2 对自定义
> 协议 Range 还有 4MB 上限。所以统一改为 **127.0.0.1 loopback HTTP**，`http.ServeContent` 原生处理
> Range / 206 / Accept-Ranges。

## 2. 目录结构（新增 `desktop/`）

```
desktop/
├── main.go              # 应用入口：Bind 服务、起媒体服务、开窗口
├── cinema.go            # 绑定给前端的服务（对应旧 IPC 契约 CinemaApi）
├── types.go             # Go 领域模型（json tag 与 TS 字段一一对应）
├── library.go           # 本地扫描（移植 library.ts）
├── progress.go          # 进度 JSON 存储（移植 progress.ts，原子写）
├── subtitle.go          # 同名/语言后缀字幕发现（移植 subtitle-file.ts）
├── media_server.go      # loopback HTTP 媒体服务（替代 cinema://，含访问授权表）
├── brightness_linux.go  # sysfs / ddcutil / xrandr 亮度（移植 brightness.ts）
├── brightness_other.go  # 非 Linux 占位（Windows 亮度阶段二）
├── remote.go            # 在线片源适配器（阶段二，当前返回明确错误）
├── go.mod               # module privatecinema/desktop；require mygo v0.9.0
├── mygo.config.ts       # 应用名/identifier/devUrl/frontendDist/bindings
├── package.json         # 前端依赖 + mygo scripts
├── vite.config.ts       # Vite（端口 5173，允许读 ../packages/core）
├── index.html
└── src/                 # 原 linux/src/renderer 的 React 代码
    ├── main.tsx         # 改为先 installCinemaBridge() 再 render
    ├── bridge.ts        # ★ window.cinema 适配层（新）
    ├── media.ts         # ★ 本地媒体 URL（loopback HTTP，新）
    ├── mygo.ts          # mygo 生成客户端（手写占位，generate 会覆盖）
    ├── App.tsx / ui / player / danmaku / theme.ts / styles.css（原样复用）
```

**关键的“不改组件代码”技巧**：`bridge.ts` 用生成客户端实现与旧 `CinemaApi` 完全相同的对象并挂到
`window.cinema`，所以 `LibraryScreen` / `PlayerScreen` / `DisplayMenu` / `OnlineLibrary` 里所有
`window.cinema.xxx()` 调用一行都不用改；唯一改动是本地媒体 URL 从 `toMediaUrl`（cinema://）
换成 `localMediaUrl`（HTTP），只动了 `PlayerScreen.tsx` 的两行。

## 3. 已完成的验证（本机真实执行）

| 项 | 命令 | 结果 |
|---|---|---|
| Go 后端编译 | `go build -buildvcs=false ./...` | ✅ |
| Go 静态检查 | `go vet ./...` | ✅ |
| Go 单测（扫描/字幕/媒体 Range/路径编解码） | `go test ./...` | ✅ |
| 前端依赖安装 | `bun install` | ✅ 110 包 |
| 前端类型检查 | `bun run typecheck`（tsc） | ✅ 0 error |
| 前端生产构建 | `bun run build:web`（vite build） | ✅ 51 modules，dist 880K |
| 完整 mygo 打包 | `mygo build -platform linux/amd64` | 见下 |

> 环境说明：mygo v0.9.0 要求 Go ≥ 1.27.3，本机 `go1.26.7` 由 `GOTOOLCHAIN=auto` 自动拉取
> `go1.27.3/1.27.4` 工具链完成构建；mygo 纯 Go 无 cgo，Linux 上开窗口运行需要
> `libwebkit2gtk-4.1`（本机当前未装，见“未完成”）。

## 4. 未完成 / 阶段二

1. **在线片源**
   - `kanju`（看剧AI）：纯 HTTP + HMAC，可 1:1 移植到 Go，工作量中等，**优先做**；
   - `hongguo`（红果短剧）：依赖 `openhongguo`（Go 编译的 **WASM**、以 Node ESM 包分发）与系统
     ffmpeg 做 CENC 解密转码。Go 侧需用 wazero 加载其 wasm 或复用其导出函数，属独立议题。
   当前两者 `remote*` 方法返回「尚未移植」错误，界面只在切到「在线片库」时报错，**本地播放不受影响**。
2. **Windows 亮度**：原 Electron 走 WMI/koffi FFI。纯 Go 需 WMI COM 绑定或 PowerShell 兜底，
   当前 `brightness_other.go` 如实返回「不可用+原因」（不显示假滑块）。
3. **真实端到端播放验证**：需要装 `libwebkit2gtk-4.1` 后 `bun run dev`，放一个 mp4 + srt 走完整链路
   （选文件→播放→字幕→弹幕→退出重进续播）。本次未做（无 GUI/WebKit 依赖）。
4. **MKV 播放**：与原 Electron 同源限制，Chromium/WebKit 不支持的容器/编码仍会失败，需 WebCodecs
   自解码或外部播放器，独立议题。
5. **打包与签名**：`mygo build` 可产出 deb/rpm/tar.gz，但正式分发还需签名/公证；旧 Electron 的
   `scripts/linux-smoke.sh`、udev 规则（背光权限）需迁移到 mygo 的 resources/安装脚本。
6. **旧目录清理 ✅（已完成）**：`linux/`、`windows/`（Electron 壳）及仅被其 `postinstall` 使用的
   `scripts/patch-openhongguo.mjs`、`vendor/openhongguo/` 已删除；`.github/workflows/{linux,windows}-build.yml`
   （Electron CI）已移除，仅保留 `ios-build.yml`。README 桌面章节已改为 mygo。iOS（`apps/`、`Modules/`、
   `Tests/`、`Project.swift`、`Tuist.swift`）与 `packages/core`、`desktop/` 保留。

## 5. 如何运行

```bash
cd desktop
bun install                      # 前端依赖
# 开发（需要 libwebkit2gtk-4.1）：
bun run dev                      # = go run .../mygo dev，起 Vite + 窗口
# 仅校验：
bun run typecheck
bun run build:web
go build -buildvcs=false ./...
go test ./...
# 打包：
bun run build                    # = mygo build
```

> 注意：本仓库 `.git` 的配置损坏（`git` 报 `GIT_CONFIG_KEY_0`），`go build` 默认的 VCS stamping 会失败，
> 因此统一加 `-buildvcs=false`；修复 git 配置后可去掉。

---

## 6. 阶段二进展（同日续）

阶段二原清单里的前三项已完成：

| 项 | 状态 | 交付 | 说明 |
|---|---|---|---|
| kanju（看剧AI） | ✅ 完成 | `desktop/kanju.go` + `kanju_test.go` | 1:1 移植：HMAC-SHA256 签名（查询顺序与 TS 一致）、归一化、线路解析 fallback；纯逻辑单测 5 组 |
| hongguo（红果短剧） | ✅ 完成 | `desktop/hongguo.go` + `hongguo_test.go` | **改为直接调用官方 Go SDK** `github.com/beilunyang/openhongguo v0.2.0`（不再走 Node wasm）；ffmpeg `-decryption_key` 解密转码 + sha1 缓存 + 并发去重；纯逻辑单测 |
| Windows 亮度 | ✅ 完成（交叉编译验证） | `desktop/brightness_windows.go` | 纯 Go `syscall` 调 DXVA2（EnumDisplayMonitors/GetMonitorBrightness/SetMonitorBrightness 等），无 cgo；`brightness_other.go` 改为 `!linux && !windows` |
| 在线片源接线 | ✅ | `desktop/remote.go` 重写为 provider 分发 | `hongguo` → `hongguo*`，其余 → `kanju*`；`RemoteResolve` 注入 `serveLocal`（解密产物自动登记媒体授权并换成 loopback URL） |
| 启动配置 | ✅ | `desktop/main.go` | userData 下 `hongguo-cache/`、`openhongguo/anonymous.json`、`FFMPEG_PATH` |

新增验证（本机真实执行）：

```
gofmt -w *.go                      → 无差异
go mod tidy                        → OK
go build -buildvcs=false ./...     → OK
go vet  -buildvcs=false ./...      → OK
go test -buildvcs=false ./...      → ok privatecinema/desktop
GOOS=windows GOARCH=amd64 go build → OK（亮度与主程序交叉编译通过）
mygo build -platform linux/amd64   → OK（单二进制 + deb/rpm/tar.gz）
```

仍待：
1. **真实外网实连验证**：kanju1.com / 红果接口需要真实网络与地区，本机未做端到端联网播放验证。
2. **真实端到端播放**（装 `libwebkit2gtk-4.1` 后 `bun run dev`，放 mp4+srt 走完整链路）。
3. **MKV 容器**（WebCodecs/外部播放器，独立议题）。

---

## 7. 联网 / 真机验收（本机真实执行）

新增 `desktop/live_smoke_test.go`（默认跳过，`LIVE=1` 才跑，不进 CI），实测两套在线片源与桌面运行：

| 项 | 结果 |
|---|---|
| `LIVE=1 go test -run TestLiveKanju` | ✅ 首页 6 分区；首卡「谷雨」；搜索 10 条；选集 18 集；`kanjuResolve` 返回 mp4、33 条线路（真实直链） |
| `LIVE=1 go test -run TestLiveHongguo` | ✅ 首页 2 分区；首卡「直男上恋综气哭前女友第一季」；选集 120 集；`resolve` 返回「红果匿名播放额度用尽」（上游风控，非代码问题） |
| WebKitGTK / GTK3 / ffmpeg | ✅ 本机均已安装（webkit2gtk-4.1 2.52.6、ffmpeg 6.1.1） |
| 桌面真实运行 | ✅ 打包二进制 `build/linux-amd64/private-cinema` 在真实 X11(:0) 上开窗、WebView 正常渲染，在线片库能显示真实数据 |

运行效果（本地片库空态）：

![mygo 桌面端运行](mygo-desktop.png)

结论：阶段二的 kanju / hongguo / Windows 亮度均已落地；本地链路 + 在线 kanju 全链路已联网验证；
hongguo 的解析受上游匿名额度限制（换真实设备/时段可解），其余无代码阻塞。

---

## 8. 红果匿名额度：设备轮换 + 重试（增强）

红果对「每台匿名设备」大约只给一次播放模型；`ResolvePlayback` 用尽后返回空，SDK 抛 `ErrAnonymousLimited`。

新增 `desktop/retry.go`：

- 对红果的 home/browse/search/detail/episodes/resolve 统一套 `withQuotaRetry`；
- 命中「匿名额度 / 限流 / 设备被拒」类错误时，先指数退避（默认 800ms 起，翻倍封顶 8s），
  再 `client.ResetDevice()` 强制换一台匿名设备，重跑整次调用；
- 次数与退避可配：`HONGGUO_MAX_ROTATIONS`（默认 2）、`HONGGUO_ROTATE_DELAY_MS`（默认 800）、
  `HONGGUO_DEVICE_RESETS`（SDK 内部换设备次数，默认 3）、`HONGGUO_RETRY_ATTEMPTS`（默认 2）；
- `hongguoResolve` 的错误改为 `friendlyError`（保留中文消息 + `Unwrap` 原错误链），
  否则外层拿不到 `sdk.ErrAnonymousLimited` 这个哨兵、无法触发轮换。

实测（本机）：轮换确实触发（调用耗时从 ~3.4s 拉长到 ~10s，含换设备与退避），
但解析仍返回「匿名额度用尽」——说明该限制是**按 IP/地区**而非仅按设备，换设备在本机无法绕过。
结论：轮换/重试逻辑已就位并可配置，能否成功取决于上游是否按设备计数；不会造成假成功。

## 8.1 额度缓解补充：只读缓存 + 请求降频（不换出口 IP）

实测该额度按「IP / 地区」计，换匿名设备无效。这里**不切换出口 IP（就用本机当前 IP）**，而是从
「少发、慢发」两条线降低触发限流、快速耗尽额度的概率：

| 手段 | 文件 | 说明 |
|---|---|---|
| 只读 TTL 缓存 | `desktop/hongguo_cache.go` | 首页 / 详情 / 分集按 key 缓存，TTL 内复用，避免来回切页反复打上游。`HONGGUO_CACHE_TTL_MS`（默认 60000，0 关闭）。**不缓存** `ResolvePlayback`（直链短时签名，且解析本身才消耗额度）。 |
| 请求降频 | `desktop/hongguo_throttle.go` | 进程内全局最小间隔，每次真正发上游请求前 `throttleHongguo(ctx)` 预约时间片，压住选集翻页 / 连续解析的突发。`HONGGUO_MIN_INTERVAL_MS`（默认 400，0 关闭）。 |

- 与 `retry.go` 的「设备轮换 + 指数退避」互补：降频尽量不触发限流，重试管已触发的情况。
- 单测：`TestHgCacheTTL` / `TestHgCacheZeroTTLDisabled` / `TestIntervalLimiter*`（含节奏与 ctx 取消），`go test -race` 通过。

## 9. MKV：外部播放器兜底

WebView（WebKitGTK/WebView2）受容器/编码白名单限制，MKV 常 `MEDIA_ERR_SRC_NOT_SUPPORTED`。
新增 `desktop/external_player.go` 绑定 `Cinema.PlayExternal(filePath)`：

- 仅放行用户本进程选择过（已授权）的文件，与本地媒体协议同一安全边界；
- 播放器选择顺序：`PRIVATE_CINEMA_PLAYER` 环境变量（可带参数）> `mpv` > `vlc` > `celluloid` > `totem` > `xdg-open`；
- `exec.Start()` 后后台 `Wait()` 回收，不阻塞 UI。

前端 `PlayerScreen`：本地播放时新增「外部播放」按钮；`<video>` 报错文案提示「可点『外部播放』用系统播放器打开」。
`@private-cinema/core` 的 `CinemaApi` 增加可选 `playExternal`，bridge 已接线；生成的 `src/mygo.ts` 含 `Cinema.playExternal`。

> WebCodecs 方案需要自带 MKV 解封装 + 视频/音频 WebCodecs 解码 + 字幕/弹幕时间轴对齐，
> 工作量远大于外部播放器兜底，暂不做；外部播放器已能覆盖 MKV 的实际使用需求。

## 10. 本地文件 GUI 端到端自动化（选片 → 播放 → 字幕/弹幕 → 续播）

交接文档里唯一的自动化缺口是「本地文件 GUI 端到端」：选文件要走原生 GTK 文件对话框，无法被
`mygo-automation` 驱动（`desktop/` 是 `kind=page` 窗口，`snapshot/press/fill/click` 只对 native UI 有效；
GTK 对话框也不在 mygo 的窗口树里）。为此加了一条**仅 e2e 构建编入**的测试通道，其余全部走真实生产代码：

| 组件 | 文件 | 说明 |
|---|---|---|
| 播种通道 | `desktop/automation_seed.go`（`//go:build e2e`） | `Cinema.SeedPaths(paths []string)`：与 `PickVideos` 去掉对话框后完全一致——`access.Authorize` + `buildLibrary`。只在 `go build -tags e2e` 编入，`mygo build` 发布包不含，也不写进生成的 `src/mygo.ts`。 |
| 端到端脚本 | `desktop/scripts/local-e2e.sh` | ffmpeg 生成 65s mp4 + 同名 srt → 启动 e2e 应用（隔离 `XDG_DATA_HOME`）→ 用 `eval` 把 `window.cinema.pickVideos` 改指向 `globalThis.mygo.call('Cinema.SeedPaths',[path])` → 点「选择视频文件」→ 后续全部真实驱动。 |

脚本断言链（真机 X11 实测，输出 `[PASS]`）：

1. **选片/扫描**：播种后片库网格出现 `E2E 演示片`；
2. **播放/解码**：点击单集进播放页，`<video>.duration ≈ 65s`（证明容器 + H.264 编码可解码）；
3. **字幕**：`currentTime=2s` 后 `.subtitle-layer` 出现同名 srt 的「E2E 字幕校验行」；
4. **弹幕**：`.danmaku-canvas` 挂载、`弹幕 开/关` 可切换（65s > 60s 才会有种子弹幕）；
5. **续播**：`currentTime=42s` → 点「返回」触发卸载清理落盘 → 片库「继续观看 00:42/01:05」→ 点卡片从 42s 恢复。

截图：`docs/local-e2e/{1-library,2-player-subtitle,3-library-continue,4-player-resumed}.png`。
实测结论：本地链路（扫描 → loopback HTTP Range 播放 → 字幕叠加 → canvas 弹幕 → 进度落盘/恢复）端到端打通。

> 这同时补上了交接文档「阶段二·真实端到端播放」缺口：此前只验证了开窗/在线出图/媒体 Range 单测，
> 现在本地 mp4+srt 的完整播放-字幕-弹幕-续播链路有了可重复的真机自动化验收。

## 11. 界面重做：参考 cezzu 的「影院液态玻璃」语言

参考项目：[bentx2685/cezzu](https://github.com/bentx2685/cezzu)（原生 iOS/macOS，SwiftUI + Liquid Glass）。
提炼出的可迁移规律，落到 `desktop/src` 的前端实现：

- **整页底色由主推封面主色驱动**（cezzu `CoverColorPalette.darkened`）：`ambientVars()` 按标题稳定散列出色相，铺三团同相环境光；有真实海报时由海报主导。
- **表面是白色透明叠色，不是不透明灰**（cezzu `ContentPalette.surface = white.opacity(0.06)`）：`--glass / --glass-strong / --hairline` 三档玻璃变量，配合 `backdrop-filter`。
- **主操作是单色胶囊**（cezzu `CezzuMonochrome`：深色白底黑字）：`--fill / --on-fill`，主按钮纯白胶囊，次级按钮玻璃胶囊。
- **一级入口是悬浮玻璃胶囊顶栏**（cezzu `RegularTopBar`）：品牌 + 居中分段胶囊（本地片库/在线片库）+ 右侧图标动作，顶栏后一层影院黑渐变 scrim。
- **中文标题 + 大写拉丁副标**（`CONTINUE WATCHING` / `LIBRARY` / `RESULTS`）建立层级。
- **Hero**：左 3:4 相框海报 + 右信息栏（类型/事实 chips、大标题、简介、白色「立即观看」、快速选集缩略条）。
- **详情弹层 / 播放页**：玻璃层、选集网格、顶部返回 + 右侧功能簇、底部标题 + 白色进度条 + 白色圆形播放主控，均对齐 cezzu 的 PlayerSurface / DetailView 布局。

新增/改动文件：`desktop/src/ui/icons.tsx`（内联线性图标）、`ui/palette.ts`（封面色板/环境光）、`ui/Rail.tsx`（横向货架）、`ui/LibraryScreen.tsx`、`ui/OnlineLibrary.tsx`、`ui/DisplayMenu.tsx`、`player/PlayerScreen.tsx`、`styles.css`（整套 tokens 重写，含浅色主题与播放页固定深色）。

验收：`bash desktop/scripts/mygo-smoke.sh` 输出 `[PASS]`；另用 e2e 播种 9 部作品真机截图：
`docs/ui-redesign/cezzu-style-{local,detail,continue,online,player,light}.png`。

### 11.1 布局优化（第二轮 P0–P3）

在 §11 视觉语言不变的前提下，按 P0–P3 做了一轮布局打磨，全部落在 `desktop/src`（CSS 为主 + 少量组件状态）：

- **P0 全幅 banner Hero**：`.hero` 用 `width:100vw; margin-left: calc(-50vw + 50%)` 跳出 `.screen-inner` 的 1320 栅格，铺满视口；高度 `clamp(430px, 68vh, 640px)`；内边距 `max(44px, 50vw-660px)` 让内容仍对齐主栅格。`.screen` 加 `overflow-x:hidden` 裁掉 1vw 溢出。
- **P1 单集信息平衡**：`.detail-hero` 改 `align-items: stretch`，`.detail-actions` 用 `margin-top:auto` 推到底 —— 简介为空时操作行与海报底对齐，右栏不再一头沉。
- **P1 在线工具栏合并**：`OnlineLibrary` 把「片源 / 搜索 / 分类」压进同一行 `.online-toolbar`（窄屏自动换行），去掉第二行。
- **P2 Hero 轮播 + 网格/货架分档**：`LibraryScreen` 与 `OnlineLibrary` 增加 `heroIndex` 状态 + 6.5–7s `setInterval` 轮播（`hero-inner` 以 `key` 触发 `hero-crossfade` 交叉淡入）；本地新增 `.hero-pager` 指示点，在线用快速缩略条点选。`media-grid` 卡片基础档 158→168px，`@media(min-width:1420px)` 再放大到 188px。在线分区货架也分档：首个热门区 `Rail.rail-lg` 用 208px 大卡 + 常显翻页按钮（`Rail alwaysNav`，到两端置灰），其余 146px 标准卡（窄屏 168/130）；「继续观看」同样分档 —— 最近一条 `cw-card-lg` 320px 大卡，其余 220px 标准卡；进度条平时压暗、悬浮/聚焦时点亮加厚，已看完的条目自动沉到末尾（未看完仍最近优先）。卡片悬浮时右上角出现 `×` 可**移除该条播放记录**（调 `Cinema.RemoveProgress` 后刷新列表）。在线大卡区 `Rail autoPlayMs=6000` **自动轮播**：按屏宽 0.9 翻页、到末尾回环，鼠标悬浮/聚焦时暂停；Hero 轮播与大卡区轮播在 `prefers-reduced-motion: reduce` 下自动停用。
- **P3 窄屏封面铺底**：`@media(max-width:620px)` 不再 `display:none` 海报，而是 `position:absolute; inset:0` 铺满整幅、`opacity:.5` 做背景，底部长渐变压暗，文字压在封面之上。
- 附带修复：`.display-popover` 始终深色但此前继承浅色主题的深色文字（深底深字），现局部钉住深色变量。

验收（本机真机 + 无头 CSS 夹具）：

- `bash desktop/scripts/mygo-smoke.sh` → `[PASS]`
- `bash desktop/scripts/local-e2e.sh` → `[PASS]`
- 截图：`docs/ui-redesign/v2-{local,detail,online,hongguo,light,rails,continue,continue-remove,after-remove}.png`（e2e 播种真机 1280×800）；`v2-narrow-560.png`（560px 无头 Chrome 渲染同一份 `dist` CSS，验证 P3 封面铺底）。
- 交互回归：`RemoveProgress` 端到端实测 —— 播放 → 返回生成继续观看 → 点 `×` 后 `ListProgress` 长度归零、继续观看分区消失；在线大卡区 7s 内 `scrollLeft` 由 0 自动前进到 ~1120。

## 12. 红果播放修复：openhongguo 升级到含 Argus/Ladon 签名的提交（2026-11-13）

**现象**：红果短剧的首页 / 搜索 / 详情 / 分集都正常，唯独 `ResolvePlayback` 返回空，界面报「红果匿名播放额度暂时用尽（上游限制），请稍后重试」，换设备重试也无效。

**根因**：2026-11-10 起红果开始对播放接口 `POST /novel/player/video_model/v1/` 真正校验 `x-argus` / `x-ladon`。我们锁定的 `openhongguo v0.2.0` 这两个头只是时间戳占位，于是播放接口返回 `HTTP 200 + 空 body`，SDK 把它归为 `ErrAnonymousLimited`（误报“额度用尽”）。上游 issue #2 / #6，PR #7（2026-11-11 合并）补上真正的 **Argus 551 信封 + 34 轮 Ladon 签名**，并去掉播放请求里的 `x-medusa`，其余接口签名不动。搜索/详情未加这道校验，所以一直正常——与现象吻合。

**处理**：`desktop/go.mod` 将 `github.com/beilunyang/openhongguo` 由 `v0.2.0` 升到含该修复的提交
`v0.2.1-0.20261111115741-4bc88830eba1`（= PR #7 合并提交 `4bc88830e`）。该修复尚未打新 tag，故用伪版本锁定。

**验证（真实联网）**：
- `remoteResolve` 返回本地解密 mp4（`urlKind=mp4`，5 条线路，解密约 5.8s）；
- UI 端到端播放《初尝玫瑰!》第 1 集，`video.duration ≈ 153s` 且出画面；
- 首页（推荐/热搜榜/预约榜）、搜索「总裁」6 条、详情 95 集、选集均正常。
- `mygo-smoke.sh` 与 `local-e2e.sh` 均 `[PASS]`。

**遗留**：红果匿名额度本身仍可能有「每设备/每 IP」上限（`retry.go` 的换设备/退避逻辑保留）；本修复解决的是“播放请求被签名校验判空”这一确定性问题。另：卡片封面图在当前环境多为占位（`posterUrl` 有映射但 CDN 图未加载），属独立小问题。

### 12.1 同类开源项目（调研）

- `beilunyang/openhongguo`（≈458★，Go，多语言绑定 + ohg CLI）：本项目所用 SDK，社区最活跃，PR #7 即此修复来源。
- `aston314/hongguo-tv-releases`（≈1124★）：红果短剧多平台播放器（Android TV/webOS/Mac/Win/Linux）。
- `kiroswu/hongguo-shortdramabox`（≈313★）/ `liangzai-kk/hongguo-short-drama-desktop`（≈243★）/ `StriveToLearnCode/hongguo-short-drama-macos`（≈63★）：第三方桌面端；macOS 版支持账号登录（登录态可绕开匿名额度）。
- `parallelpan/hongguo-downloader`（≈538★）、`M4St3r0/hongguo-downloader`、`wbkboy/hongguo-video-downloader-pro`：解析/下载类（服务端或多出口 IP 轮换 + CENC-AES-128-CTR 解密）。
结论：无需“逆向破解”第三方客户端；直接用维护中的官方非官方 SDK 升级即可，签名实现为其 clean-room 版本（Apache-2.0）。

### 12.2 封面图修复：HEIC → JPEG 本地海报代理（2026-11-13）

**现象**：红果卡片/详情封面长期显示为首字占位。排查后发现 `posterUrl` 是 `.heic`（`~tplv-...superreso-aifit...heic`），**WebView（WebKitGTK/Chromium）无法解码 HEIC**——与 referer 无关（加 `referrerPolicy` 无效；把扩展名改 jpg/webp 上游返回 403，因为签名绑定原路径）。

**处理**：`media_server.go` 增加 loopback 海报代理 `GET /<token>/poster?u=<urlencoded 上游图 URL>`：
- 仅放行白名单 CDN 域名（`*.fqnovelpic.com` / `*.byteimg.com` / `*.douyinpic.com` / `*.snssdk.com` / `*.bytedance.com`），防 SSRF；
- 按 URL 的 SHA-1 落地磁盘缓存；`Content-Type` 已是 jpeg/png/webp 直接返回，HEIC/HEIF 用 ImageMagick（优先 `magick`，非 Windows 回退 `convert`）转 JPEG；
- 前端 `OnlineLibrary` 增加 `proxiedPoster()`：仅对 `.heic/.heif` 走代理，其它格式直连。

**验证**：`hero_img_loaded=true`，网格封面 `20/20` 成功加载（此前 `0/19`）；首页 Hero 与详情封面均显示真实海报。单测新增 `TestPosterRejectsUnlistedHost` / `TestPosterServesCachedJPEG` / `TestAllowedPosterHost`，`go test ./...` 通过；`mygo-smoke` 与 `local-e2e` 均 `[PASS]`。

**已知遗留**：**搜索结果列表**的卡片封面仍为占位——上游 SDK 的搜索解析器（`ParseSearchTab` 的 `video_detail` 主分支）没有把 `cover` 拷进 `SeriesSummary`（`video_detail` 的 `cards` 分支才有）。首页/详情不受影响。→ 已在 12.6 通过本地 fork 修复。

### 12.3 详情弹层浅色主题对比度修复（2026-11-13）

**现象**：浅色主题下打开在线（红果）/本地详情弹层，简介与「选集」按钮几乎看不清——深色渐变底 + 深色文字。

**根因**：`palette.ts` 的 `backdropGradient()` 直接返回一段**深色** `background` 作为内联样式，内联优先级高于 `:root[data-theme='light'] .detail-modal { background:#f6f7fa }`，于是浅色主题下弹层仍是深底；而文字沿用 `--text-*` 主题变量，在浅色主题下是深色 → 深底深字。

**修复**：
- `backdropGradient()` 改为只下发 `--detail-hue` / `--detail-hue-2` 两个色相变量，不再写死背景。
- CSS：`.detail-modal` 用变量定义深色渐变默认值；`:root[data-theme='light'] .detail-modal` 定义同色相的浅色渐变（原 `#f6f7fa` 平底升级为同色相径向渐变）。
- 深浅主题共用同一套 `--text-*` 变量，天然自适应，无需再按主题硬编码文字色。

**验证**：浅色详情弹层实测 `detail-summary` 为 `rgba(20,22,28,0.68)`（深字）+ 浅底，选集网格可读；深色主题回归正常；`mygo-smoke` `[PASS]`。截图见 [docs/fix-2026-11-13/](fix-2026-11-13/)。

### 12.4 配色统一 + 应用图标（2026-11-13）

**现象**：浅色主题整页偏粉/紫，Hero 又随轮播在绿/蓝/粉间跳，配色不协调；窗口/任务栏没有应用图标。

**配色**：
- `palette.ts` 新增 `coolHue()`，把所有大面积底色（整页环境光 / 无海报封面 / 详情弹层）的色相收进冷色窄区间（≈214°–260°），轮播换片也只在很小的色温范围微动。
- `ambientVars()` 环境光降饱和、降透明（0.55→0.30 量级），不再整屏泛色。
- 浅色主题：`--bg` 改中性灰 `#f2f3f6`，`.ambient` 改低饱和冷光，`.hero` 改低饱和同色相浅渐变，`.detail-modal` 浅底改低饱和近白渐变。
- 深色主题：Hero 底色降饱和，`::before` 环境光透明度 0.9→0.62，整体更沉。
- 细节：新增统一 `:focus-visible` 焦点环；分区间距/标题字号微调（`section-title` 19px）。

**图标**：
- 新增 `resources/icon.png`（1024×1024，深墨色圆角方块 + 斜置胶片条 + 白色播放键，柔和投影；SVG 经 Inkscape 渲染，小尺寸仍清晰），在 `mygo.config.ts` 用 `icon` 接入打包（deb/rpm 与桌面入口都带图标）。
- `main.go` 用 `//go:embed resources/icon.png` 内嵌，并在建窗后 `win.SetIcon(appIcon)` 设窗口图标（GTK → WM_HINTS，标题栏/任务栏可见）。

**验证**：`mygo-smoke` `[PASS]`；窗口 `WM_HINTS` 已带 icon pixmap；浅/深主题与详情截图见 [docs/fix-2026-11-13/ui-*.png](fix-2026-11-13/)。

### 12.5 打通在线自动更新 v0.1.2（2026-11-13）

**结论**：Linux/Windows 双平台签名更新清单已挂上 Release `v0.1.2`，已安装的应用「检查更新 → 立即更新」全链路可用（下载 → 验签 → 安装 → 自动重启，本机 0.1.0 → 0.1.2 实测通过）。

**过程与坑**：
1. CI 发版没有签名密钥 → Release 缺 `update-*.json`，检查更新 404。
2. 修复分两层：
   - **当次发布**：用本机 `~/.config/mygo/update-keys/mygo-update.key` 签名构建，把归档 + manifest 传到 `v0.1.2`；
   - **以后发版**：把私钥配进仓库 Secret `MYGO_UPDATER_PRIVATE_KEY`（API sealed-box 加密写入），CI 出包自动带签名清单。
3. **坑 A：签名与字节不一致**。本地签名的归档与 CI 构建的归档差 1 字节（gzip 时间戳非确定性），应用报 `downloaded 5774308 bytes, want 5774307`。**签名包与 manifest 必须来自同一次构建**——把本地签名的归档替换掉 CI 的同名资产后解决。
4. **坑 B：Release 资产 CDN 缓存**。替换资产后 GitHub CDN 仍返回旧字节（新资产 id 的新 URL 不受影响）。manifest 的 `url` 改成带 `?v=0.1.2-r2` 的地址绕过（manifest 本身不签名，TLS 保证完整性；签名只针对归档字节）。
5. Windows 端同样补了 `update-windows-amd64.json` + 归档（本地交叉构建签名；CI 出 setup.exe/portable 的同时也会带清单）。

**以后发版流程**（secret 已配好）：
```bash
# desktop/mygo.config.ts 改 version → commit → tag → push
git tag v0.1.3 && git push origin v0.1.3
# CI 自动出包 + 签名 + 发布；已安装的应用自动检查并更新
```

**安全注记**：本次用过的浏览器 token（PrivateCinema-auto-update，30 天）曾在会话截图中露出，已建议账号所有者到 GitHub Settings → Tokens 删除；仓库 Secret 为加密存储，不经对话。

### 12.6 搜索结果封面：本地 fork openhongguo 补 cover 字段（2026-11-13）

**现象**：在线片库搜索结果网格全是首字占位，点开详情弹层却有真封面。实测 `hongguoSearch("丧尸")` 返回的 6 条 `posterUrl` 全为空串。

**根因**：上游搜索响应里其实带 `video_detail.series_cover`，但 SDK 的 `ParseSearchTab`（`internal/protocol/parse.go`）构造 `SeriesSummary` 时漏拷了 `CoverURL`（`video_detail_list` cards 分支有拷，`video_detail` 主分支漏了）；而详情接口 `Series.CoverURL` 正常 → 弹层有图、网格没图。上游最新 tag `v0.2.0` 比在用的 master 快照还旧，无现成修复。

**处理**：把在用的模块快照（`v0.2.1-0.20261112155120-1d3354a932bc`）复制到 [third_party/openhongguo/](../third_party/openhongguo/)，一行补 `CoverURL: v.VideoDetail.Cover`，`desktop/go.mod` 加：

```
replace github.com/beilunyang/openhongguo => ../third_party/openhongguo
```

**验证**：探针实测搜索「丧尸」6 条中 5 条带出真实 `.heic` 封面（经 12.2 的海报代理转 JPEG 后可显示；`宿舍求生，丧尸围城` 是上游本身没回封面数据，继续走首字兜底）。`go test ./...` 通过；`mygo-smoke` `[PASS]`。

**维护注意**：以后升级 openhongguo 版本时需重新同步 `third_party/openhongguo` 并重打这行补丁（或等上游合并修复后去掉 replace）。

## 13. 自动构建与发布（GitHub Actions）

新增 `.github/workflows/release-desktop.yml`：**打 `v*` tag（或 Actions 手动触发）即自动出包并发 Release**。

- Runner：`ubuntu-latest`；装 Go(stable，`GOTOOLCHAIN=auto` 拉 go1.27.3) + Bun + `nsis rpm fakeroot zip`。
- 构建：`go run github.com/egoist/mygo/cmd/mygo@v0.9.0 build -platform linux/amd64,windows/amd64`（产出 `.deb/.rpm/.tar.gz` + `private-cinema-setup-<ver>-amd64.exe`）。
- 打包：Windows 便携 `private-cinema-<ver>-windows-amd64-portable.zip` + `SHA256SUMS`。
- 发布：`softprops/action-gh-release@v2` 把 deb/rpm/tar.gz/setup.exe/portable.zip/SHA256SUMS 挂到对应 tag 的 Release；另 `upload-artifact` 备份。
- 版本号：从 tag 自动写入 `mygo.config.ts` 的 `version`（`v0.1.1` → `0.1.1`）。
- 用法：`git tag v0.1.1 && git push origin v0.1.1`。
- 前提：仓库 Actions 已启用；`permissions: contents: write`（工作流内已声明）。

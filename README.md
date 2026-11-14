# 私人影院 · PrivateCinema

Apple TV + Infuse 风格的极简私人影视中心（iOS / Windows / Linux）。

仅供个人使用：无广告、无 VIP、无运营位。所有内容通过统一 `MediaProvider` 协议接入，
内置演示媒体库（公开测试视频流 + 占位海报）保证开箱即可运行，不包含任何抓取或解析逻辑。

## 桌面客户端（Windows / Linux，mygo）

桌面端已用 [mygo](https://github.com/egoist/mygo)（Go 后端 + 复用现有 React 前端，产物为单个纯 Go 二进制）
重写，工程在 `desktop/`；旧的 Electron `windows/`、`linux/` 壳已删除。设计、阶段进展与真机验收记录见
[`docs/2026-11-13-mygo-refactor.md`](docs/2026-11-13-mygo-refactor.md)，协作者须知见 [`AGENTS.md`](AGENTS.md)。

前端仍复用跨平台内核 `packages/core`（`@private-cinema/core`：领域模型、IPC 契约、弹幕引擎、字幕解析）。

桌面端常用命令（在 `desktop/` 下）：

```bash
bun install            # 前端依赖
bun run dev            # 开发：起窗口（需图形会话）
bun run typecheck      # tsc 全量检查
bun run build:web      # 前端生产构建 → dist/
bun run build          # mygo build：产出 build/linux-amd64/ 单二进制 + deb/rpm/tar.gz
go test ./...          # Go 后端单测
```

完成门禁（改动 `desktop/` 后必跑，须输出 `[PASS]`）：`bash desktop/scripts/mygo-smoke.sh`；
本地文件端到端（选片→播放→字幕/弹幕→续播）：`bash desktop/scripts/local-e2e.sh`。
构建环境坑（`GOTOOLCHAIN=auto`、`-buildvcs=false`、webkit2gtk/GTK3/ffmpeg 依赖）见 `AGENTS.md`。

### 更新源（可选自建镜像）

在线更新默认读 GitHub Release 的 `update-*.json`；该地址会跳到 `release-assets.githubusercontent.com`，
国内网络常被掐成 `EOF`。配置镜像即可绕开，**签名校验仍在应用内完成**，镜像无需可信：

```bash
export PRIVATE_CINEMA_UPDATE_MIRROR=https://dl.example.com/private-cinema   # 客户端启用
cd desktop && go run ./cmd/update-mirror -in build/windows-amd64/update-windows-amd64.json \
  -out dist-mirror/windows-amd64/update-windows-amd64.json \
  -base https://dl.example.com/private-cinema -target windows-amd64 -hash      # 发布期生成镜像清单
```

镜像失败会自动回落 GitHub（`PRIVATE_CINEMA_MIRROR_STRICT=1` 可关闭），过程记录在
`<userData>/update.log`，设置页「关于 → 更新源」会显示当前状态。完整目录结构与发布步骤见
[`docs/update-mirror.md`](docs/update-mirror.md)。

### 内置 FFmpeg（红果加密分集必需）

在线片源「红果短剧」的分集是 CENC 加密的 HEVC，WebView 解不了，必须用 FFmpeg
`-decryption_key` 解密并转码成本地 H.264。**Windows 安装包/便携包已内置 `ffmpeg.exe`**，
装完即可播放；Linux 发布包也带一份，同时仍支持系统 `ffmpeg`。

```bash
bash desktop/scripts/fetch-ffmpeg.sh windows   # 构建前准备（下载 + SHA-256 校验 + 解出许可文本）
bash desktop/scripts/fetch-ffmpeg.sh all       # CI 打 Windows + Linux 包时用
```

- 二进制不入库（`.gitignore`），构建期现下现校验；版本与哈希写死在脚本顶部。
- 运行时查找顺序（`desktop/ffmpeg.go`）：`FFMPEG_PATH` → **应用同目录** → 平台常见安装位（WinGet /
  `ProgramFiles\ffmpeg\bin` / Homebrew / `/usr/local/bin`）→ `PATH`；找不到时设置页「环境诊断」
  与播放页「修复指引」会列出探测过的每个路径。
- **许可**：内置的是 Gyan 的 essentials 构建（GPLv3，含 libx264）。分发时必须随附 GPL 全文与
  NOTICE —— 安装目录里已有 `ffmpeg-LICENSE.txt`、`ffmpeg-NOTICE.txt`、`COPYING.GPLv3`、
  `ffmpeg/README.txt`（源码获取方式与构建来源）。改 ffmpeg 版本时同步更新这两份文本。

> 系统专属能力：Windows 走 DXVA2（纯 Go `syscall`）调亮度；Linux 走 sysfs 背光 + `ddcutil`（DDC/CI）外接屏亮度，
> 硬件背光不可写且运行在 X11 时回退 `xrandr` 软件调光。应用本身不提权，检测不到权限会返回带原因的提示。

## 环境要求

- **Xcode 16+**
- **iOS 17.0+**（SwiftUI `@Observable` / SwiftData）
- **Tuist 4**（工程由 `Project.swift` 生成，不再提交 `.xcodeproj`）
- iPhone / iPad 通用

## 运行

```bash
# 首次：安装 Tuist（https://docs.tuist.dev）
brew install tuist

tuist generate        # 生成 PrivateCinema.xcworkspace
open PrivateCinema.xcworkspace
```

1. 选择任意 iOS 17+ 模拟器（建议 iPhone 15 Pro）
2. `Cmd + R` 运行

> 工程文件由 `Project.swift` 与 `Modules/*/Package.swift` 生成，**不要提交 `.xcodeproj`**。
> 真机运行需在 Target → Signing & Capabilities 选择你的 Team（模拟器无需签名）。

## 仓库结构（monorepo）

```
PrivateCinema/
├── Project.swift              # Tuist 工程清单（App + 两个测试 target）
├── Tuist.swift                # Tuist 配置
├── apps/
│   └── PrivateCinema/         # 交付物：入口、RootView、Info.plist、资源
├── Modules/                   # 本地 Swift Package
│   ├── CinemaKit/             # 共享内核（单包）：模型 / 持久化 / 服务 / Provider / 播放器 / 弹幕 / 字幕 / UI 组件
│   ├── FeatureHome/           # 首页（HomeModule 定义在 CinemaKit）
│   ├── FeatureSearch/         # 发现 / 搜索
│   ├── FeatureLibrary/        # 片库
│   ├── FeatureDetail/         # 详情
│   ├── FeatureHistory/        # 历史
│   ├── FeatureFavorites/      # 收藏
│   ├── FeatureDownloads/      # 下载
│   ├── FeatureSources/        # 媒体源
│   ├── FeatureSettings/       # 设置
│   └── FeatureProfile/        # 「我的」聚合页
└── Tests/
    ├── PrivateCinemaTests/    # 单元测试（@testable import CinemaKit）
    └── PrivateCinemaUITests/  # 截图 UI 测试
```

**为什么 CinemaKit 是单包**：Player / Danmaku / Subtitles / Components 之间紧耦合（`PlayerViewModel` 同时持有
`PlayerManager`、`DanmakuManager`、`SubtitleManager`、`PlaybackSettings`）。拆成多包会把整条链路变成 `public`，
收益为零。**边界按「是否独立演进」划分，不按目录划分。**

**模块依赖（无环）**

```
CinemaKit  ← 所有 Feature / App
FeatureDetail ← FeatureHome, FeatureLibrary, FeatureSearch, FeatureFavorites, FeatureProfile
FeatureSearch ← FeatureHome
FeatureProfile ← App（聚合 History / Favorites / Downloads / Sources / Settings）
App → CinemaKit, FeatureHome, FeatureSearch, FeatureLibrary, FeatureProfile
```

新增页面 = 新建 `Modules/FeatureXxx` 包 + 在 `Project.swift` 的 `modules` 与 `appPackageProducts` 登记。

## 功能总览（P0/P1 已实现）

| 模块 | 说明 |
| --- | --- |
| 首页 | 欢迎语 + 继续观看（进度/百分比/当前集）+ 收藏 + 最近更新/添加 + 分类热门，模块可在设置中隐藏 |
| 发现 | 防抖搜索（标题/演员/类型）+ 类型快筛 + 筛选面板（类型/年代/地区/题材/规格/评分/完结） |
| 详情 | Backdrop 大图 + 渐变遮罩 + 播放/收藏(想看/收藏/看过)/下载 + 选集网格（✓ 已看 / ▶ 当前）+ 简介/演员/剧照/相关推荐/视频规格 |
| 播放器 | AVPlayer + 自绘 Apple TV 风格控制层：单击显隐、±10s、长按 2x、手势快进/亮度/音量、倍速 0.5~2.0、自动下一集倒计时、上一集/下一集、多线路切换（保持进度与播放/暂停状态；新线路加载失败自动回退原线路） |
| PiP | 系统 `AVPictureInPictureController`，退出播放页可继续小窗（后台模式已声明） |
| AirPlay | 系统 `AVRoutePickerView` |
| 弹幕 | `DanmakuProvider` 协议 + 本地存储 + 种子弹幕；CALayer + CADisplayLink 高性能渲染、车道防重叠、显示区域/透明度/字号/速度/分类屏蔽/关键词屏蔽、发送弹幕、高能进度条（Heatmap）、防剧透关键词过滤 |
| 字幕 | SRT/VTT 解析器 + 外挂字幕自绘渲染（字号/位置/颜色/背景/±5s 偏移）+ HLS 内嵌字幕轨道选择 |
| 进度 | 每 5 秒自动保存，≥90% 判定看完；继续观看直接 seek 上次位置 |
| 片库 | 分类 Segment + 网格/列表 + 排序（最近添加/观看/名称/年份/评分/更新）+ 观看状态筛选 |
| 历史 | 按日期分组、单条删除、清空、点击续播 |
| 下载 | HTTP 直链真实引擎（流式写盘 + Range 断点续传）+ 任务状态机 + 进度 + 暂停/继续/删除 + Wi-Fi/自动下一集/看完删除设置 |
| 媒体源 | 配置管理（名称/类型/地址/Keychain 密钥/启停/测试连接）；WebDAV/Jellyfin/Emby/Plex 为 P2 预留 |
| MiniPlayer | Apple Music 风格常驻条，点按回到全屏播放器 |
| 设置 | 播放/字幕/弹幕/外观（跟随系统/浅/深）/首页模块/缓存清理/关于 |

## 架构

```
SwiftUI View（Features/<页面>）
   ↓
ViewModel (@Observable, MainActor)
   ↓
Service（PlaybackHistoryService / FavoriteService / DownloadManager / MediaSourceStore）
   ↓
Repository（SwiftData CRUD）
   ↓                 ↘
Provider（MediaProvider 协议）   SwiftData 记录
```

以上整条链路位于 `CinemaKit` 包内；Feature 包只依赖 CinemaKit 的公开 API。

播放器：`PlayerView → PlayerViewModel → PlayerManager → AVPlayer`
弹幕：`PlayerView → DanmakuOverlay → DanmakuRendererView(CALayer) ← DanmakuManager → DanmakuProvider`

- **View 不碰数据库、不请求网络**；ViewModel 不直接写库；Player 不感知 Provider。
- 依赖统一从 `AppEnvironment` 构造并通过 SwiftUI Environment 注入，不使用 Singleton 泛滥。
- 弹幕渲染器为独立 `UIView`，位置由绝对时间推导：时间源直连 `AVPlayer.currentTime()`，暂停冻结、倍速自动跟随、切集清空。
- 所有 seek（进度条拖动、±10s、手势快进、线路切换）统一经 `PlayerViewModel.seek(to:)`，播放器与弹幕时间轴同一次调用内同步，避免回退丢弹幕 / 前进倾泻弹幕。
- 演示源中电影同样可播放：`MediaDetail` 的选集区与播放按钮由 `allEpisodes` 驱动，电影据此生成单条「正片」季集结构，与剧集走同一条播放链路。

## 如何接入真实媒体源

实现 `MediaProvider` 协议（`Modules/CinemaKit/Sources/MediaProvider.swift`）即可接入自有 NAS / 服务器 / 自建 API：

```swift
struct MyServerProvider: MediaProvider {
    let info = ProviderInfo(id: "myserver", name: "我的服务器", kind: .remote, description: "…")
    func home() async throws -> HomeData { … }
    func search(keyword: String, filters: SearchFilters) async throws -> [MediaItem] { … }
    func catalog(kind: MediaKind?, page: Int, pageSize: Int) async throws -> [MediaItem] { … }
    func detail(id: String) async throws -> MediaDetail { … }
    func episodes(id: String) async throws -> [Episode] { … }
    func playInfo(episodeId: String) async throws -> PlayInfo { … }
    func resolvePlayback(line: PlayLine, episodeId: String) async throws -> ResolvedPlayback { … }
}
```

`playInfo` 只声明「有哪些线路、哪些外挂字幕」（`PlayLine` 是纯描述，不含地址）；
真正的播放地址由 `resolvePlayback` 按需解析——因此解析可以是异步的、可失败的、短时有效的
（临时签名、二次跳转、分线路限流都在这一步消化），播放器侧只认 `ResolvedPlayback(url:urlKind:)`。

在 `AppEnvironment.providers` 数组中注册即可；UI 与播放器零改动。
新实现放进 `CinemaKit` 包（或独立包后由 `AppEnvironment` 依赖），Provider 协议本身已 `public`。
敏感 Token/密码经 `MediaSourceStore` 存入 Keychain。

> 注意：本项目定位为私人播放器，请只接入你有权访问的内容源（自有 NAS、
> 自建服务器、正版授权 API 等），不要实现绕过 DRM 或未授权的解析逻辑。

## 本地媒体

把 `mp4 / m4v / mov` 文件放进 App 的 `Documents/MediaLibrary/`
（通过"文件"App），即可在"本机媒体库"中浏览和播放。

## CI 自动化

仓库配置了 GitHub Actions（`.github/workflows/ios-build.yml`），在 macOS runner 上：

- 每次 push 自动用 Xcode 编译验证；
- 编译后在 iPhone 模拟器自动导航截图（首页 / 详情 / 播放器 / 片库 / 设置 / 深色首页），
  到 Actions 运行页面的 Artifacts 下载 `app-screenshots` 即可预览界面；
- 工程由 Tuist 管理，CI 上执行 `tuist generate --no-open` 后构建。
  本地如需跑测试（`PrivateCinemaTests` 单元测试 / `PrivateCinemaUITests` UI 测试），
  同样先执行 `tuist generate`，之后在 Xcode 中 `Cmd + U` 或：
  `xcodebuild test -workspace PrivateCinema.xcworkspace -scheme PrivateCinema -destination 'platform=iOS Simulator,name=iPhone 15 Pro'`

### 单元测试覆盖

| 测试文件 | 覆盖内容 |
| --- | --- |
| `SubtitleParserTests` | SRT / VTT 解析、时间戳、CRLF、空输入、排序 |
| `DanmakuManagerTests` | 弹幕加载排序、种子门槛（仅 Mock 源）、过滤规则、高能统计归一化、高能区间 |
| `DownloadManagerTests` | 任务状态机：入列、去重、暂停续传断点、失败、跨实例恢复、清理已完成 |
| `HTTPDownloadEngineTests` | 下载引擎：完整下载字节进度、Range 断点续写、4xx 抛业务错误、续传协商失败回退全量 |
| `HomeModuleAndSpoilerFilterTests` | 首页 section id 映射完整性、防剧透过滤 |

单测以 `@testable import CinemaKit` 访问内核内部符号（`DownloadEventBridge` 等保持 internal）。

## 后续路线（P2）

- WebDAV / Jellyfin / Emby / Plex Provider
- HLS（m3u8）下载支持（逐段下载合并；当前仅 mp4 直链）
- CloudKit 同步（SwiftData + `ModelConfiguration(cloudKitDatabase: .automatic)`）
- 弹幕高能片段识别（基于 `DanmakuManager.highlightRanges` 扩展）

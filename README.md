# 私人影院 · PrivateCinema

Apple TV + Infuse 风格的极简私人影视中心（iOS）。

仅供个人使用：无广告、无 VIP、无运营位。所有内容通过统一 `MediaProvider` 协议接入，
内置演示媒体库（公开测试视频流 + 占位海报）保证开箱即可运行，不包含任何抓取或解析逻辑。

## 环境要求

- **Xcode 16+**（项目使用 Xcode 16 的同步文件组格式 `objectVersion 77`）
- **iOS 17.0+**（SwiftUI `@Observable` / SwiftData）
- iPhone / iPad 通用

## 运行

1. 双击打开 `PrivateCinema.xcodeproj`
2. 选择任意 iOS 17+ 模拟器（建议 iPhone 15 Pro）
3. `Cmd + R` 运行

> 本仓库在 Linux 环境生成，无法执行 `xcodebuild`；如首次构建报签名错误，
> 在 Target → Signing & Capabilities 里选择你的 Team 即可（模拟器运行无需签名）。

如果你使用 [XcodeGen](https://github.com/yonaskolb/XcodeGen)，也可以执行 `xcodegen generate` 从 `project.yml` 重新生成工程文件。

## 功能总览（P0/P1 已实现）

| 模块 | 说明 |
| --- | --- |
| 首页 | 欢迎语 + 继续观看（进度/百分比/当前集）+ 收藏 + 最近更新/添加 + 分类热门，模块可在设置中隐藏 |
| 发现 | 防抖搜索（标题/演员/类型）+ 类型快筛 + 筛选面板（类型/年代/地区/题材/规格/评分/完结） |
| 详情 | Backdrop 大图 + 渐变遮罩 + 播放/收藏(想看/收藏/看过)/下载 + 选集网格（✓ 已看 / ▶ 当前）+ 简介/演员/剧照/相关推荐/视频规格 |
| 播放器 | AVPlayer + 自绘 Apple TV 风格控制层：单击显隐、±10s、长按 2x、手势快进/亮度/音量、倍速 0.5~2.0、自动下一集倒计时、上一集/下一集 |
| PiP | 系统 `AVPictureInPictureController`，退出播放页可继续小窗（后台模式已声明） |
| AirPlay | 系统 `AVRoutePickerView` |
| 弹幕 | `DanmakuProvider` 协议 + 本地存储 + 种子弹幕；CALayer + CADisplayLink 高性能渲染、车道防重叠、显示区域/透明度/字号/速度/分类屏蔽/关键词屏蔽、发送弹幕、高能进度条（Heatmap）、防剧透关键词过滤 |
| 字幕 | SRT/VTT 解析器 + 外挂字幕自绘渲染（字号/位置/颜色/背景/±5s 偏移）+ HLS 内嵌字幕轨道选择 |
| 进度 | 每 5 秒自动保存，≥90% 判定看完；继续观看直接 seek 上次位置 |
| 片库 | 分类 Segment + 网格/列表 + 排序（最近添加/观看/名称/年份/评分/更新）+ 观看状态筛选 |
| 历史 | 按日期分组、单条删除、清空、点击续播 |
| 下载 | 任务状态机 + 进度 + 暂停/继续/删除 + Wi-Fi/自动下一集/看完删除设置（当前为模拟引擎） |
| 媒体源 | 配置管理（名称/类型/地址/Keychain 密钥/启停/测试连接）；WebDAV/Jellyfin/Emby/Plex 为 P2 预留 |
| MiniPlayer | Apple Music 风格常驻条，点按回到全屏播放器 |
| 设置 | 播放/字幕/弹幕/外观（跟随系统/浅/深）/首页模块/缓存清理/关于 |

## 架构

```
SwiftUI View
   ↓
ViewModel (@Observable, MainActor)
   ↓
Service（PlaybackHistoryService / FavoriteService / DownloadManager / MediaSourceStore）
   ↓
Repository（SwiftData CRUD）
   ↓                 ↘
Provider（MediaProvider 协议）   SwiftData 记录
```

播放器：`PlayerView → PlayerViewModel → PlayerManager → AVPlayer`
弹幕：`PlayerView → DanmakuOverlay → DanmakuRendererView(CALayer) ← DanmakuManager → DanmakuProvider`

- **View 不碰数据库、不请求网络**；ViewModel 不直接写库；Player 不感知 Provider。
- 依赖统一从 `AppEnvironment` 构造并通过 SwiftUI Environment 注入，不使用 Singleton 泛滥。
- 弹幕渲染器为独立 `UIView`，位置由绝对时间推导：暂停冻结、seek 自动同步、切集清空。

## 如何接入真实媒体源

实现 `MediaProvider` 协议（`Providers/MediaProvider.swift`）即可接入自有 NAS / 服务器 / 自建 API：

```swift
struct MyServerProvider: MediaProvider {
    let info = ProviderInfo(id: "myserver", name: "我的服务器", kind: .remote, description: "…")
    func home() async throws -> HomeData { … }
    func search(keyword: String, filters: SearchFilters) async throws -> [MediaItem] { … }
    func catalog(kind: MediaKind?, page: Int, pageSize: Int) async throws -> [MediaItem] { … }
    func detail(id: String) async throws -> MediaDetail { … }
    func episodes(id: String) async throws -> [Episode] { … }
    func playInfo(episodeId: String) async throws -> PlayInfo { … }
}
```

在 `AppEnvironment.providers` 数组中注册即可；UI 与播放器零改动。
敏感 Token/密码经 `MediaSourceStore` 存入 Keychain。

> 注意：本项目定位为私人播放器，请只接入你有权访问的内容源（自有 NAS、
> 自建服务器、正版授权 API 等），不要实现绕过 DRM 或未授权的解析逻辑。

## 本地媒体

把 `mp4 / m4v / mov` 文件放进 App 的 `Documents/MediaLibrary/`
（通过"文件"App），即可在"本机媒体库"中浏览和播放。

## 后续路线（P2）

- WebDAV / Jellyfin / Emby / Plex Provider
- 真实下载引擎（替换 `DownloadEngine` 的 Mock 实现）
- CloudKit 同步（SwiftData + `ModelConfiguration(cloudKitDatabase: .automatic)`）
- 弹幕高能片段识别（基于 `DanmakuManager.highlightRanges` 扩展）

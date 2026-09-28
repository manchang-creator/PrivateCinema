# AGENTS.md · PrivateCinema 私人影院（iOS）

面向 AI 编程代理与协作者的**仓库级**工作约定。
**用中文回答用户。** 详细上手见 `README.md`；本文件只保留**可执行规则**，避免与 README 重复长文。

**取舍：** 偏谨慎而非速度；澄清先于实现；只动必须动的代码。

---

## 0. 最高指令（全仓 · 不可违反）

1. **向用户提问必须使用交互提问工具**（环境工具名：`ask_user_question` / `AskUserQuestion`）。
   - **适用：** 任务目标未指明、存在多种实现方案需抉择、关键设计取舍、破坏性操作或需明确授权。
   - **要求：** 必须调用提问工具给出清晰可选项（推荐项标「推荐」）；**严禁**仅用聊天纯文本反问替代工具调用；未收到用户选择前不得擅自选定方案实现。
2. **严禁伪造构建与验收结论。**
   - 本仓库可能由 Agent 在无 Xcode 环境（如 Linux）下修改，此时**无法执行 `xcodebuild` / 模拟器**；只能做静态检查（完整阅读改动文件、核对类型与引用）。
   - 改动后**如实说明「未编译验证」**；严禁声称「已运行通过 / 已在模拟器验证 / 推测没问题」。具备 Mac + Xcode 16 环境时才可执行 §5 的构建验证。
3. **禁止兜底式修复（对就对，错就错）。**
   - 数据或行为出错必须修根因，不得用「空值回退」「旧字段兼容」「`try?` 吞错」「双写并存」掩盖问题；存量脏数据一次修到位，禁止在展示层临时兜底。
   - 已知例外：`PersistenceController` 的容器创建降级（持久层失败退化为内存模式）是有意设计，保持现状。
4. **未经用户明确要求，禁止执行 `git commit` / `git push` / 打 tag / 发布。**

---

## 1. 工具链与环境（纯本地应用 · 无外部服务）

本项目为**纯本地 iOS 应用**：无云服务器、无数据库凭据、无部署流程。数据全部存于设备本地（SwiftData + Keychain + UserDefaults）。

| 项 | 值 |
|---|---|
| 语言 / UI | Swift 5 + SwiftUI（`@Observable` / SwiftData） |
| 最低系统 | iOS 17.0（iPhone / iPad 通用，`TARGETED_DEVICE_FAMILY: 1,2`） |
| IDE | Xcode 16+（同步文件组 `objectVersion 77`，**勿改回旧式 pbxproj 文件列举**） |
| 工程生成 | [XcodeGen](https://github.com/yonaskolb/XcodeGen)：改 `project.yml` 后 `xcodegen generate` |
| 签名 | 模拟器无需签名；真机在 Target → Signing & Capabilities 选 Team |
| 敏感存储 | Keychain（`KeychainStore`）；**严禁** Token/密码写 UserDefaults、代码常量或日志 |

**内容红线：** 本项目定位私人播放器，只接入用户有权访问的内容源（自有 NAS、自建服务器、正版授权 API）；**严禁**实现绕过 DRM、未授权抓取或解析逻辑。

---

## 2. 项目架构与边界地图

```text
PrivateCinema/
├── App/                 # 入口 + AppEnvironment（依赖装配唯一入口）+ RootView
├── Features/            # 页面：Home / Library / Detail / Search / History / Favorites
│   │                    #       Downloads / Sources / Settings / Profile
│   └── <页面>/          # View + ViewModel 成对同目录
├── Player/              # AVPlayer 封装：View/ViewModel/Manager + 自绘控制层 + MiniPlayer / PiP / AirPlay
├── Danmaku/             # 弹幕：Provider 协议 + Manager + CALayer 渲染器 + 设置 + 高能条 + 防剧透过滤
├── Subtitles/           # SRT/VTT 解析 + 渲染 + 设置
├── Models/              # 值类型模型（MediaItem / MediaDetail / Episode / PlayInfo / …）
├── Providers/           # MediaProvider 协议 + Mock / Local 实现（媒体内容唯一入口）
├── Services/            # 业务服务：PlaybackHistory / Favorite / Download / MediaSourceStore / DeviceIdentity
├── Persistence/         # SwiftData：PersistenceController + @Model Records + 各 Repository
├── Components/          # 共享 UI 组件（CachedImage / StateViews / MediaComponents）
└── Core/                # Extensions / Networking(ImageLoader) / Utilities(AppError / KeychainStore)
```

**模块红线（违反即打回）：**

1. **View 不碰数据库、不发网络请求**：页面只组装 ViewModel 提供的状态与回调。
2. **ViewModel 不直接写库**：持久化一律经 Service → Repository（SwiftData）。
3. **Player 不感知 Provider**：播放器只吃 `PlaybackRequest`（media / episode / playlist / startPosition），内容获取在页面层完成后传入。
4. **依赖装配唯一入口 `AppEnvironment`**，经 SwiftUI Environment 注入；**严禁**新增 Singleton 或全局静态共享实例。
5. **媒体内容只经 `MediaProvider` 协议接入**：新源 = 新 Provider 实现 + 在 `AppEnvironment.providers` 注册，UI 与播放器**零改动**。
6. **弹幕渲染是独立 `UIView`（CALayer + CADisplayLink）**：位置由绝对时间推导；禁止把弹幕画进 SwiftUI 层级或用 TimelineView 重写渲染核心。
7. **异步一律 async/await**；UI 层 `@MainActor`（ViewModel 均为 `@MainActor @Observable`），跨线程数据库访问走存储型 Actor（`DanmakuStoreActor`）。

---

## 3. 编码原则（外科手术式改动）

1. **最小代码原则**：能用最少代码解决绝不堆砌；不为一次性场景引入抽象或「灵活性 / 可配置性」；没有必然发生的错误不堆冗余 catch。
2. **只动必须动的**：不重构未损坏的代码；不顺手改相邻代码的格式与注释；不擅自删除存量代码（本次引入的孤儿代码除外）。
3. **复用先于手搓**：优先用 SwiftUI / SwiftData / Foundation 既有能力与项目封装（`CachedImage`、`StateViews`、`AppError`、`FormatExtensions`、`Haptics`）；同类问题禁止重复造易错轮子。
4. **命名与文件**：文件名描述职责；一个 Feature 一个目录，View 与 ViewModel 成对；避免「上帝 View」（加载、解析、渲染、工具全部堆在一个文件）。
5. **风格对齐**：新代码匹配现有注释密度与中文 Docstring 风格、命名与 idiom。
6. **SwiftData 记录只存原始值类型**（字符串 / 数值 / Date），复杂类型以字符串形式存（如 URL 字符串），为未来 CloudKit 同步留路；新增 `@Model` 后必须在 `PersistenceController.schemaModels` 注册。

---

## 4. 常用命令

| 场景 | 命令 | 说明 |
|---|---|---|
| 重新生成工程 | `xcodegen generate` | 仅改 `project.yml` 后需要 |
| 构建 | `xcodebuild -project PrivateCinema.xcodeproj -scheme PrivateCinema -destination 'platform=iOS Simulator,name=iPhone 15 Pro' build` | **仅 Mac + Xcode 16 环境** |
| 运行 | Xcode 打开工程 → 选 iOS 17+ 模拟器 → `Cmd + R` | 模拟器无需签名 |
| 新增 Swift 文件 | 无需任何命令 | 同步文件组自动收录，**不要**手改 pbxproj |

> 只有改 target 设置 / Info.plist 属性 / 依赖时才动 `project.yml`（及根目录 `Info.plist`），随后 `xcodegen generate`。

---

## 5. 变更后验证

1. **无 Xcode 环境（Linux 等）**：做静态自查——完整阅读改动文件、核对类型/引用/协程隔离（`@MainActor` / `Sendable`）、确认无孤儿引用；**如实告知「未编译验证」**。
2. **Mac 环境**：构建通过后跑主链路——首页 → 详情 → 播放 → 弹幕 / 字幕 → 退出重进续播。
3. **播放器 / 弹幕 / 字幕属易碎区**：涉及手势、时间轴、CALayer 渲染的改动必须在真机 / 模拟器验证，不得仅凭代码推断。
4. 无法验证时明确标注 NOT_TESTED，严禁伪造验收结论。
5. 功能落地后同步更新 `README.md` 的功能总览表与架构图。

---

## 6. Git 协作安全规范（仅当用户明确指示 Git 操作时）

1. **严禁广度暂存**：禁止 `git add -A` / `git add .`；始终且只 `git add <明确文件路径>`；提交前 `git status` 确认暂存范围。
2. **禁止破坏性命令**：`git reset --hard`、`git checkout .`、`git clean -fd`、`git stash`、`commit --no-verify`、force push。
3. **Commit 规范**：Conventional Commits，正文全中文工程化动词（新增 / 修复 / 优化 / 重构 / 完善），不使用 emoji、不加 Co-Authored-By 尾注：

   ```text
   type(scope): 简要说明

   - 改动点1
   - 改动点2
   ```

   常用 `type`：`feat` / `fix` / `refactor` / `chore` / `docs` / `perf`。
   常用 `scope`：`player` / `danmaku` / `subtitle` / `home` / `detail` / `library` / `search` / `download` / `source` / `settings` / `persistence` / `repo` / `docs`。
4. 远端：`origin = github.com/manchang-creator/PrivateCinema`；推送前 `git pull --rebase`，绝不 force push。

---

## 7. 任务路由速查

| 任务 | 去哪 |
|---|---|
| 改页面 UI / 交互 | `Features/<对应页面>/`（View + ViewModel 成对改） |
| 改播放器行为（手势 / 控制层 / 倍速 / PiP / AirPlay） | `Player/`；业务数据获取不写进 `PlayerManager` |
| 改弹幕（渲染 / 设置 / 过滤 / 高能条） | `Danmaku/`；存储经 `DanmakuStoreActor` |
| 改字幕 | `Subtitles/` |
| **接入新媒体源（WebDAV / Jellyfin / Emby / Plex）** | 实现 `Providers/MediaProvider.swift` 协议 + `AppEnvironment.providers` 注册；UI 零改动；密钥经 `MediaSourceStore` 入 Keychain |
| 改本地数据 / 持久化 | `Persistence/`（@Model + Repository）+ 对应 Service |
| 下载任务 | `Services/DownloadManager.swift`（当前 Mock 引擎，P2 换真实引擎） |
| 改依赖装配 / 全局入口 | `App/AppEnvironment.swift`（唯一入口） |
| 改工程配置 / Info.plist / 图标 | `project.yml` + `Info.plist` → `xcodegen generate` |
| 文档 | `README.md`（随功能同步更新） |

---

## 8. 联网检索与外部信息核实

凡涉及 Apple API 行为、SwiftUI / SwiftData / AVFoundation 版本差异、第三方库用法时，必须联网核实，不得凭旧记忆推断：

1. **权威度优先级**：Apple 官方文档（developer.apple.com）/ 官方 Sample Code > WWDC Session > 权威技术社区。
2. 检索结果只有标题或模糊摘要时，读原文再回答；联网工具不可用时如实说明，**不得虚构**。
3. 回答简短、客观、技术优先，附事实来源链接。

---

## 9. 回答风格

- 简短、技术、直接；少废话与填充文案。
- 提交、issue、代码中不使用 emoji。

**准则生效的标志：** diff 更小、澄清发生在实现之前而非犯错之后、从不出现伪造的「已验证」。

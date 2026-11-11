# AGENTS.md · PrivateCinema Windows 客户端

面向 AI 编程代理与协作者的 **Windows 端仓库级**约定。根目录 `AGENTS.md` 中的
Swift / Tuist / Xcode 规则**不适用于本目录**；此处只写 Electron + React + TypeScript 的规矩。

**取舍：** 偏谨慎而非速度；澄清先于实现；只动必须动的代码。

---

## 0. 定位与当前阶段（2026-11-08 起）

iOS 客户端已暂停废弃（见根 `AGENTS.md` §0）。当前全部工作重心在此目录。

首版范围 = **播放器 MVP**：`选文件 → 播放 → 字幕 → 弹幕渲染 → 续播` 全链路先跑通，
验证解码与渲染真实可用，再谈其他页面。

- 不实现 DRM 绕过、未授权抓取、第三方站点解析。只播用户本地有权访问的文件。
- 不接云端服务。全部数据留在本机。

---

## 1. 最高指令（本目录 · 不可违反）

1. **向用户提问必须使用交互提问工具**（`AskUserQuestion`）。不得用纯文本反问替代。
2. **严禁伪造构建与验收结论。**
   - 单元测试绿 ≠ 视频能播。Mock / 纯逻辑测试**不得**当作「播放链路已验证」。
   - 未真正用真实视频文件走过一遍全链路时，必须明说「未做端到端播放验证」。
   - 只在 `typecheck` / `test` / `build` 真实执行并看到输出后才可声称通过。
3. **禁止兜底式修复。** 数据或行为出错必须修根因；不得用空值回退、旧字段兼容、
   `try/catch` 吞错掩盖问题。进度文件损坏可重建，这是刻意的（见 §5 `ProgressStore`）。
4. **未经用户明确要求，禁止 `git commit` / `git push` / 打 tag / 发布。** 推送前先报告计划。
5. **不得提交 `docs/`、`.tmp-ci/`、截图产物**（见 §7）。

---

## 2. 工具链与依赖天花板

| 项 | 值 |
|---|---|
| 运行时 | Electron `~39.8.10`（**已锁定**） |
| UI | React 19 + TypeScript 5.9 |
| 构建 | electron-vite 5（vite 7） |
| 测试 | vitest 4 |
| Node | **20.19.0 —— 硬上限** |

**依赖升级红线：** 本机 Node 为 20.19.0。

- `electron@42+` 声明 `engines.node >= 22.12.0` —— 不可升。
- `vitest@5` 要求 `^22.12.0` —— 不可升。
- `@vitejs/plugin-react@6` 要求 vite ^8 —— 不可升。
- `electron-vite@6` 走 rolldown —— 不升。

升级任何一项前，先确认其 `engines.node` 与 peer 依赖在本机满足，否则 `npm install` 直接失败。

---

## 3. 目录结构与职责

```text
windows/
├── electron.vite.config.ts   # 三入口构建（main / preload / renderer）+ @shared 别名
├── vitest.config.ts          # 只跑 test/ 下的纯逻辑测试，environment: node
├── tsconfig.node.json        # 主进程 / 预加载 / 共享代码（无 DOM）
├── tsconfig.web.json         # 渲染进程（含 DOM + JSX）
├── src/
│   ├── shared/               # 三端共用，唯一契约来源
│   │   ├── types.ts          # 领域模型（MediaItem / Episode / DanmakuItem / WatchProgress）
│   │   ├── ipc.ts            # CinemaApi 接口 + IPC 通道名常量
│   │   └── media-url.ts      # cinema:// 协议编解码 + 扩展名白名单
│   ├── main/                 # 主进程：窗口 / IPC / 本地文件
│   │   ├── index.ts          # 入口：协议注册、窗口、IPC 装配、生命周期
│   │   ├── media-protocol.ts # cinema:// 处理器：授权校验、Range 分段、MIME
│   │   ├── media-access.ts   # 媒体访问授权表（仅放行用户选择过的路径）
│   │   ├── library.ts        # 视频扫描与剧集归组（SxxEyy）
│   │   ├── subtitle-file.ts  # 同目录字幕发现与优先级
│   │   ├── progress.ts       # 播放进度 JSON 存储（原子写入）
│   │   └── brightness.ts     # 显示器亮度：koffi 直调 dxva2.dll（DDC/CI）
│   ├── preload/
│   │   └── index.ts          # 唯一职责：把 IPC 包成 window.cinema
│   └── renderer/
│       ├── index.html
│       └── src/
│           ├── main.tsx      # React 挂载
│           ├── App.tsx       # 两态外壳：片库 / 播放
│           ├── styles.css
│           ├── danmaku/      # 弹幕：engine（纯逻辑）/ settings / seeder / canvas
│           ├── player/       # PlayerScreen：视频 + 字幕 + 弹幕 + 进度
│           ├── subtitle/     # parser：SRT / VTT 解析 + 二分查找
│           └── ui/           # LibraryScreen + format 工具
└── test/                     # vitest 测试（8 个文件）：纯逻辑 + 存储往返 + 协议响应
```

**进程边界（违反即打回）：**

1. **渲染进程不碰 Node、不碰文件系统。** 一切文件访问经 `window.cinema` → IPC → 主进程。
   `contextIsolation: true` + `nodeIntegration: false` 是安全边界，不得放宽。
2. **主进程不碰媒体解码。** 解码、字幕渲染、弹幕动画全在渲染进程；主进程只负责给 URL。
3. **`src/shared/` 是三端唯一契约。** 改它 = 改协议，三端必须同步。禁止在两端各写字符串字面量
   （通道名拼错只会静默失败）。
4. **`@shared` 别名必须三处同步**：`electron.vite.config.ts` 的三个入口、`tsconfig.node.json`、
   `tsconfig.web.json`。漏一处即 `Cannot find module`。

---

## 4. 本地媒体协议 `cinema://`

渲染进程开 `webSecurity`，`file://` 不可用；`<video src>` 需要可流式读取的 URL。

- 编码：UTF-8 → base64 → `encodeURIComponent`，形如 `cinema://local/<base64>`。
  规避盘符 `C:`、反斜杠与中文的转义差异。
- **授权表是第一道闸**（`src/main/media-access.ts`）：只放行用户在本进程内通过
  「选文件 / 选文件夹」明确选择过的路径，精确匹配，不做目录级放宽。
- **扩展名白名单**：`.mp4 .m4v .mov .mkv .webm .srt .vtt`。不在表内一律 403。
- `registerSchemesAsPrivileged` 必须带 **`stream: true`**。
- 处理器实现在 `src/main/media-protocol.ts`，**手写 Range 分段**（`parseRangeHeader`）：
  206 + `Content-Range` + `Accept-Ranges`，body 用 `createReadStream(start,end)` 流式返回。
  416 必须带 `Content-Range: bytes */<size>` 与 `Content-Length: 0`。

**为什么必须有授权表：** 路径以 base64 编码在 URL 里，渲染进程可以自行构造任意
`cinema://local/<base64>`。扩展名白名单只能挡「非媒体文件」，挡不住「任意媒体文件」——
一旦渲染进程被注入脚本，攻击面就是整机的 mp4。授权表把「能读什么」收敛到用户点过的文件。

**为什么必须 `realpath`：** 符号链接可以叫 `影片.mp4` 却指向别的文件。先解析真实路径、
再验一次扩展名，并**用解析后的路径读取**，保证「校验的文件」就是「读取的文件」。
硬链接无法这样识别，由授权表兜住（用户没选过就不在表内）。

**为什么不能用 `net.fetch(pathToFileURL(...))` 转发：** Chromium 的 file loader 忽略 `Range` 头，
`net.fetch` 只是原样透传，结果是 `<video>.seekable` 恒为 `[0,0]` —— 拖动进度条与续播
**静默失效**（不报错，`seeked` 事件照常触发但 `currentTime` 不前进）。这是已实测确认的行为，
不要「优化」回 `net.fetch`。Range 解析与响应头一致性由 `test/media-protocol.test.ts` 覆盖
（12 条解析 + 12 条 handler / 授权）。

---

## 4.1 媒体格式支持边界（Electron 39.8.10 / Chromium 142）

**容器、视频编码、音频编码是三件独立的事。**「能播 MP4」不等于「能播 H.264 的 MP4」，
「是 MKV 就一定不能播」也不对——要看里面装的是什么。以下是 `canPlayType` 与
`MediaSource.isTypeSupported` 在本机 Electron 39.8.10 上的**实测**结果。

| 容器 | 直接 `<video src>` | 说明 |
|---|---|---|
| MP4 / M4V (`video/mp4`) | **可用** | H.264+AAC、H.264+MP3、H.264+Opus、H.264+FLAC、AV1 均为 `probably` |
| MOV | **可用（按 `video/mp4` 声明）** | `video/quicktime` 在 Chromium 容器表中**不存在**，按原名声明必失败 |
| WebM | **可用** | VP8/VP9/AV1 + Opus/Vorbis 均 `probably` |
| MKV (`video/x-matroska`) | **不可用** | 全部组合 `canPlayType` 返回空串，MSE 亦为 false |
| HLS (`.m3u8`) | **不可用** | 需 hls.js + MSE；`<video src=".m3u8">` 不行 |

**MKV 实测明细（全部不支持）：** H.264+AAC / H.264 裸 / HEVC+AAC / VP9+Opus / AV1+Opus /
H.264+AC-3 / H.264+E-AC-3 / H.264+DTS / H.264+FLAC / 裸容器 —— `canPlayType` 全为 `""`。
注意 Chromium 的 `mime_util_internal.cc` 里 `video/x-matroska` 是**有**条目（MSE 用），
但 `<video src>` 直连路径不接受；源码里 Matroska 也被并入 `kContainerWebM` 枚举。

**HEVC 不保证可用：** `video/mp4; codecs="hvc1..."` 实测返回 `""`（需平台硬件解码支持，
本机没有）。不要假设 HEVC MP4 能播。

**MSE 侧（供未来 HLS 用）：** fMP4 H.264+AAC ✓、MP2T H.264+AAC ✓、WebM VP9+Opus ✓；
MP4 里的 AC-3 ✗、HEVC ✗；Matroska ✗。

**结论与现状：** 扩展名白名单里的 `.mkv` 目前**扫得到、播不了**——这是已知缺口，
不是配置错误。遇到 MKV 时播放器会触发 `error` 并显示「无法播放」，行为是正确的（不假装能播）。
要真正支持 MKV，唯一路径是引入 hls.js 之外的解封装方案（如 mp4box / 转封装），属于后续工作。

新增可播格式 = 同时改 `ALLOWED_MEDIA_EXTENSIONS` 与 `src/main/library.ts` 的
`VIDEO_EXTENSIONS`，两处不同步会出现「扫得到但播不了」。

---

## 5. 关键设计决策

### 弹幕引擎（`danmaku/engine.ts`）三条不变量

移植自 iOS `DanmakuRendererView`，语义必须一致：

1. **位置由绝对时间推导**，不做逐帧累加 —— 掉帧不产生漂移。
2. **车道用「该车道空闲时刻」占用**，不排队；车道全满即丢弃。
   排队会让弹幕滞后于画面，比丢一条更糟。
3. **seek 后先锚定时间基准**（`syncAnchor`），等播放头落回锚点 ±0.5s 才交还实时时间；
   超过 3s 未生效则强制释放，并重建索引。
   否则后退 seek 会把整段弹幕一次性倾泻到屏幕上。

引擎是**纯逻辑**（无 DOM），时间与视口由外部注入，因此可被单元测试逐帧断言。
**不得**把绘制、时间读取塞进引擎；**不得**用 React 状态驱动每帧重绘。

### 字幕

- `subtitle/parser.ts` 自动识别 SRT / VTT。SRT 用逗号作小数分隔符，VTT 用点。
- VTT 时间行尾部可能带排版参数，只取第一个空格前的部分；`-->` 后的前导空格必须滤掉，
  否则结束时间会被解析成 0。
- 查找用二分（`cueAt`），字幕层只在命中 cue 变化时才 setState，不按帧重渲染。

### 播放进度

- `main/progress.ts` 独占一个 JSON 文件，渲染进程只能经 IPC 读写。
- 写入是**原子**的：先写 `.tmp` 再 `rename`，避免进程被杀留下半截文件。
- 文件损坏 → 从空表重建，**不做旧字段兼容兜底**：进度是纯本地可重建数据，
  猜字段比重建更不可靠。这是刻意设计，不是疏漏。
- 落盘时机：每 5s、暂停时、卸载时、播完时。

### 显示器亮度（`main/brightness.ts`）

koffi 3.3.7 直调 `dxva2.dll`，走 DDC/CI 的 VCP 代码 `0x10`（API 内部固定，无需传参）。
**没有 WMI 分支**：本机 `root\wmi` 下 `WmiMonitorBrightness` / `WmiMonitorBrightnessMethods`
整个类都不存在（实测「不支持」），COM 经 koffi 还要自建 `IDispatch`，收益低于风险。
DXVA2 对内外屏一视同仁：能控制就给范围，不能控制就如实返回原因。

**四条实测约束（改之前必须回看）：**

1. `koffi.errno()` **恒为 0**，不是 Win32 LastError —— 必须显式调 `GetLastError()`。
2. LastError 在成功调用后仍是陈旧值 —— **只在返回值表示失败时读**，且读前先 `SetLastError(0)`。
3. `HMONITOR` / `hPhysicalMonitor` 是 **BigInt** —— 不可当 number 用，不可 `JSON.stringify`。
   好消息：`HMONITOR` 在 `EnumDisplayMonitors` 回调退出后依然有效，所以先收集句柄、
   立刻 `koffi.unregister`，再逐个做 DXVA2 调用 —— 顺带消掉一整类生命周期 / 泄漏 bug。
4. `koffi.struct(null, ...)` / `koffi.proto(null, ...)` 用**匿名类型**：vitest 可能对同一模块
   求值多次，具名类型会撞 `Duplicate type name`。

**错误码要区分，不许塌成一个布尔：** `1168` = `ERROR_NOT_FOUND`（不支持 DDC/CI 或 PnP 禁用）、
`1461` = `ERROR_INVALID_HANDLE`（句柄失效）、`5` = 拒绝访问。`DisplayBrightness` 是
可辨识联合 —— `available: true` 才有 `min/current/max`，`false` 必须带 `reason`。
`max <= min`（范围退化）按「不支持调光」处理，不返回一个拖不动的死滑块。

**写入必须节流（`PlayerScreen.tsx` 的 `flushBrightness`）：** 拖动滑块的事件速率远高于
DDC/CI 的吞吐（单次写是阻塞式 I2C 往返，几十毫秒）。每台显示器**最多一个写入在途**，
期间只保留最新值、在途结束后补发最后一个 —— 不猜固定间隔，让节奏由硬件真实速度决定。
逐次直发会让 IPC 队列越堆越长、主进程被同步 FFI 卡死、窗口僵住。不要「简化」成直发。

**已知环境限制：** 本机两块显示器均为 `CM_PROB_DISABLED`（设备管理器 Code 22），
`GetPhysicalMonitorsFromHMONITOR` 返回 `1168`，且存在 4 个虚拟显示驱动
（Oray / GameViewer / Epson / ToDesk）互相竞争。**亮度端到端调光在本机无法验证**，
只能验证到「枚举 + 如实报错」这一层。

### 安全

- Token / 密码**严禁**写 localStorage、代码常量或日志。Windows 端等价物为系统凭据存储
  （后续接媒体源时用），不得明文落盘。
- `setWindowOpenHandler` 一律 deny + 交给系统浏览器。
- `sandbox: false` 是为了预加载能 `require('electron')`；其余隔离项不得关闭。

---

## 6. 命令

| 场景 | 命令 | 说明 |
|---|---|---|
| 开发（热更新） | `npm run dev` | electron-vite 起主进程 + 渲染 dev server |
| 构建 | `npm run build` | 产物在 `out/`（main / preload / renderer） |
| 类型检查 | `npm run typecheck` | 两个 tsconfig 全量检查，**改完必须跑** |
| 单元测试 | `npm run test` | vitest run，只测纯逻辑 |
| 监听测试 | `npm run test:watch` | |
| 运行构建产物 | `./node_modules/electron/dist/electron.exe .` | `package.json` 的 `main` 指向 `out/main/index.js` |

`out/` 与 `node_modules/` 不入库。

---

## 7. 变更后验证（分级，不得越级宣称）

1. **静态层**：`npm run typecheck` 必须 PASS。改完不跑等于没改。
2. **逻辑层**：`npm run test` 必须全绿。测试覆盖纯逻辑（字幕解析与时间轴、弹幕车道 / 时间基准 /
   播完释放、进度判定与落盘往返、文件名归组、弹幕生成）以及协议响应头一致性。
3. **构建层**：`npm run build` 必须 PASS，产物三件齐全。
4. **运行层**：启动应用，确认窗口渲染出真实 UI（非空白 / 非纯黑）。
5. **端到端层（唯一能宣称「播放可用」的层级）**：用**真实视频文件**走一遍
   `选文件 → 播放 → 字幕加载 → 弹幕上屏 → 退出重进续播`。
   未做这一层，只能报告「编译 / 单测 / 构建通过，播放链路未验证」。

**禁止的表述：**「推测没问题」「应该能播」「单测通过所以播放正常」。
**易碎区**（手势、时间轴、canvas 渲染、Range 请求）必须真机 / 真文件验证。

**CI：** `.github/workflows/windows-build.yml` 在 `windows-latest` 上跑
`npm ci` → `typecheck` → `test` → `build`，并校验三件产物存在。Node 锁 `20.19.0`
（与本地一致，见 §2）。CI 只到「构建层」，**不能**替代 §7.5 的端到端验证。

**提交产物红线：** `.shot-*.png` 等截图、`docs/`、`.tmp-ci/` 一律不提交。

---

## 8. 编码原则（外科手术式改动）

1. **最小代码**：能少写就少写；不为一次性场景引入抽象。
2. **只动必须动的**：不重构未损坏的代码，不顺手改格式。
3. **命名**：变量 / 函数 / 类型用英文；注释、日志、界面文案用中文。
4. **注释风格**：`// ==================== 分块标题 ====================`，
   关键不变量必须写明「为什么」，而不是「做了什么」。
5. **类型**：`strict` 全开，`noUnusedLocals` / `noUnusedParameters` / `verbatimModuleSyntax` 开启。
   跨进程类型只从 `src/shared/` 取，禁止在 renderer 里重新定义领域模型。
6. **React**：`@Observable` 那套是 iOS 的；这里用 hooks。避免按帧 setState ——
   时间轴走 `useRef`，只有 UI 文本需要显示时才 setState。

---

## 9. Git 协作（仅当用户明确指示时）

1. **严禁广度暂存**：禁止 `git add -A` / `git add .`；只 `git add <明确文件路径>`，提交前 `git status` 确认。
2. **禁止破坏性命令**：`git reset --hard`、`git checkout .`、`git clean -fd`、`git stash`、
   `commit --no-verify`、force push。
3. **Commit 规范**：Conventional Commits，正文中文工程化动词，无 emoji，无 Co-Authored-By 尾注。

   ```text
   type(scope): 简要说明

   - 改动点1
   - 改动点2
   ```

   常用 `type`：`feat` / `fix` / `refactor` / `chore` / `docs` / `perf`。
   常用 `scope`：`player` / `danmaku` / `subtitle` / `library` / `progress` / `ipc` / `build`。

---

## 10. 任务路由速查

| 任务 | 去哪 |
|---|---|
| 改播放器行为（播放 / 暂停 / seek / 全屏 / 换集） | `src/renderer/src/player/PlayerScreen.tsx` |
| 改弹幕渲染逻辑（车道 / 时间 / 速度） | `src/renderer/src/danmaku/engine.ts` + `test/danmaku-engine.test.ts` |
| 改弹幕绘制（字体 / 描边 / 清晰度） | `src/renderer/src/danmaku/DanmakuCanvas.tsx` |
| 改弹幕设置项 | `danmaku/settings.ts`（含 `normalizeSettings` 区间）+ 设置面板 |
| 改字幕解析 / 查找 | `subtitle/parser.ts` / `main/subtitle-file.ts` |
| 改扫描与剧集归组 | `src/main/library.ts` |
| 改进度存储 | `src/main/progress.ts` |
| 改显示器亮度（DDC/CI / 错误码） | `src/main/brightness.ts` + `test/brightness.test.ts`（FFI 部分不可单测） |
| 新增 IPC 能力 | `src/shared/ipc.ts`（接口 + 通道名）→ `main/index.ts` 注册 → `preload/index.ts` 包装 → `env.d.ts` 已有类型 |
| 改本地媒体协议 / Range | `src/main/media-protocol.ts` + `test/media-protocol.test.ts` |
| 改文件访问授权范围 | `src/main/media-access.ts` + `main/index.ts` 的授权调用点 |
| 改窗口 / 安全策略 | `src/main/index.ts` |
| 改依赖 / 构建配置 | `package.json` + `electron.vite.config.ts`（先看 §2 天花板） |
| 架构级变更（增删目录 / 模块重组） | **必须同步更新本文件** |

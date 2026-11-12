# AGENTS.md · PrivateCinema Linux 客户端

面向 AI 编程代理与协作者的 **Linux 端仓库级**约定。根 `AGENTS.md` 的 Swift / Tuist / Xcode 规则
与 `windows/AGENTS.md` 的 Windows 规则**都不适用于本目录**；这里只写 Linux + Electron 的规矩。

**取舍：** 偏谨慎而非速度；澄清先于实现；只动必须动的代码。

---

## 0. 定位与当前阶段

与 `windows/` 同构的 Linux 桌面客户端：`选文件 / 选文件夹 → 播放 → 字幕 → 弹幕 → 续播`，
外带 Linux 特有的**显示器亮度**（sysfs + DDC/CI）。跨平台内核在
`packages/core`（`@private-cinema/core`），Windows 与 Linux 共用，**不得各写一份**。

- 不实现 DRM 绕过、未授权抓取、第三方站点解析。只播用户本地有权访问的文件。
- 不接云端服务。全部数据留在本机。

---

## 1. 最高指令（本目录 · 不可违反）

1. **向用户提问必须使用交互提问工具**（`AskUserQuestion`）。不得用纯文本反问替代。
2. **严禁伪造构建与验收结论。**
   - 单测绿 ≠ 视频能播 ≠ 亮度能调。三者是不同层级（见 §7），不得越级宣称。
   - 只在 `typecheck` / `test` / `build` / `electron-builder` 真实执行且看到输出后，才可声称通过。
3. **禁止兜底式修复。** 出错修根因；不得用空值回退、旧字段兼容、`try/catch` 吞错掩盖。
   例外（刻意设计）：`ProgressStore` 文件损坏 → 从空表重建；亮度不可用 → 返回**带原因**的
   `available: false`，而不是静默出一个拖不动的滑块。
4. **未经用户明确要求，禁止 `git commit` / `git push` / 打 tag / 发布。**
5. `node_modules/`、`out/`、`release/`、`build/*.AppImage`、`build/*.deb` 不入库。

---

## 2. 工具链与依赖

| 项 | 值 |
|---|---|
| 运行时 | Electron `~39.8.10`（与 windows 对齐，**不单独升级**） |
| UI | React 19 + TypeScript 5.9 |
| 构建 | electron-vite 5（vite 7） |
| 打包 | electron-builder 26（AppImage + deb） |
| 测试 | vitest 4 |
| Node | 本机 22.23.2；CI 与 windows 一致锁 20.19.0（本目录依赖未超出该版本能力） |
| 显示服务器 | X11（实测 `x11`；Wayland 下 Electron 走 XWayland，未验证） |

**依赖升级红线：** 与 `windows/AGENTS.md` §2 同源 —— `electron@42+` / `vitest@5` /
`@vitejs/plugin-react@6` / `electron-vite@6` 都超出 Node 20.19.0 或需要 vite 8，不升。
升级任何一项前先查 `engines.node`。

**镜像（本机网络限制下的必要配置，不是可选优化）：** electron 二进制与 `electron-builder`
工具集从 GitHub 下载会被 TLS 重置（`Client network socket disconnected before secure TLS
connection was established`）。因此 `package.json` 的 `build.electronDownload.mirror` 指向
`https://registry.npmmirror.com/-/binary/electron/`。AppImage 工具集已在
`~/.cache/electron-builder/appimage` 落盘；缺 cache 的机器会再次撞网络问题。

---

## 3. 目录结构与职责

```text
linux/
├── electron.vite.config.ts    # 三入口构建（main / preload / renderer）
├── vitest.config.ts           # 只跑 test/，environment: node
├── tsconfig.node.json         # 主进程 / 预加载（无 DOM）；含 core 的 paths 映射
├── tsconfig.web.json          # 渲染进程（DOM + JSX）；含 core 的 paths 映射
├── build/
│   ├── icon.png               # 桌面图标
│   └── udev/90-private-cinema-backlight.rules   # sysfs 背光免密（随包分发）
├── scripts/linux-smoke.sh     # 真机自检：背光 / ddcutil / 产物 / 启动冒烟
├── src/
│   ├── main/
│   │   ├── index.ts           # 窗口、协议注册、IPC 装配、生命周期
│   │   ├── brightness.ts      # 亮度：sysfs（内置屏）+ ddcutil（外接屏）
│   │   ├── library.ts         # 视频扫描与剧集归组
│   │   ├── media-access.ts    # 授权表（只放行用户选过的路径）
│   │   ├── media-protocol.ts  # cinema:// 处理器：授权 + Range + MIME
│   │   ├── progress.ts        # 播放进度 JSON 存储（原子写）
│   │   └── subtitle-file.ts   # 同目录字幕发现
│   ├── preload/index.ts       # 唯一职责：把 IPC 包成 window.cinema
│   └── renderer/
│       ├── index.html
│       └── src/
│           ├── main.tsx / App.tsx / styles.css / env.d.ts
│           ├── danmaku/DanmakuCanvas.tsx   # 弹幕绘制：canvas + rAF
│           ├── player/PlayerScreen.tsx     # 视频 + 字幕 + 弹幕 + 进度 + 亮度面板
│           └── ui/LibraryScreen.tsx
└── test/                      # 4 个文件：library / progress / media-protocol / brightness
```

**进程边界（违反即打回）：**

1. **渲染进程不碰 Node、不碰文件系统**：`contextIsolation: true` + `nodeIntegration: false`
   是安全边界；`sandbox: false` 仅为预加载能 `require('electron')`，其余隔离项不得关闭。
2. **主进程不碰媒体解码**：解码 / 字幕渲染 / 弹幕动画全在渲染进程；主进程只产 URL。
3. **`packages/core` 是三端唯一契约**：本目录没有 `src/shared/`，领域模型与 IPC 通道名
   一律从 `@private-cinema/core/shared` 取。禁止在两端各写字符串字面量（通道名拼错只会静默失败）。
4. **core 是源码包**（`exports` 指向 `.ts`）：
   - `electron.vite.config.ts` 里必须 `externalizeDepsPlugin({ exclude: ['@private-cinema/core'] })`，
     否则会被当成外部依赖 require 而找不到运行时文件；
   - `tsconfig.node.json` / `tsconfig.web.json` 各自的 `paths` 必须同步映射 4 个子路径
     （`/shared` `/danmaku` `/subtitle` `/ui`）。漏一处即 `Cannot find module`。

---

## 4. 本地媒体协议 `cinema://`（与 windows 同源）

- 编码：UTF-8 → base64 → `encodeURIComponent`，`cinema://local/<base64>`，编解码在 `packages/core`。
- 授权表（`src/main/media-access.ts`）：只放行用户在本进程内选过的路径，精确匹配。
- 扩展名白名单 `.mp4 .m4v .mov .mkv .webm .srt .vtt`，`realpath` 后再验一次，并用真实路径读取。
- `registerSchemesAsPrivileged` 必须带 `stream: true`；**手写 Range**（`parseRangeHeader`），
  206 + `Content-Range` + `Accept-Ranges`，416 带 `Content-Range: bytes */<size>` 与
  `Content-Length: 0`。
- **不要「优化」成 `net.fetch(pathToFileURL(...))`**：Chromium file loader 忽略 Range，
  进度条与续播会静默失效（不报错）。这是 windows 端已实测确认的结论，Linux 同源。

Linux 特有注意：路径可能含空格、中文；一律走 `path` 模块与 `realpath`，不要在 URL 里拼裸路径。
`/opt/PrivateCinema/...` 与 AppImage 的 squashfs 挂载点都可能只读 —— 任何写入只落在 `userData`。

---

## 5. 关键设计决策

### 显示器亮度（`src/main/brightness.ts`）

两条后端按「能控制就给范围，不能控制就如实返回原因」合流：

1. **sysfs**（`/sys/class/backlight/*`）：内核背光标准接口，覆盖笔记本内置屏与部分 eDP。
   读 `max_brightness` / `brightness` / `type`；`max_brightness` 是只读刻度上限，
   范围恒为 `0..max`（`intel_backlight` 常见 937、`nvidia_0` 常见 100，**不要假设 100**）。
2. **DDC/CI**（`ddcutil` CLI）：外接屏走 i2c 上的 MCCS 协议，VCP `0x10`。
   `ddcutil detect --brief` 解析 `Display N` 块的 `I2C bus:` 与 `Monitor:`，
   再用 `getvcp 10 --brief --bus <n>` 取 `VCP 10 C <当前> <上限>`。

**为什么 sysfs 先行：** 纯 fs 读写、微秒级、无子进程；ddcutil 每次往返上百毫秒，
只在 sysfs 覆盖不到的外接屏上调用。`brightness` 写入返回即代表硬件已接受。

**写入必须节流（`PlayerScreen.tsx` 的 `flushBrightness`）：** 每台显示器**最多一个写入在途**，
期间只保留最新值，在途结束后补发最后一个。不猜固定间隔，让节奏由硬件真实速度决定。
逐次直发会让 IPC 队列堆积、窗口卡顿（ddcutil 是同步子进程）。不要「简化」成直发。

**权限是用户侧事实，不是代码 bug：**

- sysfs `brightness` 属 root。包内附 `build/udev/90-private-cinema-backlight.rules`，
  安装后 `/sys/class/backlight/*/brightness` 归 `video` 组可写。应用**不会**自己提权，
  检测到 `EACCES` / `EPERM` 时返回可操作的提示文案。
- ddcutil 需要 `/dev/i2c-*` 权限（`i2c` 组）与 `i2c-dev` 模块；deb 包把 `ddcutil` 标为
  `recommends`。未安装 → `未安装 ddcutil，无法控制外接显示器亮度`。

**`primary` 判定是诚实近似：** 无更好依据时用 `type == 'raw'`（多为面板原始寄存器背光）
当内置屏；DDC 侧无法判定主屏，统一 `false`。不要为了「看起来对」硬猜。

**已知环境限制（本机）：** `/sys/class/backlight` 只有 `nvidia_0`，`brightness` 当前用户不可写；
**未安装 ddcutil**。因此亮度端到端调光在本机**未验证**，只能验证到「枚举 + 如实报错」这一层。

### 弹幕 / 字幕 / 进度

三者逻辑在 `packages/core`，本目录只做绘制与落盘宿主，规则沿用 `windows/AGENTS.md` §5：

- 弹幕位置由绝对时间推导、车道按「空闲时刻」占用、seek 后先 `syncAnchor` 再交还实时时间。
- 字幕二分查找，只在命中 cue 变化时 setState。
- 进度原子写（`.tmp` + `rename`），损坏从空表重建，不做旧字段兼容。

### 安全

- Token / 密码严禁写 localStorage、代码常量或日志。
- `setWindowOpenHandler` 一律 deny + 交给系统浏览器。
- AppImage 运行时若报 `chrome-sandbox` 权限错误，属宿主 `kernel.unprivileged_userns_clone`
  或 setuid 位问题；**不要**为此在代码里默认加 `--no-sandbox`（只在冒烟脚本里用）。

---

## 6. 命令

| 场景 | 命令 | 说明 |
|---|---|---|
| 开发（热更新） | `npm run dev` | electron-vite 起主进程 + 渲染 dev server |
| 构建 | `npm run build` | 产物在 `out/`（main / preload / renderer） |
| 类型检查 | `npm run typecheck` | 两个 tsconfig 全量检查，**改完必须跑** |
| 单元测试 | `npm run test` | vitest run，只测纯逻辑（71 条） |
| 打 AppImage + deb | `npm run dist` | 产物在 `release/` |
| 只打解包目录 | `npm run dist:dir` | 产物在 `release/linux-unpacked/` |
| 运行打包产物 | `./release/linux-unpacked/private-cinema` | |
| 真机自检 | `bash scripts/linux-smoke.sh` | 背光 / ddcutil / 产物 / xvfb 启动冒烟，逐项 PASS/FAIL |

`out/`、`node_modules/`、`release/` 不入库。

---

## 7. 变更后验证（分级，不得越级宣称）

1. **静态层**：`npm run typecheck` PASS。改完不跑等于没改。
2. **逻辑层**：`npm run test` 全绿。覆盖库归组、进度往返、协议响应头与授权、亮度纯逻辑
   （刻度换算、`ddcutil` 输出解析、错误文案）。
3. **构建层**：`npm run build` PASS，`out/` 三件齐全。
4. **打包层**：`npm run dist:dir` PASS，`release/linux-unpacked/private-cinema` 可执行、
   `resources/udev/` 随包、`locales/` 只留 `en-US` `zh-CN`。
5. **运行层**：`bash scripts/linux-smoke.sh` 无 FAIL；或真实显示器下启动应用，
   确认窗口渲染出真实 UI（非空白 / 非纯黑）。
6. **端到端层（唯一能宣称「播放可用 / 亮度可调」的层级）**：用真实视频文件走一遍
   `选文件 → 播放 → 字幕 → 弹幕上屏 → 退出重进续播`；在真实显示器上拖动亮度滑块看屏幕变化。
   未做这一层，只能报告「编译 / 单测 / 构建 / 打包通过，播放与亮度未做端到端验证」。

**禁止的表述：**「推测没问题」「应该能播」「单测通过所以播放正常」。
**易碎区**（手势、时间轴、canvas 渲染、Range 请求、ddcutil 节流）必须真机验证。

**CI 现状：** 尚未新增 `linux-build.yml`（与 `windows-build.yml` 同构，待确认 runner 后再补）。
本地无 GUI 会话时用 `xvfb-run -a` 顶替，只能覆盖到「运行层」。

---

## 8. 编码原则（外科手术式改动）

1. **最小代码**：能少写就少写；不为一次性场景引入抽象。
2. **只动必须动的**：不重构未损坏的代码，不顺手改格式。
3. **命名**：变量 / 函数 / 类型英文；注释、日志、界面文案中文。
4. **注释风格**：`// ==================== 分块标题 ====================`，
   关键不变量写「为什么」而非「做了什么」。
5. **类型**：`strict` 全开，`noUnusedLocals` / `noUnusedParameters` / `verbatimModuleSyntax` 开启。
   跨进程类型只从 `@private-cinema/core/shared` 取，禁止在 renderer 里重新定义领域模型。
6. **React**：时间轴走 `useRef`，只有需要显示的 UI 文本才 setState，禁止按帧重渲染。

---

## 9. Git 协作（仅当用户明确指示时）

1. **严禁广度暂存**：禁止 `git add -A` / `git add .`；只 `git add <明确文件路径>`。
2. **禁止破坏性命令**：`git reset --hard`、`git checkout .`、`git clean -fd`、`git stash`、
   `commit --no-verify`、force push。
3. **Commit 规范**：Conventional Commits，中文工程化动词，无 emoji，无 Co-Authored-By 尾注。

   ```text
   type(scope): 简要说明

   - 改动点1
   - 改动点2
   ```

   常用 `type`：`feat` / `fix` / `refactor` / `chore` / `docs` / `perf`。
   常用 `scope`：`player` / `danmaku` / `subtitle` / `library` / `progress` / `ipc` / `brightness` / `build`。

---

## 10. 任务路由速查

| 任务 | 去哪 |
|---|---|
| 改播放器行为（播放 / 暂停 / seek / 全屏 / 换集） | `src/renderer/src/player/PlayerScreen.tsx` |
| 改亮度触发 / 节流 | `src/renderer/src/player/PlayerScreen.tsx`（`flushBrightness`） |
| 改亮度后端（sysfs / ddcutil / 错误文案） | `src/main/brightness.ts` + `test/brightness.test.ts` |
| 改背光权限方案 | `build/udev/90-private-cinema-backlight.rules` + `scripts/linux-smoke.sh` |
| 改本地媒体协议 / Range | `src/main/media-protocol.ts` + `test/media-protocol.test.ts` |
| 改文件访问授权范围 | `src/main/media-access.ts` + `src/main/index.ts` 的授权调用点 |
| 改弹幕引擎 / 字幕解析 / 弹幕设置 | **`packages/core/src/danmaku`** / `packages/core/src/subtitle`（不是本目录） |
| 改弹幕绘制（字体 / 描边 / 清晰度） | `src/renderer/src/danmaku/DanmakuCanvas.tsx` |
| 改扫描与剧集归组 | `src/main/library.ts` |
| 改进度存储 | `src/main/progress.ts` |
| 新增 IPC 能力 | `packages/core/src/shared/ipc.ts`（接口 + 通道名）→ `main/index.ts` 注册 → `preload/index.ts` 包装 |
| 改窗口 / 安全策略 | `src/main/index.ts` |
| 改打包 / 桌面入口 / 依赖清单 | `package.json` 的 `build` 段（先看 §2 天花板） |
| 架构级变更（增删目录 / 模块重组） | **必须同步更新本文件**，并同步 `packages/core` 的边界说明 |

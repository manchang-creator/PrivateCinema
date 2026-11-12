# Linux 客户端 · 交接文档

日期：2026-11-12
基线提交：`13e1180`（Windows MVP 合并）之后的 5 个提交
交接对象：后续接手 Linux 端 / `packages/core` 的代理或开发者

---

## 1. 起点与目标

用户原始要求（2026-11-12）：「参考下这个 windows 的 我要求做一个linux 适配我这个系统的」。

三项已确认的决策（问答工具选择，非推断）：

| 议题 | 选择 |
|---|---|
| 代码组织 | 抽 `packages/core` 公共包 + 独立 `linux/` 壳（不让 Windows/Linux 各写一份） |
| 亮度方案 | sysfs（内置屏）+ ddcutil DDC/CI（外接屏） |
| 范围 | 对齐 Windows 功能 + 可安装包（AppImage / deb + 桌面入口） |

---

## 2. 本次提交（`git log --oneline 13e1180..HEAD`）

```text
2580001 feat(linux): 新增主进程命令行自检
a27db23 docs(repo): 补充 Linux 客户端分工与构建工作流
2f58ea7 feat(linux): 新增 Linux 桌面客户端
86648a9 refactor(windows): 改为引用跨平台内核包
1c21139 refactor(core): 抽取 Windows/Linux 共用的跨平台内核包
```

（另有一次未提交改动：播放器错误提示带 `MediaError` 码，见 §6。）

---

## 3. 落到磁盘的东西

### 3.1 `packages/core`（新增，`@private-cinema/core`）

源码包，`exports` 指向 `.ts`，由使用方参与打包。

| 子路径 | 内容 |
|---|---|
| `/shared` | `types.ts`（领域模型 + IPC 载荷）、`ipc.ts`（通道名常量 + 接口）、`media-url.ts`（`cinema://` 编解码 + `parseRangeHeader`） |
| `/danmaku` | `engine.ts`（车道占用 / 绝对时间推导）、`settings.ts`、`seeder.ts` |
| `/subtitle` | `parser.ts`（SRT / VTT，二分查找 cue） |
| `/ui` | `format.ts`（时长/文件大小格式化） |

测试：`test/` 4 个文件 75 条。`vitest.config.ts` 可直接 `npx vitest run`。

**注意**：`packages/core` 的 `node_modules` 由它的 `package.json` 派生，源文件里没有运行时依赖。
`npm install` 在 npm 10.9.8 下单独跑会报 arborist 的
`Cannot read properties of null (reading 'edgesOut')` —— **这是 npm 的 bug，不是配置问题**。
从 `linux/` 或 `windows/` 目录 `npm install` 走 `file:../packages/core` 就正常；
必须单独装时加 `--legacy-peer-deps`。

### 3.2 `linux/`（新增）

完整目录与职责见 `linux/` 源码，这里只列**非显然**的部分：

- `src/main/brightness.ts` —— 两条后端合流。sysfs 读 `/sys/class/backlight/*/{max_brightness,brightness,type}`；
  ddcutil 用 `detect --brief` + `getvcp 10 --brief --bus N` + `setvcp 10`，`execFile` 超时 8000ms。
  不可用时返回 `available: false` + 中文原因，**不返回假滑块**。
  - 纯逻辑全部导出以便测试：`clampBrightness` / `parseDdcutilDetect` / `parseDdcutilVcp` /
    `describeDdcutilError` / `isPlainBacklightName`（拒绝含 `/`、`\`、`.` 前缀的名字，防路径穿越）。
- `src/renderer/src/player/PlayerScreen.tsx` 的 `flushBrightness` —— **每台显示器最多一个写入在途**，
  期间只留最新值，在途结束后补发最后一个。ddcutil 是同步子进程（单次上百毫秒），逐次直发会卡窗口。
  **不要"简化"成直发。**
- `src/main/index.ts` 的 `--self-check` —— 枚举显示器 + 对可用显示器做一次「读当前值写回原值」往返，
  JSON 打到 stdout。用于无键盘/远程/CI 环境确认主进程与 IPC 路径是通的。
  实现要点：`process.stdout.write(text, () => app.exit(0))`，写完再退，否则管道输出被截断。
- `build/udev/90-private-cinema-backlight.rules` + `build/icon.png` —— 注意根 `.gitignore` 有 `build/`，
  `linux/.gitignore` 用 `!build/` 反向排除，**新加 build/ 下的文件记得确认是否被忽略**。
- `scripts/linux-smoke.sh` —— 5 段检查（环境 / 背光 / ddcutil / 产物 / 启动冒烟 + 自检）。
  判失败的只有真启动失败（`Uncaught Exception` / `Cannot find module` / `ERR_FILE_NOT_FOUND`）；
  SIGTERM 强杀留下的 `FATAL:...Failed to shutdown.` 只算 info。
- `package.json` 的 `build` 段：
  - `electronDownload.mirror = https://registry.npmmirror.com/-/binary/electron/`（本机直连 GitHub 会 TLS 重置）
  - `linux.executableName = private-cinema`、`electronLanguages = [en-US, zh-CN]`（裁剪 locales）
  - `deb.recommends = [ddcutil]`、`extraResources` 带上 udev 规则
  - **`linux.desktopName` 与 `build.toolsets` 是非法字段**，electron-builder 26 会报 schema 错误，不要加回

### 3.3 `windows/`（改造）

删除 `src/shared/`、`danmaku/{engine,settings,seeder}.ts`、`subtitle/`、`ui/format.ts` 及 4 个测试，
全部改从 `@private-cinema/core/*` 引用。配套改动：

- `electron.vite.config.ts`：`externalizeDepsPlugin({ exclude: ['@private-cinema/core'] })`
- `tsconfig.node.json` / `tsconfig.web.json`：各 4 条 `paths` 映射
- `.github/workflows/windows-build.yml`：触发路径加 `packages/core/**`

### 3.4 CI / 文档

- 新增 `.github/workflows/linux-build.yml`（ubuntu-latest，Node 20.19.0）：
  `npm ci`（`ELECTRON_SKIP_BINARY_DOWNLOAD=1`）→ typecheck → test → build → 校验 out 三产物 →
  `dist:dir` → 校验可执行文件 / udev 规则 / `asar list` 里有 `/out/main/index.js`。
- `README.md` 增加三处分工与桌面端章节。

---

## 4. 本次真实执行过的验证

| 项 | 结果 |
|---|---|
| `windows/npm run typecheck` | PASS |
| `windows/npx vitest run` | 66 passed |
| `windows/electron-vite build` | PASS |
| `linux/npm run typecheck` | PASS |
| `linux/npx vitest run` | 71 passed |
| `packages/core` vitest | 75 passed |
| `linux/electron-vite build` | PASS |
| `linux/electron-builder --linux --dir` | PASS（`release/linux-unpacked/private-cinema`，整包 250M） |
| locales 裁剪 | `release/linux-unpacked/locales/` 只有 `en-US.pak` `zh-CN.pak` |
| udev 规则随包 | `release/linux-unpacked/resources/udev/90-private-cinema-backlight.rules` 存在 |
| asar 内含主进程 | `/out/main/index.js` 存在 |
| `--self-check`（打包二进制） | exit 0，正确列出 `sysfs:nvidia_0`（current=100 max=100 primary=true） |
| `bash scripts/linux-smoke.sh` | 背光不可写 1 项 FAIL（预期，需 sudo 装 udev 规则）；其余 PASS |
| X11 真实 DISPLAY 启动 | 进程存活，无启动失败日志 |

**没有验证、也不能宣称的**：

- 真实视频端到端播放（选文件 → 播放 → 字幕 → 弹幕上屏 → 退出重进续播）。
- 亮度真实调光（本机背光节点当前用户不可写；未安装 ddcutil；无 sudo 权限）。
- AppImage / deb 文件产出（见 §5）。

---

## 5. 已知阻塞（按优先级）

1. **AppImage / deb 出不来**：electron-builder 打完 `linux-unpacked` 后要去 GitHub release-assets 下载
   AppImage 工具集，本机 TLS 被重置：
   `Client network socket disconnected before secure TLS connection was established`。
   cache `~/.cache/electron-builder/appimage/appimage-12.0.1/` 不完整（约 5.5M），`fpm` 缺失。
   → 在完整网络环境或预置 cache 的机器上 `npm run dist` 即可产出，代码侧无需改动。
2. **亮度不可端到端验证**：需要 `sudo cp linux/build/udev/90-private-cinema-backlight.rules
   /usr/lib/udev/rules.d/ && sudo udevadm control --reload-rules && sudo udevadm trigger
   --action=change --subsystem-match=backlight`；外接屏需 `sudo apt install ddcutil` +
   用户加入 `i2c` 组。**未获得 sudo 授权，未执行。**
3. **`electron out/main/index.js` 直跑会挂住**：本机 X11 下连空脚本都挂，与自检代码无关。
   一律用 electron-builder 产出的二进制做自检。
4. **Chromium 直连不支持 MKV**：与 Windows 端同源限制，播放会报
   `MEDIA_ERR_SRC_NOT_SUPPORTED`（现已把错误码显示到界面）。要支持需引入 WebCodecs 自解码或外部播放器，
   属独立议题，未做。

---

## 6. 交接时的未提交改动

`linux/src/renderer/src/player/PlayerScreen.tsx` 的 `onError`：把 `<video>` 的 `MediaError.code`
映射成中文原因（不支持 / 解码失败 / 读取中断）并显示错误码，替换原来只有片名的提示。
`typecheck` 已通过，**未重新打包、未在界面上触发过**（需要真实不可播放文件才能触发）。

---

## 7. 建议的下一步

1. 拿到 sudo 后装 udev 规则与 ddcutil，跑 `bash linux/scripts/linux-smoke.sh`，应全绿；
   然后真实拖一次亮度滑块确认视觉变化。
2. 放一个 mp4（+ 同名 srt）到本地，走一遍完整播放链路，确认字幕与弹幕上屏、退出重进能续播时点。
3. 网络可用时 `npm run dist` 产出 AppImage 与 deb，装一次 `sudo dpkg -i` 验证桌面入口与 udev 规则安装。
4. 若要支持 MKV，先设计 WebCodecs 解码路径，不要在 `media-protocol` 里打补丁。

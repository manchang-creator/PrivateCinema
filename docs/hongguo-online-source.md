# 在线片源接入 · 红果短剧（openhongguo）

日期：2026-11-12
范围：桌面端（`linux/` + `windows/`）在「在线片库」里新增第二个片源「红果短剧」，
底层用社区非官方 SDK [`openhongguo`](https://github.com/beilunyang/openhongguo)（Go 编译的 WebAssembly）。

## 1. 做了什么

在既有「在线片库」页签里，把在线片源从「只有看剧AI」扩展成「看剧AI / 红果短剧」可切换：

- 首页聚合：推荐频道 + 热搜榜 / 预约榜（能取到就展示）
- 搜索短剧 / 漫剧
- 作品详情（标题、简介、分类标签、年份、集数、演员）
- 选集（红果一部剧可达数百集，服务端通常一页返回全部）
- 播放：主进程 `resolvePlayback` 拿流+密钥 → 用系统 **ffmpeg 解密 + 转码**成 H.264 → 本地缓存 → 播放器播放

片源自适应：看剧AI 保留「电影 / 电视剧 / 动漫 / 综艺」分类；红果只保留「推荐」流（短剧/漫剧）。

## 2. 关键背景：上游播放修复（npm 上还没发）

- `openhongguo` 的 v0.2.0 之前靠「匿名设备只回一次播放模型 + 自动换设备」凑合。
- **2026-11-10 起**服务端在播放接口 `/novel/player/video_model/v1/` 上开始校验
  `x-argus` / `x-ladon`，0.2.0 这两个头只是占位 → 任何新匿名设备都返回空
  （`ANONYMOUS_LIMITED`）。见上游 issue #6。
- 社区 PR [#7](https://github.com/beilunyang/openhongguo/pull/7) 实现了真正的
  Argus 551 + Ladon 签名，作者已合并（`4bc88830`，2026-11-11）。
- **但 npm 上最新仍是 0.2.0**（GitHub Releases 也只到 v0.2.0），修复未发版。

因此本仓库做了**本地补丁**：`vendor/openhongguo/` 放了一份用本机 Go 从上游 `main`
（`015a388`，含 PR #7）重新编译的 `openhongguo.wasm` + `wasm_exec.js`；
`scripts/patch-openhongguo.mjs` 在两个客户端的 `postinstall` 里把它覆盖进
`node_modules/openhongguo/dist/`。上游发布修复版后，删掉 `vendor/` 与 postinstall 直接升级即可。

## 3. 播放链路与解密

```
discover / search          列表（游标分页，SeriesSummary）
  → getSeries(id)          详情
  → listEpisodes(id)       分集（每集 id）
  → resolvePlayback(id)    各清晰度 stream + contentKey（红果为 CENC 加密）
      ├─ 未加密：直接返回 http 直链
      └─ 加密（常态，cenc-aes-ctr + HEVC/bytevc1）：
           ffmpeg -decryption_key <contentKey.key> -i <url> \
                  -c:v libx264 -crf 26 -maxrate 1400k -c:a aac \
                  -movflags +faststart  <cacheDir>/<hash>.mp4
           再经 cinema:// 本地协议交给 <video>
```

- **为什么转码**：红果是 `bytevc1`（HEVC），Chromium 的 `<video>` 不保证能解，所以解密后统一转 H.264/AAC。
- **缓存**：缓存键 =「分集 id + 清晰度」，同一集同一清晰度只解密一次（实测二次播放 0.3s）。
- **默认清晰度**：优先 480p（兼顾转码耗时与画质），播放页可切 360/540/720/1080（切换会重新解密该清晰度）。
- **首次延迟**：一集 5 分钟的短剧，480p 解密+转码约 30s（ultrafast），期间播放页显示「线路解析中…」。
- **缓存目录**：`<userData>/hongguo-cache/`（主进程 `configureHongguo` 注入）。
- **依赖**：需要系统装有 **ffmpeg**（在 PATH，或 `FFMPEG_PATH` 指定）。找不到会给出明确中文提示。

> 适配器把上游错误码翻译为中文：`ANONYMOUS_LIMITED` → 额度用尽、`AUTHENTICATION_REQUIRED` → 需登录、`RATE_LIMITED` → 限流等。

## 4. 改动清单

| 文件 | 说明 |
|---|---|
| `packages/core/src/shared/types.ts` | `MediaSourceId` 增加 `'hongguo'` |
| `packages/core/src/shared/ipc.ts` | 新增 `RemoteProviderId` / `RemoteProviderInfo` / `REMOTE_PROVIDERS`；`CinemaApi.remote*` 增加 `provider` 首参 |
| `windows/src/main/hongguo.ts`、`linux/src/main/hongguo.ts` | 红果适配器：首页/搜索/详情/选集 + ffmpeg 解密转码（新增） |
| `windows/src/main/index.ts`、`linux/src/main/index.ts` | `remote:*` 按 `provider` 路由；`hongguoResolve` 注入 `serveLocal`（授权 + `cinema://`）；启动时 `configureHongguo` |
| `windows/src/preload/index.ts`、`linux/src/preload/index.ts` | `remote*` 透传 `provider` |
| `.../ui/OnlineLibrary.tsx` | 顶部片源切换；分类页签按片源区分；海报 `onError` 回退（红果封面多为 HEIC） |
| `.../player/PlayerScreen.tsx` | `remoteResolve` 传入来源 provider |
| `.../styles.css` | 在线片源切换胶囊样式 |
| `vendor/openhongguo/` + `scripts/patch-openhongguo.mjs` | 修复版 wasm 及 postinstall 覆盖脚本（新增） |
| `windows/package.json`、`linux/package.json` | 依赖 `openhongguo@^0.2.0`；`postinstall` 打补丁 |

## 5. 验证（真实执行）

| 项 | 结果 |
|---|---|
| `packages/core` typecheck / 75 tests | PASS |
| `windows` typecheck（node + web）/ build / 66 tests | PASS |
| `linux` typecheck（node + web）/ build / 75 tests | PASS |
| 修复版 wasm：`resolvePlayback` | 返回 5 路流 + `contentKey`（0.2.0 原版为 `ANONYMOUS_LIMITED`） |
| 端到端：`hongguoResolve`（真实集） | 首次 33s 产出 `/…/xx.mp4`，`ffprobe` = h264 + aac，时长 303s，约 57MB |
| 缓存命中 | 二次解析 0.29s，命中同一文件 |
| 元数据：home/detail/episodes/search | 分区、类型/年份/标签、200~800 集、游标翻页均正常 |

## 6. 使用

1. 顶部进入「在线片库」，切到「红果短剧」。
2. 用「推荐 / 热搜榜」或搜索框找剧，点卡片看详情与选集。
3. 点任意一集进入播放；首次该集需要解密转码（约 20–40s），之后同集秒开。
4. 播放页可切换清晰度线路。

## 7. 说明与边界

- 请求全部经主进程发出；解密密钥与匿名设备档案不出主进程。
- 解密产物缓存在 `userData/hongguo-cache/`，是明文 H.264 文件，自行注意清理与磁盘占用。
- 内容版权归原权利人所有；本项目仅作个人本地播放与技术研究，请勿用于商业用途或大规模抓取。
- 红果接口未公开、随版本变化；上游发修复版后建议移除本地 wasm 补丁，直接升级依赖。

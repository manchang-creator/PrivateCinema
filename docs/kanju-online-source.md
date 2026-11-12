# 在线片源接入 · 看剧AI（kanju1.com）

日期：2026-11-12
范围：桌面端（`linux/` + `windows/`）新增「在线片库」媒体源，数据来自 `https://kanju1.com/`。

## 1. 做了什么

桌面客户端原先只支持本地文件。本次把 `kanju1.com`（看剧AI）作为一个在线媒体源接进来：

- 首页聚合（大家都在看 / 韩剧在追 / … 共 6 个分区）
- 分类浏览（电影 / 电视剧 / 动漫 / 综艺）与关键词搜索
- 作品详情（海报、简介、演员、类型、集数）
- 选集并在线播放（自动选线路，可手动切换线路）
- 本地片库与在线片库通过顶部页签切换，互不影响

截图：`docs/kanju-online-home.png`、`docs/kanju-detail.png`、`docs/kanju-player.png`。

## 2. 关键点：请求签名

该站所有 `/v1/*` 内容接口都要求 HMAC 签名，直接 `curl` 会返回
`401 invalid_request_signature`。签名逻辑在 `packages/core` 之外的主进程实现：

```
message   = `${METHOD}\n${path?query}\n${timestamp}\n${nonce}`
signature = HMAC_SHA256(SECRET, message)  # hex
```

请求头：`x-ai-movie-timestamp` / `x-ai-movie-nonce` / `x-ai-movie-signature`
以及固定的客户端标识头（client-name / version / build-version / protocol-version / site-host）。

> 密钥与客户端标识常量集中在 `linux/src/main/kanju.ts`（Windows 同文件）。
> **只在主进程使用，绝不下发渲染进程**；渲染进程通过 IPC 只拿到归一化后的领域数据。

## 3. 播放解析链路

```
GET  /v1/catalog/{id}                 作品详情
GET  /v1/catalog/{id}/episodes        选集（每集带 token）
GET  /v1/playback/resolve/{token}     取线路 line_options
  ├─ 线路 url 以 http 开头        → 直接可播（多为 m3u8 外链）
  └─ 线路 url 为 resolve://<ticket> → POST /v1/playback/resolve-line {ticket} 换取真实直链（多为 mp4）
```

解析策略（`kanjuResolve`）：优先返回 **mp4** 直链（Chromium 原生可播），
全部为 HLS 时回退首个可解析结果。地址带时效签名，过期由播放器按集 token 重新解析。

播放器（`PlayerScreen`）：
- mp4 直接喂 `<video src>`；
- HLS（m3u8）走 `hls.js`（MSE）播放；
- 线路 > 1 时显示「自动线路」下拉，可手动切换。

## 4. 改动清单

| 文件 | 说明 |
|---|---|
| `packages/core/src/shared/types.ts` | `MediaItem` / `Episode` 增加 `source` / `posterUrl` / `remarks` / `episodeCount` / `episodeToken` |
| `packages/core/src/shared/ipc.ts` | 新增 `RemoteCard/Section/HomeData/BrowsePage/Detail/Episode/Line/Playback` 类型、`CinemaApi` 远端方法与 `IPC.remote*` 通道 |
| `linux/src/main/kanju.ts`、`windows/src/main/kanju.ts` | 签名客户端 + 首页/搜索/详情/选集/解析（新增） |
| `linux/src/main/index.ts`、`windows/src/main/index.ts` | 注册 `remote:*` IPC；Linux `--self-check` 增加 `remote` 连通性探针 |
| `linux/src/preload/index.ts`、`windows/src/preload/index.ts` | 暴露 `remote*` 方法 |
| `linux/src/renderer/src/ui/OnlineLibrary.tsx`、`windows/...` | 在线片库 UI（新增） |
| `.../ui/LibraryScreen.tsx` | 本地 / 在线页签切换 |
| `.../App.tsx` | `handlePlay` 支持传入远端 playlist |
| `.../player/PlayerScreen.tsx` | 远端按 token 解析、HLS、线路选择 |
| `.../styles.css` | 在线片库 / 详情弹层 / 线路选择样式 |
| `linux/package.json`、`windows/package.json` | 新增依赖 `hls.js@^1.7.4` |

## 5. 验证（真实执行）

| 项 | 结果 |
|---|---|
| `packages/core` typecheck / 75 tests | PASS |
| `linux` typecheck / build / 71 tests | PASS |
| `windows` typecheck / build | PASS |
| 打包二进制 `--self-check`（xvfb） | `remote.ok=true`，6 个分区，样例「谷雨」 |
| CDP 驱动：切在线页签 | 6 个分区、72 张卡片渲染 |
| CDP 驱动：打开详情 | 标题/简介/演员/16 集选集全部渲染 |
| CDP 驱动：点第 1 集播放 | `<video>` `readyState=4`、`duration=2725s`、`error=null`、正在播放 |

## 6. 使用

1. 启动桌面客户端，顶部点「在线片库」。
2. 用「推荐 / 电影 / 电视剧 / 动漫 / 综艺」或搜索框找片。
3. 点卡片打开详情 → 点任意一集开始播放；播放条左侧可切换「自动线路 / 指定线路」。

## 7. 说明

- 在线请求全部经主进程发出，不受渲染进程同源策略影响；封面图与播放流为跨域直连（`<img>` / `<video>` 无需 CORS）。
- 站点为聚合前端，部分老片只有 m3u8 外链，已由 `hls.js` 兜底；个别源站失效属外部因素，可在播放器切线路重试。

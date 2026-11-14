# 更新镜像（国内可达的自建更新源）

日期：2026-11-15

## 1. 为什么要有它

更新清单默认在 GitHub：

```
https://github.com/manchang-creator/PrivateCinema/releases/latest/download/update-windows-amd64.json
```

这个地址会 302 跳到 `release-assets.githubusercontent.com`，国内网络常在首跳被 RST，客户端读 body 时
得到 `EOF`（见 [mygo 重构文档 §24](2026-11-13-mygo-refactor.md)）。偶发抖动靠重试能救，整段被封救不回来。

镜像把「送文件」这一步挪到国内可达的静态托管上。

## 2. 安全模型（重要）

**镜像不需要可信。** 签名校验始终在应用内部用编译进去的 ed25519 公钥完成：

- 清单里的 `signature` 是归档 SHA-256 的签名（`mygo build` 用 `MYGO_UPDATER_PRIVATE_KEY` 签）；
- `mygo` 下载归档后先算 SHA-256 再验签，验不过直接拒绝安装。

所以镜像被投毒、被替换清单、被中间人改写 —— 客户端都不会装上坏东西，最坏情况是「更新失败」。
客户端额外做的两件事：

1. 清单必须含 `version / url / size / signature`，否则拒用（`mirrorSource.Manifest`）；
2. 如果清单带了可选 `sha256` 字段（`update-mirror -hash` 会写入），归档下载后再比对一次。

## 3. 静态目录结构

镜像按 target 分目录，文件名与 GitHub 上的**保持一致**（清单里的 URL 会被客户端改写成这个布局）：

```
https://<MIRROR>/
├── windows-amd64/
│   ├── update-windows-amd64.json                 ← 镜像清单（改造过的）
│   ├── private-cinema-0.1.10-windows-amd64.tar.gz
│   └── private-cinema-0.1.9-to-0.1.10-windows-amd64.delta
└── linux-amd64/
    ├── update-linux-amd64.json
    └── private-cinema-0.1.10-linux-amd64.tar.gz
```

> 注意：GitHub Release 会给带空格的文件名做替换；mygo 产出的名字本身没有空格，直接同名上传即可。

## 4. 发布流程

```bash
cd desktop

# ① 构建（同现有流程，产出 build/<target>/update-<target>.json 与归档）
MYGO_UPDATER_PRIVATE_KEY=... go run github.com/egoist/mygo/cmd/mygo@v0.9.0 build -platform windows/amd64,linux/amd64

# ② 生成镜像清单（把 url 改成镜像地址）
for t in windows-amd64 linux-amd64; do
  go run ./cmd/update-mirror \
    -in "build/$t/update-$t.json" \
    -out "dist-mirror/$t/update-$t.json" \
    -base https://dl.example.com/private-cinema \
    -target "$t" \
    -hash          # 可选：下载归档、校验大小并写入 sha256（镜像先上传归档再加此项）
done

# ③ 上传：把 build/<target>/ 下的归档与 delta，连同 dist-mirror/<target>/update-*.json
#    一起放到镜像的 <target>/ 目录下（保持文件名）
```

`update-mirror` 会拒绝对不上的组合，例如把 windows 归档塞进 `linux-amd64/`：

```
update-mirror: 归档 "private-cinema-0.1.9-windows-amd64.tar.gz" 与 target "linux-amd64" 不匹配
```

## 5. 客户端启用

环境变量（任一）：

| 变量 | 说明 |
|---|---|
| `PRIVATE_CINEMA_UPDATE_MIRROR` | 镜像根地址，必须 https（`127.0.0.1`/`localhost` 允许 http 便于联调） |
| `UPDATER_MIRROR_URL` | 兼容用别名，CI 里可以一个变量统一设置 |
| `PRIVATE_CINEMA_MIRROR_STRICT=1` | 关闭「镜像失败回落 GitHub」的行为 |

行为：

- 未配置 → 与以前完全一致（走 mygo 自带的 GitHub feed）；
- 配置了 → 启动时装上 `mirrorSource`（`mygo.Updater.SetSource`），检查更新优先走镜像；
- 镜像失败且未 strict → 自动回落到 GitHub feed 再试一次（结果写 `<userData>/update.log`）；
- 设置页「关于 → 更新源」显示当前用的是镜像还是已回落，并给出镜像地址/版本/失败原因。

## 6. 代码位置

| 文件 | 作用 |
|---|---|
| [desktop/update_mirror.go](desktop/update_mirror.go) | `mirrorSource`（实现 `mygo.UpdateSource`）、清单校验与 URL 改写、镜像探测与状态 |
| [desktop/update.go](desktop/update.go) | `checkOnce` 里的镜像 → GitHub 回落；重试与 `update.log` |
| [desktop/cmd/update-mirror/main.go](desktop/cmd/update-mirror/main.go) | 发布期工具：把正式清单改造成镜像清单（可选算 sha256） |
| [desktop/src/ui/SettingsPage.tsx](desktop/src/ui/SettingsPage.tsx) | 设置页「更新源」状态行 |

## 7. 测试覆盖

- `update_mirror_test.go`：地址校验（拒非 https、允许回环）、URL 布局、清单字段缺失拒用、HTTP 状态透出、
  回环严格模式开关、`UpdateMirrorStatus` 零值；
- `update_mirror_e2e_test.go`：用线上清单的结构快照摆成本地镜像目录，`mirrorSource` 读取后
  校验「URL 改写到镜像 / 关键字段未被破坏 / 归档可取回」；
- `update_test.go`：重试退避、`ErrUpdatesDisabled` 不重试、context 取消立即返回、日志格式、
  以及本地 flaky 服务器（前两次掐连接、第三次成功）的复现用例。

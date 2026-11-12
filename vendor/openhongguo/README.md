# openhongguo 修复版 wasm（本地补丁）

npm 上最新的 `openhongguo` 仍是 **0.2.0**，其播放接口在新版服务端会返回空
（`ANONYMOUS_LIMITED`）—— 因为 2026-11-10 起服务端开始在播放接口校验 `x-argus`/`x-ladon`，
而 0.2.0 这两个签名头只是占位。

上游已合并修复 [PR #7](https://github.com/beilunyang/openhongguo/pull/7)（commit `4bed145` / 合并提交 `4bc88830`），
但**尚未发布到 npm**。这里放的是本机用 Go 1.26 从上游 `main`（`015a388`，含 PR #7 / #8）
重新编译出的 `dist/openhongguo.wasm` 与配套 `wasm_exec.js`。

`scripts/patch-openhongguo.mjs` 会在 `npm install` 后（postinstall）把这两个文件覆盖进
`node_modules/openhongguo/dist/`，从而让 `openhongguo@0.2.0` 具备修复后的播放能力。

上游发布修复版（如 v0.2.1）后，可删除本目录与 postinstall，直接升级依赖。

重新编译方式（本机需 Go 1.22+）：
```
git clone https://github.com/beilunyang/openhongguo && cd openhongguo
GOOS=js GOARCH=wasm GOFLAGS=-buildvcs=false go build -trimpath -ldflags="-s -w" \
  -o bindings/node/dist/openhongguo.wasm ./bindings/node/wasm
cp "$(go env GOROOT)/lib/wasm/wasm_exec.js" bindings/node/dist/wasm_exec.js
```

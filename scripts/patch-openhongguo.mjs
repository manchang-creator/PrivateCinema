// 把 vendor/openhongguo 下的修复版 wasm 覆盖进 node_modules/openhongguo/dist。
// 背景见 vendor/openhongguo/README.md：npm 上的 0.2.0 播放接口已被上游服务端判空，
// 修复只合并在 main、尚未发 npm 版。这里在 postinstall 时打补丁，保证 npm install 后仍然可用。
import { copyFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const vendor = join(here, '..', 'vendor', 'openhongguo')
const target = join(process.cwd(), 'node_modules', 'openhongguo', 'dist')

if (!existsSync(target)) {
  console.log('[patch-openhongguo] 未找到 node_modules/openhongguo，跳过')
  process.exit(0)
}

for (const file of ['openhongguo.wasm', 'wasm_exec.js']) {
  const source = join(vendor, file)
  if (!existsSync(source)) {
    console.error(`[patch-openhongguo] 缺少 vendor 文件：${source}`)
    process.exit(1)
  }
  copyFileSync(source, join(target, file))
}
console.log('[patch-openhongguo] 已覆盖为修复版 openhongguo wasm')

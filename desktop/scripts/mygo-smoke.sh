#!/usr/bin/env bash
# 私人影院桌面端 · mygo 冒烟测试
# 构建(e2e) → 启动真实应用 → 用 mygo-automation 驱动/断言 → 截图 → 清理
#
# 用法:
#   bash desktop/scripts/mygo-smoke.sh
#
# 环境变量:
#   SMOKE_SKIP_WEB=1    跳过前端构建，直接用现有 dist/
#   SMOKE_OUT=<path>    截图输出路径（默认 docs/mygo-smoke.png）
#   SMOKE_TIMEOUT=<sec> 等待套接字就绪的秒数（默认 30）
#   SMOKE_GOTOOLCHAIN=auto  go 工具链策略（默认 auto，自动拉取 go>=1.27.3）
#   SMOKE_KEEP=1        结束后保留截图并打印应用日志尾部
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # -> desktop/
REPO="$(cd "$ROOT/.." && pwd)"
OUT="${SMOKE_OUT:-$REPO/docs/mygo-smoke.png}"
WAIT="${SMOKE_TIMEOUT:-30}"
SESSION="smoke-$$"
TMP="$(mktemp -d)"
SOCK="$TMP/app.sock"
BIN="$TMP/app"
APP_PID=""

log()  { printf '\033[36m[smoke]\033[0m %s\n' "$*"; }
ok()   { printf '\033[32m[ ok ]\033[0m %s\n' "$*"; }
fail() { printf '\033[31m[FAIL]\033[0m %s\n' "$*" >&2; exit 1; }

cleanup() {
  set +e
  mygo-automation close --session "$SESSION" >/dev/null 2>&1
  if [ -n "$APP_PID" ]; then kill "$APP_PID" >/dev/null 2>&1; wait "$APP_PID" 2>/dev/null; fi
  if [ "${SMOKE_KEEP:-0}" = "1" ] && [ -f "$TMP/app.log" ]; then
    printf '\033[90m---- app.log ----\033[0m\n'; tail -20 "$TMP/app.log"
  fi
  rm -rf "$TMP"
}
trap cleanup EXIT

need() { command -v "$1" >/dev/null 2>&1 || fail "缺少命令: $1"; }

# ---- 前置检查 -------------------------------------------------------------
need mygo-automation
need go
mygo-automation version >/dev/null 2>&1 || fail "mygo-automation 不可用（go install github.com/egoist/mygo/plugins/automation/cmd/mygo-automation）"
[ -n "${DISPLAY:-}" ] || fail "没有 DISPLAY，开不了窗口；请在桌面会话（X11/Wayland）里运行"

cd "$ROOT"

# ---- 构建 -----------------------------------------------------------------
if [ "${SMOKE_SKIP_WEB:-0}" != "1" ]; then
  need bun
  log "构建前端 (bun run build:web)"
  bun run build:web >/dev/null || fail "前端构建/类型检查失败"
fi
[ -d dist ] || fail "缺少 dist/，先构建前端"
[ -f automation_e2e.go ] || fail "缺少 automation_e2e.go（e2e 开启文件）"

log "编译 Go 后端 (go build -tags e2e)"
GOTOOLCHAIN="${SMOKE_GOTOOLCHAIN:-auto}" GOFLAGS="${GOFLAGS:--buildvcs=false}" \
  go build -tags e2e -o "$BIN" . || fail "go build 失败"

# ---- 启动 -----------------------------------------------------------------
log "启动应用 (socket=$SOCK)"
MYGO_FRONTEND_DIST="$ROOT/dist" MYGO_AUTOMATION="$SOCK" DISPLAY="$DISPLAY" \
  "$BIN" >"$TMP/app.log" 2>&1 &
APP_PID=$!

for _ in $(seq 1 "$WAIT"); do
  [ -S "$SOCK" ] && break
  kill -0 "$APP_PID" 2>/dev/null || fail "应用启动即退出，日志：
$(cat "$TMP/app.log")"
  sleep 1
done
[ -S "$SOCK" ] || fail "等待套接字超时（${WAIT}s）"
ok "应用已启动"

# ---- 驱动 -----------------------------------------------------------------
A() { mygo-automation "$@" --session "$SESSION"; }

A open --socket "$SOCK" >/dev/null || fail "open 失败"
WIN="$(A windows | head -1)"
case "$WIN" in
  *page*) ok "窗口: $WIN" ;;
  *) fail "未找到网页窗口: $WIN" ;;
esac

eq()  { [ "$2" = "$3" ] || fail "$1: 期望 [$3] 实际 [$2]"; ok "$1 = $3"; }
has() { printf '%s' "$2" | grep -q -- "$1" || fail "页面缺少文案: $1"; ok "包含文案: $1"; }

eq "document.title" "$(A eval 'document.title')" "PrivateCinema"

BODY="$(A eval 'document.body.innerText')"
has "本地片库" "$BODY"
has "在线片库" "$BODY"

# 切到「在线片库」，校验两个片源分区出现
A eval "(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.innerText.trim()==='在线片库');if(!b)return false;b.click();return true;})()" \
  | grep -q true || fail "未找到「在线片库」标签"
A wait --settle --timeout 8s >/dev/null 2>&1 || true
BODY2="$(A eval 'document.body.innerText')"
has "看剧AI" "$BODY2"
has "红果短剧" "$BODY2"

# 切回「本地片库」
A eval "(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.innerText.trim()==='本地片库');if(b)b.click();return true;})()" >/dev/null
A wait --settle --timeout 5s >/dev/null 2>&1 || true

# ---- 截图 -----------------------------------------------------------------
mkdir -p "$(dirname "$OUT")"
A screenshot "$OUT" >/dev/null || fail "截图失败"
[ -s "$OUT" ] || fail "截图文件为空: $OUT"
ok "截图: $OUT ($(wc -c <"$OUT") bytes)"

printf '\033[32m[PASS]\033[0m 冒烟测试通过\n'

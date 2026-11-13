#!/usr/bin/env bash
# 私人影院桌面端 · 本地文件 GUI 端到端测试
# 生成(65s mp4 + 同名 srt) → 启动真实应用 → 通过 e2e 播种通道注入片库 →
# 端到端驱动：选片 → 播放(解码/时长) → 字幕叠加 → 弹幕层 → 退出续播(进度落盘/恢复) → 截图 → 清理。
#
# 说明：原生 GTK 文件对话框无法自动化，本脚本用 e2e 构建才编入的
# `Cinema.SeedPaths` 测试通道绕过对话框；其余全部走真实生产代码路径。
#
# 用法:  bash desktop/scripts/local-e2e.sh
# 环境变量:
#   E2E_SKIP_WEB=1     跳过前端构建，直接用现有 dist/
#   E2E_OUT_DIR=<dir>  截图输出目录（默认 docs/local-e2e/）
#   E2E_TIMEOUT=<sec>  等待应用套接字就绪秒数（默认 30）
#   E2E_KEEP=1         保留并打印应用日志尾部
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # -> desktop/
REPO="$(cd "$ROOT/.." && pwd)"
OUT_DIR="${E2E_OUT_DIR:-$REPO/docs/local-e2e}"
WAIT="${E2E_TIMEOUT:-30}"
SESSION="local-e2e-$$"
TMP="$(mktemp -d)"
SOCK="$TMP/app.sock"
BIN="$TMP/app"
FIX="$TMP/fixture"
APP_PID=""

log()  { printf '\033[36m[e2e]\033[0m %s\n' "$*"; }
ok()   { printf '\033[32m[ ok ]\033[0m %s\n' "$*"; }
fail() { printf '\033[31m[FAIL]\033[0m %s\n' "$*" >&2; exit 1; }

cleanup() {
  set +e
  mygo-automation close --session "$SESSION" >/dev/null 2>&1
  if [ -n "$APP_PID" ]; then kill "$APP_PID" >/dev/null 2>&1; wait "$APP_PID" 2>/dev/null; fi
  if [ "${E2E_KEEP:-0}" = "1" ] && [ -f "$TMP/app.log" ]; then
    printf '\033[90m---- app.log ----\033[0m\n'; tail -30 "$TMP/app.log"
  fi
  rm -rf "$TMP"
}
trap cleanup EXIT

need() { command -v "$1" >/dev/null 2>&1 || fail "缺少命令: $1"; }

# ---- 前置检查 -------------------------------------------------------------
need mygo-automation
need go
need ffmpeg
mygo-automation version >/dev/null 2>&1 || fail "mygo-automation 不可用"
[ -n "${DISPLAY:-}" ] || fail "没有 DISPLAY，开不了窗口；请在桌面会话里运行"

cd "$ROOT"

# ---- 构建 -----------------------------------------------------------------
if [ "${E2E_SKIP_WEB:-0}" != "1" ]; then
  need bun
  log "构建前端 (bun run build:web)"
  bun run build:web >/dev/null || fail "前端构建/类型检查失败"
fi
[ -d dist ] || fail "缺少 dist/，先构建前端"
[ -f automation_seed.go ] || fail "缺少 automation_seed.go（e2e 播种通道）"

log "编译 Go 后端 (go build -tags e2e)"
GOTOOLCHAIN="${E2E_GOTOOLCHAIN:-auto}" GOFLAGS="${GOFLAGS:--buildvcs=false}" \
  go build -tags e2e -o "$BIN" . || fail "go build 失败"

# ---- 生成测试素材 ---------------------------------------------------------
log "生成测试素材 (65s mp4 + 同名 srt)"
mkdir -p "$FIX"
MP4="$FIX/E2E 演示片 (2025).mp4"
SRT="$FIX/E2E 演示片 (2025).srt"
ffmpeg -hide_banner -loglevel error -y \
  -f lavfi -i "testsrc2=size=320x240:rate=10:duration=65" \
  -f lavfi -i "sine=frequency=440:duration=65" \
  -c:v libx264 -pix_fmt yuv420p -preset ultrafast -crf 35 \
  -c:a aac -b:a 32k -shortest -movflags +faststart "$MP4" || fail "生成 mp4 失败"
cat > "$SRT" <<'EOF'
1
00:00:01,000 --> 00:00:08,000
E2E 字幕校验行：私人影院端到端

2
00:00:30,000 --> 00:00:38,000
第二段字幕用于续播校验
EOF
[ -s "$MP4" ] || fail "mp4 为空"

# ---- 启动（隔离 userData，避免污染真实进度） ------------------------------
log "启动应用 (socket=$SOCK)"
MYGO_FRONTEND_DIST="$ROOT/dist" MYGO_AUTOMATION="$SOCK" DISPLAY="$DISPLAY" \
  XDG_DATA_HOME="$TMP/xdg-data" XDG_CONFIG_HOME="$TMP/xdg-config" \
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

# ---- 自动化封装 -----------------------------------------------------------
A()  { mygo-automation "$@" --session "$SESSION"; }
js() { A eval "$1"; }
# 轮询直到表达式返回的数值满足条件；$1 表达式 $2 比较符(gt/ge) $3 阈值 $4 说明
poll_num() {
  local expr="$1" op="$2" thr="$3" msg="$4" val
  for _ in $(seq 1 40); do
    val="$(js "$expr" 2>/dev/null | tr -dc '0-9.' || true)"
    if [ -n "$val" ] && awk "BEGIN{exit !($val $([ "$op" = gt ] && echo '>' || echo '>=') $thr)}"; then
      ok "$msg = $val"; return 0
    fi
    sleep 0.3
  done
  fail "$msg 超时（最后值: ${val:-空}）"
}
has_text() { # $1 选择器内的文本表达式, $2 期望子串, $3 说明
  local got; got="$(js "$1")"
  printf '%s' "$got" | grep -q -- "$2" || fail "$3: 期望含 [$2] 实际 [$got]"
  ok "$3 含 [$2]"
}

A open --socket "$SOCK" >/dev/null || fail "open 失败"
WIN="$(A windows | head -1)"
case "$WIN" in *page*) ok "窗口: $WIN" ;; *) fail "未找到网页窗口: $WIN" ;; esac

mkdir -p "$OUT_DIR"

# 等前端桥接挂好（bridge 在 React 渲染前注入 window.cinema）
for _ in $(seq 1 40); do
  [ "$(js "!!(window.cinema&&window.cinema.pickVideos)" 2>/dev/null)" = "true" ] && break
  sleep 0.3
done
js "!!(window.cinema&&window.cinema.pickVideos)" | grep -q true || fail "前端桥接未就绪(window.cinema)"
ok "前端桥接就绪"

# ---- 1. 播种片库（绕过原生对话框，走真实扫描/授权） ----------------------
log "播种片库"
js "window.__MP4='$MP4'; window.cinema.pickVideos=()=>globalThis.mygo.call('Cinema.SeedPaths',[window.__MP4]); 'patched'" >/dev/null
js "(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.innerText.trim()==='选择视频文件'); if(!b) return 'no-btn'; b.click(); return 'clicked';})()" | grep -q clicked || fail "未找到「选择视频文件」按钮"
A wait --settle --timeout 8s >/dev/null 2>&1 || true
has_text "document.querySelector('.media-grid')?.innerText || ''" "E2E 演示片" "片库卡片"
A screenshot "$OUT_DIR/1-library.png" >/dev/null || fail "截图失败(片库)"
ok "截图: $OUT_DIR/1-library.png"

# ---- 2. 点击单集 → 进入播放页 --------------------------------------------
log "进入播放页"
js "(()=>{const b=document.querySelector('.episode-button'); if(!b) return 'no-ep'; b.click(); return 'clicked';})()" | grep -q clicked || fail "未找到单集按钮"
js "!!document.querySelector('.player-screen')" | grep -q true || fail "播放页未出现"
ok "播放页已进入"

# 解码/时长：loadedmetadata 后 duration 应≈65s（证明容器+编码可解码）
poll_num "document.querySelector('.player-video')?.duration || 0" gt 60 "video.duration(s)"

# ---- 3. 字幕叠加 ----------------------------------------------------------
log "校验字幕"
js "(()=>{const v=document.querySelector('.player-video'); v.currentTime=2.0; return v.currentTime;})()" >/dev/null
sleep 1
has_text "document.querySelector('.subtitle-layer')?.textContent || ''" "E2E 字幕校验行" "字幕层"
A screenshot "$OUT_DIR/2-player-subtitle.png" >/dev/null || fail "截图失败(字幕)"
ok "截图: $OUT_DIR/2-player-subtitle.png"

# ---- 4. 弹幕层（canvas 挂载 + 开关状态） ---------------------------------
log "校验弹幕层"
js "!!document.querySelector('.danmaku-canvas')" | grep -q true || fail "未找到弹幕 canvas"
ok "弹幕 canvas 已挂载"
has_text "([...document.querySelectorAll('.player-actions button')].map(b=>b.innerText).join('|'))" "弹幕 开" "弹幕开关初始态"
js "(()=>{const b=[...document.querySelectorAll('.player-actions button')].find(x=>x.innerText.startsWith('弹幕 ')); b&&b.click(); return true;})()" >/dev/null
has_text "([...document.querySelectorAll('.player-actions button')].map(b=>b.innerText).join('|'))" "弹幕 关" "弹幕开关切换后"
js "(()=>{const b=[...document.querySelectorAll('.player-actions button')].find(x=>x.innerText.startsWith('弹幕 ')); b&&b.click(); return true;})()" >/dev/null
ok "弹幕开关可切换"

# ---- 5. 续播：退出时落盘 → 片库「继续观看」→ 恢复播放 --------------------
log "校验退出续播"
js "(()=>{const v=document.querySelector('.player-video'); v.currentTime=42.0; return v.currentTime;})()" >/dev/null
sleep 1
# 点击返回触发卸载清理 → saveProgress
js "(()=>{const b=[...document.querySelectorAll('.player-actions button')].find(x=>x.innerText.trim()==='返回'); if(!b) return 'no-back'; b.click(); return 'clicked';})()" | grep -q clicked || fail "未找到「返回」按钮"
A wait --settle --timeout 8s >/dev/null 2>&1 || true
js "!!document.querySelector('.player-screen')" | grep -q false || fail "未返回片库"
js "window.__p=-1; globalThis.mygo.call('Cinema.ListProgress').then(l=>window.__p=(l&&l[0]&&l[0].position)||0).catch(()=>{}); 'asked'" >/dev/null
has_text "document.body.innerText" "继续观看" "片库继续观看"
# 校验进度记录已落盘且位置≈42
poll_num "window.__p||0" gt 40 "progress.position(s)"
A screenshot "$OUT_DIR/3-library-continue.png" >/dev/null || fail "截图失败(继续观看)"
ok "截图: $OUT_DIR/3-library-continue.png"

# 点击「继续观看」卡片 → 应从 42s 恢复
js "(()=>{const c=document.querySelector('.continue-card'); if(!c) return 'no-card'; c.click(); return 'clicked';})()" | grep -q clicked || fail "未找到继续观看卡片"
poll_num "document.querySelector('.player-video')?.duration || 0" gt 60 "恢复后 duration(s)"
sleep 1
poll_num "document.querySelector('.player-video')?.currentTime || 0" gt 40 "续播起点 currentTime(s)"
A screenshot "$OUT_DIR/4-player-resumed.png" >/dev/null || fail "截图失败(续播)"
ok "截图: $OUT_DIR/4-player-resumed.png"

printf '\033[32m[PASS]\033[0m 本地文件 GUI 端到端测试通过\n'

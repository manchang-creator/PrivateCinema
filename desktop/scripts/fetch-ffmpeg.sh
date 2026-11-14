#!/usr/bin/env bash
# 私人影院桌面端 · 内置 ffmpeg 准备脚本（用 ffmpeg 官方静态构建）
#
# 为什么需要：
#   红果分集是 CENC 加密的 HEVC，WebView 解不了，必须 ffmpeg `-decryption_key` 解密转码。
#   让用户自己装 ffmpeg 是最容易翻车的一环（装了没重开、PATH 没生效、放了便携版在别的目录），
#   所以 Windows 安装包直接把 ffmpeg.exe 带上：mygo 会把 resources/windows-amd64/ 下的文件
#   复制到 exe 同目录，Go 侧按「应用同目录」优先找它（见 desktop/ffmpeg.go）。
#
# 用法：
#   bash desktop/scripts/fetch-ffmpeg.sh            # 只准备本机平台
#   bash desktop/scripts/fetch-ffmpeg.sh windows    # 指定 GOOS
#   bash desktop/scripts/fetch-ffmpeg.sh all        # windows + linux（CI 打两个平台的包时用）
#
# 环境变量：
#   FFMPEG_ZIP_URL     覆盖下载地址（自建镜像），必须同时给 FFMPEG_ZIP_SHA256
#   FFMPEG_ZIP_SHA256  自定义地址的 SHA-256（64 位十六进制）
#   FFMPEG_FORCE=1     已存在但仍重新下载
#
# 产物：
#   desktop/resources/windows-amd64/ffmpeg.exe      随 Windows 包发布
#   desktop/resources/windows-amd64/ffmpeg-LICENSE.txt / ffmpeg-NOTICE.txt
#   desktop/resources/linux-amd64/ffmpeg            同上（Linux 发布包也带一份）
#   desktop/resources/ffmpeg/COPYING.GPLv2|GPLv3|LGPLv2.1   （所有平台共用许可文本）
#
# 许可：Gyan 的 essentials 构建是 GPLv3（--enable-gpl），因此分发时必须带上 GPL 文本与
#   NOTICE。仓库里不存二进制，构建前跑本脚本现下现校验，避免版本漂移。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"          # -> desktop/
RES="$ROOT/resources"
CACHE="$ROOT/.cache/ffmpeg"

# 固定上游版本与官方包 SHA-256；升级时两处一起改。
FFMPEG_VERSION="7.1"
OFFICIAL_URL="https://github.com/GyanD/codexffmpeg/releases/download/${FFMPEG_VERSION}/ffmpeg-${FFMPEG_VERSION}-essentials_build.zip"
OFFICIAL_SHA256="fa7d4d7e795db0e2503f49f105f46ed5852386f0cfdd819899be3b65ebde24fc"

log()  { printf '\033[36m[ffmpeg]\033[0m %s\n' "$*"; }
ok()   { printf '\033[32m[ ok ]\033[0m %s\n' "$*"; }
warn() { printf '\033[33m[warn]\033[0m %s\n' "$*"; }
die()  { printf '\033[31m[FAIL]\033[0m %s\n' "$*" >&2; exit 1; }

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | awk '{print $1}'
  else die "找不到 sha256sum / shasum，无法校验下载包"
  fi
}

# ---- 要准备的平台 ---------------------------------------------------------
TARGETS=()
case "${1:-local}" in
  all)     TARGETS=(windows-amd64 linux-amd64) ;;
  windows|windows-amd64) TARGETS=(windows-amd64) ;;
  linux|linux-amd64)     TARGETS=(linux-amd64) ;;
  local)
    case "$(uname -s)/$(uname -m)" in
      MINGW*|MSYS*|CYGWIN*|Windows_NT*) TARGETS=(windows-amd64) ;;
      *) TARGETS=(linux-amd64) ;;
    esac
    ;;
  *) die "未知平台：$1（可选 windows | linux | all | local）" ;;
esac

# ---- 许可文本：始终写一份（跟平台无关） ------------------------------------
# 不在这里手写许可正文（手抄会被截断、也不算「随附完整文本」）：上游包里自带 GPLv3 全文，
# 这里把它落到 resources/ffmpeg/，供所有平台共用；下载包不在场时先只写占位说明。
write_licenses() {
  local dir="$RES/ffmpeg"
  mkdir -p "$dir"
  local src=""
  if [ -d "$UNPACK" ]; then src="$(unpack_root 2>/dev/null || true)/LICENSE"; fi
  if [ -n "$src" ] && [ -s "$src" ]; then
    cp "$src" "$dir/COPYING.GPLv3"
    ok "许可文本：resources/ffmpeg/COPYING.GPLv3（取自上游 LICENSE，$(grep -c "" "$dir/COPYING.GPLv3") 行）"
  elif [ -s "$dir/COPYING.GPLv3" ]; then
    ok "许可文本已存在：resources/ffmpeg/COPYING.GPLv3"
  else
    warn "还没有 resources/ffmpeg/COPYING.GPLv3：先跑本脚本（windows 目标会下载并解出上游许可文本）"
  fi
  cat >"$dir/README.txt" <<'TXT'
resources/ffmpeg/ 与 resources/<goos>-<goarch>/ 下的 ffmpeg 相关文件：

- ffmpeg(.exe)          随包分发的 FFmpeg 可执行文件（解密 + 转码用）
- ffmpeg-LICENSE.txt    该构建的完整许可文本（GPLv3；Gyan essentials build 是 --enable-gpl）
- ffmpeg-NOTICE.txt     来源、版本、用途与源码获取方式
- COPYING.GPLv3         上面文本的副本，方便打包工具一层层带上

源码获取：https://ffmpeg.org/releases/ffmpeg-<版本>.tar.xz
构建脚本：https://github.com/GyanD/codexffmpeg

不要手工改这些文件：它们由 desktop/scripts/fetch-ffmpeg.sh 生成。
TXT
}

# ffmpeg 的完整许可原文随下载包附带的 LICENSE.md / COPYING.* 一起分发；
# 这里再给运行期用户一份可读说明。
write_notice() {
  local dir="$1" plat="$2"
  cat >"$dir/ffmpeg-NOTICE.txt" <<EOF
本应用内置 FFmpeg（$plat）。

来源：https://github.com/GyanD/codexffmpeg（ffmpeg $FFMPEG_VERSION essentials build）
许可：GPL v3（含 libx264 等 GPL 组件），完整许可见同目录 ffmpeg-LICENSE.txt、
      以及 resources/ffmpeg/COPYING.GPLv2 / COPYING.GPLv3 / COPYING.LGPLv2.1。
用途：仅用于在本地把用户有权观看的内容解密/转码为可播放的 H.264，不经任何网络转发。

FFmpeg 是 FFmpeg 项目（https://ffmpeg.org）的商标，本应用与该项目无隶属关系。
对应源码：下载同一版本的源码包 https://ffmpeg.org/releases/ffmpeg-$FFMPEG_VERSION.tar.xz ，
按 GPLv3 提供；如你拿到的是二进制分发，可向发布方索取与本二进制一致的构建配置
（--enable-gpl --enable-libx264 --enable-libzimg …，详见
 https://github.com/GyanD/codexffmpeg 的 build 说明）。
EOF
}

# 每个平台额外放一份 GPL 文本与 NOTICE，安装后用户可直接在安装目录看到。
copy_license_bundle() {
  local dir="$1"
  cp "$RES/ffmpeg/COPYING.GPLv3" "$dir/" 2>/dev/null || true
  cp "$RES/ffmpeg/README.txt" "$dir/ffmpeg-README.txt" 2>/dev/null || true
}

# ---- 下载并解压上游包 ------------------------------------------------------
ZIP="$CACHE/ffmpeg-${FFMPEG_VERSION}-essentials_build.zip"

ensure_zip() {
  mkdir -p "$CACHE"
  if [ -s "$ZIP" ] && [ "${FFMPEG_FORCE:-0}" != "1" ]; then
    ok "复用已下载的压缩包：$ZIP"
  else
    local url="${FFMPEG_ZIP_URL:-$OFFICIAL_URL}"
    log "下载 ffmpeg $FFMPEG_VERSION essentials（约 88MB）…"
    curl -fL --retry 3 --retry-delay 2 -o "$ZIP.part" "$url" || die "下载失败：$url"
    mv "$ZIP.part" "$ZIP"
  fi

  local want="${FFMPEG_ZIP_SHA256:-$OFFICIAL_SHA256}"
  [ "${FFMPEG_ZIP_URL:-}" != "" ] && [ "${FFMPEG_ZIP_SHA256:-}" = "" ] &&
    die "自定义 FFMPEG_ZIP_URL 必须同时设置 FFMPEG_ZIP_SHA256（64 位十六进制）"
  [[ "$want" =~ ^[0-9a-fA-F]{64}$ ]] || die "SHA-256 格式不对：$want"

  local got
  got="$(sha256_of "$ZIP")"
  [ "$got" = "$(printf '%s' "$want" | tr 'A-F' 'a-f')" ] ||
    { rm -f "$ZIP"; die "压缩包 SHA-256 不匹配（期望 $want，实际 $got），已删除下载文件"; }
  ok "压缩包校验通过（$(du -h "$ZIP" | awk '{print $1}')）"
}

UNPACK="$CACHE/unpack"
# 上游 zip 里是 ffmpeg-<version>-essentials_build/ 这一层目录；统一向下找一层的 bin/ffmpeg.exe。
unpack_root() {
  local candidate
  for candidate in "$UNPACK"/*/ "$UNPACK"; do
    [ -f "${candidate%/}/bin/ffmpeg.exe" ] && { printf '%s' "${candidate%/}"; return 0; }
  done
  return 1
}

unpack_once() {
  if unpack_root >/dev/null 2>&1 && [ "${FFMPEG_FORCE:-0}" != "1" ]; then return 0; fi
  rm -rf "$UNPACK"
  mkdir -p "$UNPACK"
  log "解压…"
  if command -v unzip >/dev/null 2>&1; then
    unzip -q -o "$ZIP" -d "$UNPACK"
  else
    python3 - "$ZIP" "$UNPACK" <<'PYEXTRACT'
import sys, zipfile
zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])
PYEXTRACT
  fi
  unpack_root >/dev/null 2>&1 || die "解压后没有找到 bin/ffmpeg.exe，上游包结构变了？"
}

# ---- 安装到 resources/<goos-goarch>/ --------------------------------------
install_windows() {
  local dir="$RES/windows-amd64"
  local root
  root="$(unpack_root)"
  mkdir -p "$dir"
  if [ -s "$dir/ffmpeg.exe" ] && [ "${FFMPEG_FORCE:-0}" != "1" ]; then
    ok "已存在：resources/windows-amd64/ffmpeg.exe ($(du -h "$dir/ffmpeg.exe" | awk '{print $1}'))"
  else
    cp "$root/bin/ffmpeg.exe" "$dir/ffmpeg.exe"
    chmod 0644 "$dir/ffmpeg.exe"
    ok "写入 resources/windows-amd64/ffmpeg.exe ($(du -h "$dir/ffmpeg.exe" | awk '{print $1}'))"
  fi
  cp "$root/LICENSE" "$dir/ffmpeg-LICENSE.txt" 2>/dev/null || true
  write_notice "$dir" "Windows x64"
}

legacy_windows=0
for t in "${TARGETS[@]}"; do
  case "$t" in
    windows-amd64) legacy_windows=1 ;;
  esac
done

if [ "$legacy_windows" = "1" ]; then
  ensure_zip
  unpack_once
  install_windows
fi

for t in "${TARGETS[@]}"; do
  case "$t" in
    linux-amd64) install_linux ;;
    windows-amd64) : ;;
  esac
done

# 解压产物（若本次有）先落许可文本，再按平台分发副本。
write_licenses
for t in "${TARGETS[@]}"; do
  [ -d "$RES/$t" ] && copy_license_bundle "$RES/$t" && cp "$RES/ffmpeg/ffmpeg-NOTICE.txt" "$RES/$t/" 2>/dev/null || true
done

log "完成。mygo build 会把 resources/ 下的文件复制到可执行文件旁（见 mygo.config.ts 的说明）。"

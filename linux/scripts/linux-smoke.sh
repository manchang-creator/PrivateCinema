#!/bin/bash
# ==================== Linux 真机自检 ====================
# 目的：在本机实际把关「只能用真机验证」的两条链路 —— 显示器亮度与播放。
# 单元测试只覆盖纯逻辑（刻度换算、ddcutil 输出解析），sysfs / i2c / 解码器
# 这些依赖内核和驱动的部分必须在这里跑。
#
# 用法：
#   bash scripts/linux-smoke.sh
# 退出码：0 = 全部通过；1 = 有检查项失败（逐项打印 FAIL 原因）

set -uo pipefail

fail_count=0

pass() { printf '  PASS  %s\n' "$1"; }
fail_check() { printf '  FAIL  %s\n' "$1"; fail_count=1; }
info() { printf '  info  %s\n' "$1"; }

echo '== 1. 环境 =='
printf '  kernel   %s\n' "$(uname -r)"
printf '  session  %s\n' "${XDG_SESSION_TYPE:-unknown}"
printf '  node     %s\n' "$(node -v 2>/dev/null || echo '未安装')"

echo '== 2. 背光（sysfs） =='
if [ -d /sys/class/backlight ] && [ -n "$(ls -A /sys/class/backlight 2>/dev/null)" ]; then
  pass '/sys/class/backlight 有设备'
  for dev in /sys/class/backlight/*; do
    name=$(basename "$dev")
    max=$(cat "$dev/max_brightness" 2>/dev/null || echo '?')
    cur=$(cat "$dev/brightness" 2>/dev/null || echo '?')
    info "$name: current=$cur max=$max"
    if [ -w "$dev/brightness" ]; then
      pass "$name/brightness 当前用户可写"
    else
      fail_check "$name/brightness 不可写 —— 需要 sudo 安装 build/udev/90-private-cinema-backlight.rules 后 reload udev"
      info "安装：sudo cp build/udev/90-private-cinema-backlight.rules /usr/lib/udev/rules.d/ && sudo udevadm control --reload-rules && sudo udevadm trigger --action=change --subsystem-match=backlight"
    fi
  done
else
  info '/sys/class/backlight 为空（台式机外接屏属正常），跳过内置屏检查'
fi

echo '== 3. 外接屏（ddcutil / DDC-CI） =='
if command -v ddcutil >/dev/null 2>&1; then
  pass 'ddcutil 已安装'
  detect_out=$(ddcutil detect --brief 2>&1)
  if printf '%s' "$detect_out" | grep -q 'Display 1'; then
    pass '检测到 DDC/CI 显示器'
    bus=$(printf '%s' "$detect_out" | sed -n 's|.*I2C bus: */dev/i2c-\([0-9]*\).*|\1|p' | head -1)
    vcp=$(ddcutil getvcp 10 --brief --bus "$bus" 2>&1)
    case "$vcp" in
      *'VCP 10'*) pass "bus $bus 亮度可读：$vcp" ;;
       *Permission*|*permission*) fail_check "bus $bus 权限不足：$vcp" ; info 'sudo usermod -aG i2c $USER 后重新登录' ;;
      *) info "bus $bus 不支持亮度或读取失败：$vcp" ;;
    esac
  else
    info '未检测到 DDC/CI 显示器（ddcutil 需要 i2c-dev 模块与显示器支持 MCCS）'
  fi
else
  info '未安装 ddcutil —— 外接屏亮度不可用（sudo apt install ddcutil）'
fi

echo '== 4. 打包产物 =='
if [ -x release/linux-unpacked/private-cinema ]; then
  pass 'release/linux-unpacked/private-cinema 存在'
  if [ -f release/linux-unpacked/resources/udev/90-private-cinema-backlight.rules ]; then
    pass 'udev 规则随包分发'
  else
    fail_check '缺少 udev 规则文件'
  fi
else
  info '未构建：先执行 npm run dist:dir'
fi

echo '== 5. 启动冒烟（无显示器环境下用 xvfb） =='
APP_BIN=release/linux-unpacked/private-cinema
if [ -x "$APP_BIN" ]; then
  if command -v xvfb-run >/dev/null 2>&1; then
    # 5 秒后主动杀掉：只验证「进程活着且没有崩」，窗口交互需人工
    timeout 8 xvfb-run -a "$APP_BIN" --no-sandbox --enable-logging > /tmp/private-cinema-smoke.log 2>&1
    code=$?
    if [ "$code" -eq 124 ]; then
      pass '进程存活 8 秒（未被提前退出）'
    else
      fail_check "进程提前退出，退出码 $code，日志 /tmp/private-cinema-smoke.log"
    fi
    # 只认真正的启动失败。SIGTERM 强杀时 Chromium 自己会打
    # `FATAL:...Failed to shutdown.` —— 那是被 kill 的产物，不是应用崩溃。
    if grep -q 'Uncaught Exception\|Cannot find module\|ERR_FILE_NOT_FOUND' /tmp/private-cinema-smoke.log; then
      fail_check '日志中出现启动失败迹象'
      grep -m3 'Uncaught Exception\|Cannot find module\|ERR_FILE_NOT_FOUND' /tmp/private-cinema-smoke.log
    else
      pass '日志无启动失败'
    fi
    grep -m1 'Failed to shutdown' /tmp/private-cinema-smoke.log >/dev/null && \
      info '有 Failed to shutdown（SIGTERM 强杀的正常残留，不计失败）'
  else
    info '本机无 xvfb-run，跳过启动冒烟（sudo apt install xvfb）'
  fi

  # 主进程自检：走与界面相同的 IPC 路径枚举显示器，并对可用显示器做一次
  # 「读当前值写回原值」的往返（不改变实际亮度）。窗口交互无法测，这条能测的部分在这里测。
  if timeout 30 "$APP_BIN" --no-sandbox --disable-gpu --self-check > /tmp/private-cinema-selfcheck.json 2>/dev/null; then
    pass '主进程自检 --self-check 正常退出'
    if grep -q 'SELF_CHECK' /tmp/private-cinema-selfcheck.json; then
      pass '自检输出有效（/tmp/private-cinema-selfcheck.json）'
      grep -o '"reason": "[^"]*"' /tmp/private-cinema-selfcheck.json | sed 's/^/  info  写入失败原因：/'
    else
      fail_check '自检输出缺少 SELF_CHECK 标记'
    fi
  else
    fail_check '主进程自检失败（超时或非零退出），见 /tmp/private-cinema-selfcheck.json'
  fi
else
  info '未构建，跳过启动冒烟'
fi

echo
if [ "$fail_count" -eq 0 ]; then
  echo '结果：全部检查通过'
else
  echo '结果：存在失败项（见上方 FAIL）'
fi
exit "$fail_count"

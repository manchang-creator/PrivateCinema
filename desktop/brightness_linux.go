//go:build linux

package main

// ==================== 显示器亮度（Linux，移植自 linux/src/main/brightness.ts） ====================
// 三条后端按「能控制就给范围，不能控制就如实返回原因」合流：
//   1. sysfs /sys/class/backlight/*  内置屏 / eDP
//   2. ddcutil CLI                  外接屏 DDC/CI
//   3. xrandr --brightness          X11 软件调光兜底（硬件背光不可写时）
// 已知约束与 TS 版一致：sysfs 读 `brightness`（请求值）而非 actual_brightness；
// 不碰 bl_power；写入节流在渲染层（每屏最多一个在途）。

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const (
	backlightRoot = "/sys/class/backlight"
	xrandrMin     = 10
	xrandrMax     = 100
)

var (
	reDdcDisplay  = regexp.MustCompile(`^Display \d+`)
	reDdcBus      = regexp.MustCompile(`^I2C bus:\s*/dev/i2c-(\d+)`)
	reDdcMonitor  = regexp.MustCompile(`^Monitor:\s*(.+)$`)
	reDdcVcp      = regexp.MustCompile(`(?i)VCP\s+10\s+C\s+(\d+)\s+(\d+)`)
	reXrConnected = regexp.MustCompile(`^(\S+)\s+connected\s+(primary\s+)?\d+\s*x\s*\d+`)
	reXrBright    = regexp.MustCompile(`Brightness:\s*([0-9.]+)`)
)

// clampValue 把请求亮度收敛到支持范围并取整。
func clampValue(value, min, max float64) float64 {
	if value < min {
		value = min
	}
	if value > max {
		value = max
	}
	return float64(int(value + 0.5))
}

// ---------- sysfs ----------

func listSysfsBacklights() []DisplayBrightness {
	entries, err := os.ReadDir(backlightRoot)
	if err != nil {
		return nil
	}
	var out []DisplayBrightness
	for _, entry := range entries {
		name := entry.Name()
		dir := filepath.Join(backlightRoot, name)
		id := "sysfs:" + name
		maxRaw, err1 := os.ReadFile(filepath.Join(dir, "max_brightness"))
		curRaw, err2 := os.ReadFile(filepath.Join(dir, "brightness"))
		if err1 != nil || err2 != nil {
			out = append(out, DisplayBrightness{ID: id, Label: name, Available: false, Reason: "背光设备不可读"})
			continue
		}
		maxV, e1 := strconv.Atoi(strings.TrimSpace(string(maxRaw)))
		curV, e2 := strconv.Atoi(strings.TrimSpace(string(curRaw)))
		if e1 != nil || e2 != nil || maxV <= 0 {
			out = append(out, DisplayBrightness{ID: id, Label: name, Available: false, Reason: "背光刻度异常"})
			continue
		}
		typeRaw, _ := os.ReadFile(filepath.Join(dir, "type"))
		typ := strings.TrimSpace(string(typeRaw))
		label := name
		if typ != "" {
			label = name + "（" + typ + "）"
		}
		// 能读不代表能写：尝试以写方式打开（不写入），失败即无权限。
		writable := false
		if f, err := os.OpenFile(filepath.Join(dir, "brightness"), os.O_WRONLY, 0); err == nil {
			writable = true
			_ = f.Close()
		}
		if !writable {
			out = append(out, DisplayBrightness{ID: id, Label: label, Primary: typ == "raw", Available: false,
				Reason: "当前用户没有背光写入权限：安装 udev 规则并把用户加入 video 组后可启用硬件调光"})
			continue
		}
		out = append(out, DisplayBrightness{ID: id, Label: label, Primary: typ == "raw", Available: true,
			Current: float64(curV), Min: 0, Max: float64(maxV)})
	}
	return out
}

func isPlainBacklightName(name string) bool {
	return name != "" && !strings.HasPrefix(name, ".") && !strings.ContainsAny(name, "/\\")
}

func setSysfsBrightness(name string, value float64) BrightnessWriteResult {
	if !isPlainBacklightName(name) {
		return BrightnessWriteResult{OK: false, Reason: "非法背光设备名 " + name}
	}
	dir := filepath.Join(backlightRoot, name)
	maxRaw, err := os.ReadFile(filepath.Join(dir, "max_brightness"))
	if err != nil {
		return BrightnessWriteResult{OK: false, Reason: "背光设备不可读"}
	}
	maxV, err := strconv.Atoi(strings.TrimSpace(string(maxRaw)))
	if err != nil || maxV <= 0 {
		return BrightnessWriteResult{OK: false, Reason: "背光刻度异常，无法设置亮度"}
	}
	target := int(clampValue(value, 0, float64(maxV)))
	if err := os.WriteFile(filepath.Join(dir, "brightness"), []byte(strconv.Itoa(target)), 0o644); err != nil {
		if errors.Is(err, os.ErrPermission) {
			return BrightnessWriteResult{OK: false, Reason: "没有权限写入背光设备：请检查 udev 规则或文件权限"}
		}
		if errors.Is(err, os.ErrNotExist) {
			return BrightnessWriteResult{OK: false, Reason: "背光设备已消失（显示器可能已断开）"}
		}
		return BrightnessWriteResult{OK: false, Reason: "写入背光失败：" + err.Error()}
	}
	return BrightnessWriteResult{OK: true}
}

// ---------- 子进程 ----------

type cmdResult struct {
	code           int // -1 表示命令不存在
	stdout, stderr string
}

func runCmd(name string, args []string, timeout time.Duration) cmdResult {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, name, args...)
	var out, errb strings.Builder
	cmd.Stdout = &out
	cmd.Stderr = &errb
	err := cmd.Run()
	if err != nil {
		var execErr *exec.Error
		if errors.As(err, &execErr) {
			return cmdResult{code: -1, stdout: out.String(), stderr: errb.String()}
		}
		return cmdResult{code: 1, stdout: out.String(), stderr: errb.String()}
	}
	return cmdResult{code: 0, stdout: out.String(), stderr: errb.String()}
}

func parseDdcutilDetect(output string) []struct {
	Bus   int
	Label string
} {
	var displays []struct {
		Bus   int
		Label string
	}
	bus := -1
	label := ""
	flush := func() {
		if bus >= 0 {
			if label == "" {
				label = "总线 " + strconv.Itoa(bus)
			}
			displays = append(displays, struct {
				Bus   int
				Label string
			}{bus, label})
		}
		bus, label = -1, ""
	}
	for _, line := range strings.Split(output, "\n") {
		t := strings.TrimSpace(line)
		if reDdcDisplay.MatchString(t) {
			flush()
			continue
		}
		if m := reDdcBus.FindStringSubmatch(t); m != nil {
			bus, _ = strconv.Atoi(m[1])
			continue
		}
		if m := reDdcMonitor.FindStringSubmatch(t); m != nil {
			label = strings.TrimSpace(m[1])
		}
	}
	flush()
	return displays
}

func parseDdcutilVcp(output string) (current, max, min int, ok bool) {
	m := reDdcVcp.FindStringSubmatch(output)
	if m == nil {
		return 0, 0, 0, false
	}
	current, _ = strconv.Atoi(m[1])
	max, _ = strconv.Atoi(m[2])
	return current, max, 0, true
}

func describeDdcutilError(stderr string, attempted bool) string {
	if !attempted {
		return "未安装 ddcutil，无法控制外接显示器亮度"
	}
	low := strings.ToLower(stderr)
	if strings.Contains(low, "permission denied") || strings.Contains(low, "i2c") || strings.Contains(low, "display exception") {
		return "没有权限访问 I2C 总线：需要把当前用户加入 i2c 组，或配置 udev 规则"
	}
	if strings.Contains(low, "no displays found") {
		return "未检测到支持 DDC/CI 的显示器"
	}
	lines := strings.Split(strings.TrimSpace(stderr), "\n")
	detail := strings.TrimSpace(lines[len(lines)-1])
	if detail == "" {
		return "ddcutil 调用失败"
	}
	return "ddcutil 调用失败：" + detail
}

func listDdcutilDisplays() ([]DisplayBrightness, string) {
	detect := runCmd("ddcutil", []string{"detect", "--brief"}, 8*time.Second)
	if detect.code == -1 {
		return nil, describeDdcutilError("", false)
	}
	if detect.code != 0 {
		return nil, describeDdcutilError(detect.stderr, true)
	}
	var out []DisplayBrightness
	for _, item := range parseDdcutilDetect(detect.stdout) {
		id := "ddc:" + strconv.Itoa(item.Bus)
		read := runCmd("ddcutil", []string{"getvcp", "10", "--brief", "--bus", strconv.Itoa(item.Bus)}, 8*time.Second)
		if read.code != 0 {
			out = append(out, DisplayBrightness{ID: id, Label: item.Label, Available: false, Reason: describeDdcutilError(read.stderr, true)})
			continue
		}
		cur, max, min, ok := parseDdcutilVcp(read.stdout)
		if !ok {
			out = append(out, DisplayBrightness{ID: id, Label: item.Label, Available: false, Reason: "该显示器不支持亮度（VCP 0x10）"})
			continue
		}
		if max <= min {
			out = append(out, DisplayBrightness{ID: id, Label: item.Label, Available: false, Reason: "该显示器不支持亮度调节"})
			continue
		}
		out = append(out, DisplayBrightness{ID: id, Label: item.Label, Available: true,
			Current: float64(cur), Min: float64(min), Max: float64(max)})
	}
	return out, ""
}

func setDdcutilBrightness(bus int, value float64) BrightnessWriteResult {
	read := runCmd("ddcutil", []string{"getvcp", "10", "--brief", "--bus", strconv.Itoa(bus)}, 8*time.Second)
	if read.code != 0 {
		return BrightnessWriteResult{OK: false, Reason: describeDdcutilError(read.stderr, true)}
	}
	_, max, min, ok := parseDdcutilVcp(read.stdout)
	if !ok {
		return BrightnessWriteResult{OK: false, Reason: "该显示器不支持亮度（VCP 0x10）"}
	}
	if max <= min {
		return BrightnessWriteResult{OK: false, Reason: "该显示器不支持亮度调节"}
	}
	target := int(clampValue(value, float64(min), float64(max)))
	write := runCmd("ddcutil", []string{"setvcp", "10", strconv.Itoa(target), "--bus", strconv.Itoa(bus)}, 8*time.Second)
	if write.code != 0 {
		return BrightnessWriteResult{OK: false, Reason: describeDdcutilError(write.stderr, true)}
	}
	return BrightnessWriteResult{OK: true}
}

// ---------- xrandr ----------

func parseXrandrConnected(output string) []struct {
	Name    string
	Primary bool
} {
	var result []struct {
		Name    string
		Primary bool
	}
	for _, line := range strings.Split(output, "\n") {
		if m := reXrConnected.FindStringSubmatch(strings.TrimSpace(line)); m != nil {
			result = append(result, struct {
				Name    string
				Primary bool
			}{m[1], strings.TrimSpace(m[2]) == "primary"})
		}
	}
	return result
}

func parseXrandrBrightness(output, outputName string) (float64, bool) {
	current := ""
	for _, line := range strings.Split(output, "\n") {
		if m := regexp.MustCompile(`^(\S+)\s+(connected|disconnected)\b`).FindStringSubmatch(line); m != nil {
			current = m[1]
			continue
		}
		if current != outputName {
			continue
		}
		if m := reXrBright.FindStringSubmatch(line); m != nil {
			v, err := strconv.ParseFloat(m[1], 64)
			if err == nil {
				return v, true
			}
		}
	}
	return 0, false
}

func listXrandrScreens() []DisplayBrightness {
	if os.Getenv("DISPLAY") == "" {
		return nil
	}
	query := runCmd("xrandr", []string{"--query"}, 5*time.Second)
	if query.code != 0 {
		return nil
	}
	outputs := parseXrandrConnected(query.stdout)
	if len(outputs) == 0 {
		return nil
	}
	target := outputs[0]
	for _, o := range outputs {
		if o.Primary {
			target = o
			break
		}
	}
	verbose := runCmd("xrandr", []string{"--verbose"}, 5*time.Second)
	raw := 1.0
	if verbose.code == 0 {
		if v, ok := parseXrandrBrightness(verbose.stdout, target.Name); ok {
			raw = v
		}
	}
	current := int(raw*100 + 0.5)
	if current < xrandrMin {
		current = xrandrMin
	}
	if current > xrandrMax {
		current = xrandrMax
	}
	return []DisplayBrightness{{
		ID: "xrandr:" + target.Name, Label: target.Name + "（X11 软件调光）",
		Primary: len(outputs) == 1 || target.Primary, Available: true,
		Current: float64(current), Min: xrandrMin, Max: xrandrMax,
	}}
}

func setXrandrBrightness(outputName string, value float64) BrightnessWriteResult {
	if os.Getenv("DISPLAY") == "" {
		return BrightnessWriteResult{OK: false, Reason: "没有可用的 X11 显示（DISPLAY 未设置）"}
	}
	target := int(clampValue(value, xrandrMin, xrandrMax))
	write := runCmd("xrandr", []string{"--output", outputName, "--brightness", strconv.FormatFloat(float64(target)/100, 'f', 2, 64)}, 5*time.Second)
	if write.code != 0 {
		lines := strings.Split(strings.TrimSpace(write.stderr), "\n")
		detail := strings.TrimSpace(lines[len(lines)-1])
		if detail == "" {
			return BrightnessWriteResult{OK: false, Reason: "xrandr 设置亮度失败"}
		}
		return BrightnessWriteResult{OK: false, Reason: "xrandr 设置亮度失败：" + detail}
	}
	return BrightnessWriteResult{OK: true}
}

// ---------- 对外接口 ----------

func listDisplays() []DisplayBrightness {
	sysfs := listSysfsBacklights()
	ddc, ddcReason := listDdcutilDisplays()
	hardware := append(append([]DisplayBrightness{}, sysfs...), ddc...)
	hasUsable := false
	for _, d := range hardware {
		if d.Available {
			hasUsable = true
			break
		}
	}
	var all []DisplayBrightness
	all = append(all, hardware...)
	if !hasUsable {
		all = append(all, listXrandrScreens()...)
	}
	if len(all) == 0 {
		reason := ddcReason
		if reason == "" {
			reason = "未找到可控制的显示器（sysfs 无背光设备，且未检测到 DDC/CI 显示器）"
		}
		return []DisplayBrightness{{ID: "none", Label: "显示器", Available: false, Reason: reason}}
	}
	// 可用的排前面。
	for i := 0; i < len(all); i++ {
		for j := i + 1; j < len(all); j++ {
			if !all[i].Available && all[j].Available {
				all[i], all[j] = all[j], all[i]
			}
		}
	}
	return all
}

func setDisplayBrightness(id string, value float64) BrightnessWriteResult {
	if value != value { // NaN
		return BrightnessWriteResult{OK: false, Reason: "亮度值必须是有限数字"}
	}
	kind, key, _ := strings.Cut(id, ":")
	switch kind {
	case "sysfs":
		if key != "" {
			return setSysfsBrightness(key, value)
		}
	case "ddc":
		if key != "" {
			bus, err := strconv.Atoi(key)
			if err != nil {
				return BrightnessWriteResult{OK: false, Reason: "非法显示器标识 " + id}
			}
			return setDdcutilBrightness(bus, value)
		}
	case "xrandr":
		if key != "" {
			return setXrandrBrightness(key, value)
		}
	}
	if id == "none" {
		return BrightnessWriteResult{OK: false, Reason: "没有可控制的显示器"}
	}
	return BrightnessWriteResult{OK: false, Reason: "未知显示器标识 " + id}
}

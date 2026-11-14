// Command update-mirror 把 `mygo build` 产出的签名更新清单，改造成可放到任意静态托管
// （对象存储 / 自建反代 / 内网 NAS）的「镜像清单」，并可选地算出归档的 sha256。
//
// 为什么需要：更新清单默认指向 GitHub 的 release 资产域名，国内网络常在首跳被掐。
// 镜像只负责"送文件"，签名仍由 mygo 用应用内置的 ed25519 公钥校验 —— 镜像被篡改也装不上。
//
// 用法（在 desktop/ 下）：
//
//	# 1) 先生成镜像清单（url 改指 <base>/<target>/<文件名>）
//	go run ./cmd/update-mirror -in build/windows-amd64/update-windows-amd64.json \
//	    -out dist-mirror/windows-amd64/update-windows-amd64.json \
//	    -base https://dl.example.com/private-cinema -target windows-amd64
//
//	# 2) 把归档、delta 与清单一起放到镜像目录（文件名保持原样，别改）
//	#    windows-amd64/private-cinema-0.1.10-windows-amd64.tar.gz
//	#    windows-amd64/update-windows-amd64.json
//
//	# 可选：-hash 让工具下载归档并写入 sha256 字段（客户端会额外校验一次）
//	go run ./cmd/update-mirror ... -hash
package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

type archive struct {
	From      string `json:"from,omitempty"`
	URL       string `json:"url"`
	Size      int64  `json:"size"`
	Signature string `json:"signature"`
	SHA256    string `json:"sha256,omitempty"`
}

type manifest struct {
	Version   string    `json:"version"`
	Notes     string    `json:"notes,omitempty"`
	Date      string    `json:"date,omitempty"`
	URL       string    `json:"url"`
	Size      int64     `json:"size"`
	Signature string    `json:"signature"`
	Deltas    []archive `json:"deltas,omitempty"`
	Previous  []archive `json:"previous,omitempty"`
	SHA256    string    `json:"sha256,omitempty"`
}

func main() {
	var (
		in     = flag.String("in", "", "输入：mygo build 产出的 update-<target>.json")
		out    = flag.String("out", "", "输出：镜像清单路径（留空则打印到 stdout）")
		base   = flag.String("base", "", "镜像根地址，如 https://dl.example.com/private-cinema")
		target = flag.String("target", "", "目标平台，如 windows-amd64（默认从输入文件名推断）")
		hash   = flag.Bool("hash", false, "下载归档并写入 sha256（较慢，但客户端多一层完整性校验）")
	)
	flag.Parse()

	if *in == "" || *base == "" {
		fatalf("需要 -in 与 -base")
	}
	raw, err := os.ReadFile(*in)
	if err != nil {
		fatalf("读输入清单: %v", err)
	}

	t := *target
	if t == "" {
		// update-windows-amd64.json → windows-amd64；不符合命名时退回 GOOS-GOARCH。
		name := filepath.Base(*in)
		if strings.HasPrefix(name, "update-") && strings.HasSuffix(name, ".json") {
			t = strings.TrimSuffix(strings.TrimPrefix(name, "update-"), ".json")
		}
		if t == "" || t == name {
			t = runtime.GOOS + "-" + runtime.GOARCH
			fmt.Fprintf(os.Stderr, "提示：文件名不是 update-<target>.json，按本机平台用 %s（可用 -target 覆盖）\n", t)
		}
	}

	baseURL := normalizeBase(*base)
	fixed, err := rewrite(raw, baseURL, t, *hash)
	if err != nil {
		fatalf("%v", err)
	}

	if *out == "" {
		os.Stdout.Write(fixed)
		if len(fixed) > 0 && fixed[len(fixed)-1] != '\n' {
			fmt.Println()
		}
		return
	}
	if err := os.MkdirAll(filepath.Dir(*out), 0o755); err != nil {
		fatalf("建目录: %v", err)
	}
	if err := os.WriteFile(*out, append(fixed, '\n'), 0o644); err != nil {
		fatalf("写输出清单: %v", err)
	}
	fmt.Fprintf(os.Stderr, "写入 %s（target=%s，url → %s/%s/）\n", *out, t, baseURL, t)
}

// normalizeBase 统一去掉尾部斜杠并校验协议：镜像必须是 https。
func normalizeBase(raw string) string {
	raw = strings.TrimRight(strings.TrimSpace(raw), "/")
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" {
		fatalf("镜像地址必须是 https URL：%q", raw)
	}
	return raw
}

// rewrite 把清单里的归档/delta 地址改写成镜像地址，并在需要时补 sha256。
func rewrite(raw []byte, base, target string, withHash bool) ([]byte, error) {
	var m manifest
	if err := json.Unmarshal(raw, &m); err != nil {
		return nil, fmt.Errorf("解析输入清单: %w", err)
	}
	if m.Version == "" || m.URL == "" || m.Signature == "" || m.Size <= 0 {
		return nil, errors.New("输入清单字段不全（需要 version/url/size/signature）")
	}

	name := path.Base(m.URL)
	// 归档文件名带平台（-windows-amd64.tar.gz），与 target 对不上说明清单/参数拿错了，
	// 否则镜像上会出现 windows 归档躺在 linux-amd64/ 下的错位。
	if !strings.Contains(name, "-"+target+".") && !strings.Contains(name, "-"+target+"-") {
		return nil, fmt.Errorf("归档 %q 与 target %q 不匹配，请检查 -in 与 -target", name, target)
	}
	m.URL = mirrorURL(base, target, name)
	if withHash {
		sum, got, err := fetchSHA256(m.URL, m.Size)
		if err != nil {
			return nil, fmt.Errorf("计算 %s 的 sha256: %w", name, err)
		}
		if got != m.Size {
			return nil, fmt.Errorf("%s 大小不符：清单 %d，镜像 %d（归档没传全或传错）", name, m.Size, got)
		}
		m.SHA256 = sum
	}

	for i := range m.Deltas {
		dname := path.Base(m.Deltas[i].URL)
		m.Deltas[i].URL = mirrorURL(base, target, dname)
		if withHash {
			sum, got, err := fetchSHA256(m.Deltas[i].URL, m.Deltas[i].Size)
			if err != nil {
				return nil, fmt.Errorf("计算 %s 的 sha256: %w", dname, err)
			}
			if got != m.Deltas[i].Size {
				return nil, fmt.Errorf("%s 大小不符：清单 %d，镜像 %d", dname, m.Deltas[i].Size, got)
			}
			m.Deltas[i].SHA256 = sum
		}
	}

	// previous 只是 mygo build 算 delta 用的历史归档，客户端不读；顺手删掉少暴露下载链接。
	m.Previous = nil
	return json.MarshalIndent(m, "", "  ")
}

func mirrorURL(base, target, name string) string {
	return base + "/" + url.PathEscape(target) + "/" + url.PathEscape(name)
}

// fetchSHA256 下载文件并返回摘要与字节数（用于确认镜像上的归档完整）。
func fetchSHA256(addr string, want int64) (string, int64, error) {
	client := &http.Client{Timeout: 10 * time.Minute}
	req, err := http.NewRequest(http.MethodGet, addr, nil)
	if err != nil {
		return "", 0, err
	}
	req.Header.Set("User-Agent", "private-cinema-update-mirror")
	resp, err := client.Do(req)
	if err != nil {
		return "", 0, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", 0, fmt.Errorf("GET %s: %s", addr, resp.Status)
	}
	h := sha256.New()
	n, err := io.Copy(h, resp.Body)
	if err != nil {
		return "", n, err
	}
	return hex.EncodeToString(h.Sum(nil)), n, nil
}

func fatalf(format string, args ...any) {
	fmt.Fprintf(os.Stderr, "update-mirror: "+format+"\n", args...)
	os.Exit(1)
}

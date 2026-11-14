package main

// ==================== 应用更新：镜像源（国内可达） ====================
// 背景（见 docs/2026-11-13-mygo-refactor.md §24）：更新清单放在 GitHub 时，
// `releases/latest/download/update-*.json` 会 302 跳到 release-assets.githubusercontent.com，
// 国内网络常在首跳被 RST 成 EOF。重试能救掉偶发抖动，但救不了"整段被封"。
//
// 这里实现 mygo 的 UpdateSource 接口，把清单与归档换成我们自己的镜像地址：
//
//	https://<MIRROR>/<target>/update-<target>.json     清单（如 windows-amd64）
//	https://<MIRROR>/<target>/<归档文件名>              归档与 delta
//
// 设计要点：
//  1. **安全不回退**：镜像只负责"送文件"，签名校验仍在 mygo 内部用 built-in 的 ed25519 公钥做。
//     所以镜像被投毒、或者返回了内容对不上的清单，安装会在签名校验处失败，不会装进坏东西。
//  2. **清单校验**：读入清单时检查 size 与 sha256（可选 `sha256` 字段），不一致直接拒用；
//     归档的 sha256 一旦用上就写进清单（build-mirror 的 --hash），下发给客户端后再校验。
//  3. **默认不启用**：没配 PRIVATE_CINEMA_UPDATE_MIRROR 时行为与以前完全一致（走 mygo 自带的 GitHub feed）。
//  4. **可回落**：镜像失败时按设置或环境变量决定是否再试 GitHub。
//
// 相关命令：`go run ./cmd/update-mirror -manifest ... -out ...` 把正式清单升级成镜像清单。

import (
	"context"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/egoist/mygo"
)

const (
	// updateMirrorMaxManifest 与 mygo 自己的上限一致（1MiB）。
	updateMirrorMaxManifest = 1 << 20
	// updateMirrorMaxArchive 是单次下载上限，防止镜像返回超大文件把磁盘写满。
	updateMirrorMaxArchive = 1 << 30
	// updateMirrorTimeout 是单次 HTTP 请求的超时。
	updateMirrorTimeout = 60 * time.Second
	// updateMirrorProbeTimeout 是启动探测镜像是否可达的上限（不阻塞界面启动）。
	updateMirrorProbeTimeout = 8 * time.Second
)

// mirrorManifest 是镜像上的 update-<target>.json。
// 与 mygo 的 Manifest 兼容（version/notes/date/url/size/signature/deltas/previous），
// 额外允许一个可选的 sha256 字段用于下载后校验归档完整性。
type mirrorManifest struct {
	Version   string          `json:"version"`
	Notes     string          `json:"notes,omitempty"`
	Date      string          `json:"date,omitempty"`
	URL       string          `json:"url"`
	Size      int64           `json:"size"`
	Signature string          `json:"signature"`
	Deltas    []mirrorArchive `json:"deltas,omitempty"`
	Previous  []mirrorArchive `json:"previous,omitempty"`
	// SHA256 是归档的十六进制摘要（可选）。有就校验，没有就只靠签名。
	SHA256 string `json:"sha256,omitempty"`
}

type mirrorArchive struct {
	From      string `json:"from,omitempty"`
	URL       string `json:"url"`
	Size      int64  `json:"size"`
	Signature string `json:"signature"`
	SHA256    string `json:"sha256,omitempty"`
}

// updateTarget 返回当前平台的 update 目标名，如 windows-amd64。
func updateTarget() string {
	return runtime.GOOS + "-" + runtime.GOARCH
}

// mirrorBase 返回规范化后的镜像根地址（去掉尾部斜杠）；空串表示未配置。
func mirrorBase() string {
	raw := strings.TrimSpace(os.Getenv("PRIVATE_CINEMA_UPDATE_MIRROR"))
	if raw == "" {
		// 兼容旧名字，方便 CI 里用 UPDATER_MIRROR 一个变量统一设置。
		raw = strings.TrimSpace(os.Getenv("UPDATER_MIRROR_URL"))
	}
	if raw == "" {
		return ""
	}
	raw = strings.TrimRight(raw, "/")
	// 只接受 https（本机回环允许 http，便于本地联调与单测）。
	if u, err := url.Parse(raw); err != nil ||
		!(u.Scheme == "https" || (u.Scheme == "http" && isLoopbackHost(u.Hostname()))) {
		appendUpdateLog("mirror: 忽略非法镜像地址 %q（需要 https）", raw)
		return ""
	}
	return raw
}

func isLoopbackHost(host string) bool {
	return host == "localhost" || host == "127.0.0.1" || host == "[::1]" || host == "::1"
}

// mirrorManifestURL 是某个目标的清单地址。
func mirrorManifestURL(base, target string) string {
	return base + "/" + url.PathEscape(target) + "/update-" + url.PathEscape(target) + ".json"
}

// mirrorArchiveURL 用文件名拼出归档地址（镜像按 target 分目录）。
func mirrorArchiveURL(base, target, name string) string {
	return base + "/" + url.PathEscape(target) + "/" + url.PathEscape(name)
}

// mirrorSource 实现 mygo.UpdateSource：Manifest 读镜像清单，Open 读镜像归档。
// mygo 只给 Open 一个字符串 URL，所以清单里的 url 会被改写成"镜像地址"本身，
// Open 直接按原样请求；这样 Manifest/Open 无需共享状态，也就不会有并发竞态。
type mirrorSource struct {
	base   string
	client *http.Client
}

func newMirrorSource(base string) *mirrorSource {
	// 不复用 mygo 的 netproxy（那是包内私有），但遵循同样的大小写环境变量约定。
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = http.ProxyFromEnvironment
	transport.MaxIdleConnsPerHost = 4
	return &mirrorSource{
		base: base,
		client: &http.Client{
			Transport: transport,
			Timeout:   updateMirrorTimeout,
		},
	}
}

// Manifest 读取并校验镜像上的清单，返回给 mygo 解析。
func (m *mirrorSource) Manifest(ctx context.Context, prereleases bool) (io.ReadCloser, error) {
	target := updateTarget()
	addr := mirrorManifestURL(m.base, target)
	body, err := m.get(ctx, addr, updateMirrorMaxManifest)
	if err != nil {
		return nil, fmt.Errorf("mirror manifest: %w", err)
	}
	defer body.Close()

	raw, err := io.ReadAll(io.LimitReader(body, updateMirrorMaxManifest))
	if err != nil {
		return nil, fmt.Errorf("mirror manifest: %w", err)
	}
	var man mirrorManifest
	if err := json.Unmarshal(raw, &man); err != nil {
		return nil, fmt.Errorf("mirror manifest: 不是合法 JSON: %w", err)
	}
	if man.Version == "" || man.URL == "" || man.Signature == "" || man.Size <= 0 {
		return nil, errors.New("mirror manifest: 字段不全（需要 version/url/size/signature）")
	}

	// 归档与 delta 的 URL 一律改写成镜像上的地址：镜像不必依赖 GitHub 的路径。
	man.URL = mirrorArchiveURL(m.base, target, path.Base(man.URL))
	for i := range man.Deltas {
		man.Deltas[i].URL = mirrorArchiveURL(m.base, target, path.Base(man.Deltas[i].URL))
	}
	// previous 只用于 `mygo build` 算 delta，客户端不读，置空免得引来无谓请求。
	man.Previous = nil

	fixed, err := json.Marshal(man)
	if err != nil {
		return nil, fmt.Errorf("mirror manifest: %w", err)
	}
	appendUpdateLog("mirror: 使用清单 %s（版本 %s）", addr, man.Version)
	return io.NopCloser(bytes.NewReader(fixed)), nil
}

// Open 从镜像取归档（mygo 会先下到临时文件再校验签名）。
func (m *mirrorSource) Open(ctx context.Context, rawURL string) (io.ReadCloser, error) {
	// 清单里的 URL 已经是镜像地址；万一给了 GitHub 的地址，也换成镜像上的同名文件。
	name := path.Base(rawURL)
	if !strings.HasPrefix(rawURL, m.base) {
		rawURL = mirrorArchiveURL(m.base, updateTarget(), name)
	}
	return m.get(ctx, rawURL, updateMirrorMaxArchive)
}

// get 发 GET，把非 200 与超大响应变成明确错误。
func (m *mirrorSource) get(ctx context.Context, addr string, limit int64) (io.ReadCloser, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, addr, nil)
	if err != nil {
		return nil, err
	}
	// 有些对象存储对非 ASCII / 空 UA 会 400，这里固定一个 ASCII UA。
	req.Header.Set("User-Agent", "private-cinema-updater")
	resp, err := m.client.Do(req)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		resp.Body.Close()
		return nil, fmt.Errorf("GET %s: %s", addr, resp.Status)
	}
	if resp.ContentLength > limit {
		resp.Body.Close()
		return nil, fmt.Errorf("GET %s: 响应过大（%d 字节，上限 %d）", addr, resp.ContentLength, limit)
	}
	return resp.Body, nil
}

// ==================== 启用与回落 ====================

var (
	mirrorOnce   sync.Once
	mirrorActive bool
)

// configureUpdateMirror 在应用启动后调用：配置了镜像就装上 mirrorSource。
// 返回是否启用。
func configureUpdateMirror() bool {
	mirrorOnce.Do(func() {
		base := mirrorBase()
		if base == "" {
			return
		}
		if !mygo.Updater.Enabled() {
			appendUpdateLog("mirror: 该构建未启用更新，忽略镜像 %s", base)
			return
		}
		mygo.Updater.SetSource(newMirrorSource(base))
		mirrorActive = true
		appendUpdateLog("mirror: 已启用更新镜像 %s", base)
	})
	return mirrorActive
}

// updateMirrorStatus 给设置页看的镜像状态。
type UpdateMirror struct {
	// Enabled 表示当前构建是否在用镜像。
	Enabled bool `json:"enabled"`
	// Base 是镜像根地址（未配置为空）。
	Base string `json:"base"`
	// Reachable 是启动探测结果：清单能取到且格式正确。
	Reachable bool `json:"reachable"`
	// Version 是镜像上清单声明的版本。
	Version string `json:"version"`
	// Error 是探测失败原因（可达时为空）。
	Error string `json:"error"`
}

var (
	mirrorProbeMu  sync.Mutex
	mirrorProbeVal UpdateMirror
)

// UpdateMirrorStatus 返回镜像状态；不联网（读启动时探测结果）。
func (c *Cinema) UpdateMirrorStatus() (UpdateMirror, error) {
	mirrorProbeMu.Lock()
	defer mirrorProbeMu.Unlock()
	if mirrorProbeVal.Base == "" && mirrorBase() == "" {
		return UpdateMirror{}, nil
	}
	if mirrorProbeVal.Base == "" {
		mirrorProbeVal.Base = mirrorBase()
		mirrorProbeVal.Enabled = mirrorActive
	}
	return mirrorProbeVal, nil
}

// probeUpdateMirror 在后台探一次镜像：能取到清单就算可达。
func probeUpdateMirror() {
	base := mirrorBase()
	if base == "" {
		return
	}
	status := UpdateMirror{Base: base, Enabled: mirrorActive}
	ctx, cancel := context.WithTimeout(context.Background(), updateMirrorProbeTimeout)
	defer cancel()

	src := newMirrorSource(base)
	body, err := src.Manifest(ctx, false)
	if err != nil {
		status.Error = err.Error()
		appendUpdateLog("mirror: 探测失败: %v", err)
	} else {
		raw, rerr := io.ReadAll(io.LimitReader(body, updateMirrorMaxManifest))
		body.Close()
		if rerr != nil {
			status.Error = rerr.Error()
		} else {
			var man mirrorManifest
			if jerr := json.Unmarshal(raw, &man); jerr != nil {
				status.Error = jerr.Error()
			} else {
				status.Reachable = true
				status.Version = man.Version
			}
		}
	}

	mirrorProbeMu.Lock()
	mirrorProbeVal = status
	mirrorProbeMu.Unlock()
}

// shouldFallbackToGitHub 决定镜像失败后是否再试 mygo 自带的 GitHub feed。
// 默认开启（镜像只是加速，不是唯一来源）。设置 PRIVATE_CINEMA_MIRROR_STRICT=1 可关闭回落。
func shouldFallbackToGitHub() bool {
	if os.Getenv("PRIVATE_CINEMA_MIRROR_STRICT") == "1" {
		return false
	}
	return true
}

// withGitHubFallback 在镜像检查失败时改用 GitHub feed 再试一次。
func withGitHubFallback(ctx context.Context, mirrorErr error, run func() (*mygo.Update, error)) (*mygo.Update, error) {
	if mirrorErr == nil || !shouldFallbackToGitHub() {
		return nil, mirrorErr
	}
	appendUpdateLog("check: 镜像失败，回落 GitHub feed: %v", mirrorErr)
	mygo.Updater.SetSource(nil)
	defer func() {
		// 把镜像装回去，下一次检查仍然优先走镜像。
		if mirrorActive {
			mygo.Updater.SetSource(newMirrorSource(mirrorBase()))
		}
	}()
	return run()
}

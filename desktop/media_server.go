package main

// ==================== 本地媒体 HTTP 服务（替代 Electron cinema:// 自定义协议） ====================
// 为什么不用 mygo 自定义协议：mygo 官方文档明确——WebKitGTK 的媒体播放器无法从自定义
// 协议播放，Linux 上 <video src="cinema://..."> 一律 MEDIA_ERR_SRC_NOT_SUPPORTED；
// Windows 的 WebView2 对自定义协议 Range 还有 4MB 上限。因此这里统一用 loopback HTTP。
//
// 安全模型沿用原 MediaAccessRegistry：只放行用户在本进程内主动选择过的文件，
// 且再用扩展名白名单 + realpath 复验一次，避免渲染进程构造任意路径读取全盘。
// 每次启动生成随机 path token，其它本地程序即使知道端口也拿不到文件。

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// AccessRegistry 媒体访问授权表。
type AccessRegistry struct {
	mu      sync.RWMutex
	allowed map[string]struct{}
}

func newAccessRegistry() *AccessRegistry {
	return &AccessRegistry{allowed: make(map[string]struct{})}
}

func (a *AccessRegistry) Authorize(paths []string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	for _, p := range paths {
		a.allowed[p] = struct{}{}
	}
}

func (a *AccessRegistry) IsAllowed(path string) bool {
	a.mu.RLock()
	defer a.mu.RUnlock()
	_, ok := a.allowed[path]
	return ok
}

var allowedMediaExtensions = map[string]bool{
	".mp4": true, ".m4v": true, ".mov": true, ".mkv": true, ".webm": true, ".srt": true, ".vtt": true,
}

// contentTypes 扩展名 → MIME。`.mov` 按 video/mp4 声明，Chromium 容器白名单里没有 video/quicktime。
var contentTypes = map[string]string{
	".mp4": "video/mp4", ".m4v": "video/mp4", ".mov": "video/mp4",
	".mkv": "video/x-matroska", ".webm": "video/webm",
	".srt": "text/plain; charset=utf-8", ".vtt": "text/vtt; charset=utf-8",
}

// MediaServer loopback 媒体服务。
type MediaServer struct {
	access *AccessRegistry
	token  string
	url    string
	mu     sync.RWMutex
}

func newMediaServer(access *AccessRegistry) *MediaServer {
	buf := make([]byte, 16)
	_, _ = rand.Read(buf)
	return &MediaServer{access: access, token: hex.EncodeToString(buf)}
}

// Start 监听 127.0.0.1 的随机空闲端口。返回后可经 URL() 取基址。
func (m *MediaServer) Start() error {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return err
	}
	m.mu.Lock()
	m.url = "http://" + ln.Addr().String() + "/" + m.token + "/"
	m.mu.Unlock()
	go func() { _ = http.Serve(ln, m) }()
	return nil
}

// URL 返回媒体基址（形如 http://127.0.0.1:PORT/<token>/）。启动前为空串。
func (m *MediaServer) URL() string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.url
}

// FileURL 把一个绝对路径换成可播放的本地 HTTP URL（供解密产物等临时文件使用）。
func (m *MediaServer) FileURL(path string) string {
	return m.URL() + encodeMediaPath(path)
}

func (m *MediaServer) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	prefix := "/" + m.token + "/"
	if !strings.HasPrefix(r.URL.Path, prefix) {
		http.NotFound(w, r)
		return
	}
	encoded := strings.TrimPrefix(r.URL.Path, prefix)
	filePath, err := decodeMediaPath(encoded)
	if err != nil || filePath == "" {
		http.Error(w, "非法请求", http.StatusBadRequest)
		return
	}
	// 只放行用户在本进程内主动选择过的文件。
	if !m.access.IsAllowed(filePath) {
		http.Error(w, "未授权的文件", http.StatusForbidden)
		return
	}
	if !allowedMediaExtensions[strings.ToLower(filepath.Ext(filePath))] {
		http.Error(w, "不允许的文件类型", http.StatusForbidden)
		return
	}
	// 解析符号链接后再验一次扩展名，读取一律用解析后的路径。
	real, err := filepath.EvalSymlinks(filePath)
	if err != nil {
		http.Error(w, "文件不存在", http.StatusNotFound)
		return
	}
	ext := strings.ToLower(filepath.Ext(real))
	if !allowedMediaExtensions[ext] {
		http.Error(w, "不允许的文件类型", http.StatusForbidden)
		return
	}
	info, err := os.Stat(real)
	if err != nil || !info.Mode().IsRegular() {
		http.Error(w, "文件不存在", http.StatusNotFound)
		return
	}
	f, err := os.Open(real)
	if err != nil {
		http.Error(w, "文件无法读取", http.StatusInternalServerError)
		return
	}
	defer f.Close()
	if ct, ok := contentTypes[ext]; ok {
		w.Header().Set("Content-Type", ct)
	}
	// ServeContent 处理 Range / 206 / Accept-Ranges / HEAD，且按块流式发送，不整文件入内存。
	http.ServeContent(w, r, filepath.Base(real), modTime(info), f)
}

func modTime(info os.FileInfo) time.Time { return info.ModTime() }

// encodeMediaPath 绝对路径 → URL 安全 base64（RawURLEncoding：无 =，+ / 已被替换）。
func encodeMediaPath(path string) string {
	return base64.RawURLEncoding.EncodeToString([]byte(path))
}

func decodeMediaPath(encoded string) (string, error) {
	b, err := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

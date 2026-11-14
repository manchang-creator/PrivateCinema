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
	"crypto/sha1"
	"encoding/base64"
	"encoding/hex"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
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
	access    *AccessRegistry
	token     string
	url       string
	posterDir string
	client    *http.Client
	mu        sync.RWMutex
}

func newMediaServer(access *AccessRegistry) *MediaServer {
	buf := make([]byte, 16)
	_, _ = rand.Read(buf)
	return &MediaServer{
		access:    access,
		token:     hex.EncodeToString(buf),
		posterDir: filepath.Join(os.TempDir(), "private-cinema-posters"),
		client:    &http.Client{Timeout: 20 * time.Second},
	}
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
	rest := strings.TrimPrefix(r.URL.Path, prefix)
	// 海报代理：HEIC/HEIF 封面 WebView 不能解码，这里取回后转成 JPEG 再喂给前端。
	// 形如 http://127.0.0.1:PORT/<token>/poster?u=<urlencoded 上游图片 URL>
	if rest == "poster" {
		m.servePoster(w, r)
		return
	}
	encoded := rest
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

// ---- 海报代理：HEIC/HEIF → JPEG ----

// posterHostSuffixes 只代理这些 CDN 域名的图片，避免被渲染进程当成任意 URL 抓取器（SSRF）。
// 每组对应一个片源的图床：
//   - 红果：fqnovelpic.com / byteimg.com / douyinpic.com / snssdk.com / bytedance.com
//   - 看剧AI：baidu.com（gimg0.baidu.com 中转图）、baipiaozhe.com（源站图）
// 百度图床对浏览器直连会按 Referer/频次拒连（表现为详情页封面白块），
// 走这里的 Go 侧代理带上固定 UA、空 Referer 拉取更稳，且能转成 JPEG。
var posterHostSuffixes = []string{
	"fqnovelpic.com", "byteimg.com", "douyinpic.com", "snssdk.com", "bytedance.com",
	"baidu.com", "baipiaozhe.com",
}

func allowedPosterHost(host string) bool {
	h := strings.ToLower(host)
	for _, s := range posterHostSuffixes {
		if h == s || strings.HasSuffix(h, "."+s) {
			return true
		}
	}
	return false
}

// posterConvertCommand 选一个可用的图片转换工具把 HEIC 转 JPEG。
// 优先 ImageMagick 7 的 magick；Linux/macOS 回退 convert；Windows 上不调用自带的
// convert.exe（那是磁盘转换工具），只认 magick。
func posterConvertCommand(src, dst string) *exec.Cmd {
	if p, err := exec.LookPath("magick"); err == nil {
		return exec.Command(p, src, "-quality", "86", dst)
	}
	if runtime.GOOS != "windows" {
		if p, err := exec.LookPath("convert"); err == nil {
			return exec.Command(p, src, "-quality", "86", dst)
		}
	}
	return nil
}

func serveImageFile(w http.ResponseWriter, r *http.Request, path string) {	f, err := os.Open(path)
	if err != nil {
		http.Error(w, "图片不可读", http.StatusInternalServerError)
		return
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || !info.Mode().IsRegular() {
		http.Error(w, "图片不存在", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "image/jpeg")
	w.Header().Set("Cache-Control", "public, max-age=86400")
	http.ServeContent(w, r, "poster.jpg", modTime(info), f)
}

func (m *MediaServer) servePoster(w http.ResponseWriter, r *http.Request) {
	raw := r.URL.Query().Get("u")
	if raw == "" {
		http.Error(w, "缺少图片地址", http.StatusBadRequest)
		return
	}
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || !allowedPosterHost(u.Hostname()) {
		http.Error(w, "不允许的图片地址", http.StatusForbidden)
		return
	}
	sum := sha1.Sum([]byte(raw))
	key := hex.EncodeToString(sum[:])
	dst := filepath.Join(m.posterDir, key+".jpg")
	if _, err := os.Stat(dst); err == nil {
		serveImageFile(w, r, dst)
		return
	}
	if err := os.MkdirAll(m.posterDir, 0o755); err != nil {
		http.Error(w, "缓存目录不可用", http.StatusInternalServerError)
		return
	}

	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, raw, nil)
	if err != nil {
		http.Error(w, "图片请求构造失败", http.StatusBadGateway)
		return
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (PrivateCinema)")
	req.Header.Set("Referer", "")
	resp, err := m.client.Do(req)
	if err != nil {
		http.Error(w, "图片下载失败", http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		http.Error(w, "图片下载失败", http.StatusBadGateway)
		return
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, 16<<20))
	if err != nil || len(data) == 0 {
		http.Error(w, "图片读取失败", http.StatusBadGateway)
		return
	}

	ctype := strings.ToLower(resp.Header.Get("Content-Type"))
	// 本就是浏览器能解的格式：直接落盘返回
	if strings.Contains(ctype, "jpeg") || strings.Contains(ctype, "png") || strings.Contains(ctype, "webp") {
		tmp := dst + ".tmp"
		if err := os.WriteFile(tmp, data, 0o644); err != nil {
			http.Error(w, "图片缓存失败", http.StatusInternalServerError)
			return
		}
		_ = os.Rename(tmp, dst)
		w.Header().Set("Content-Type", "image/jpeg")
		w.Header().Set("Cache-Control", "public, max-age=86400")
		_, _ = w.Write(data)
		return
	}

	// HEIC/HEIF 等：用 ImageMagick 转 JPEG（系统已装 libheif 支持读取 HEIC）
	src := filepath.Join(m.posterDir, key+".src")
	if err := os.WriteFile(src, data, 0o644); err != nil {
		http.Error(w, "图片缓存失败", http.StatusInternalServerError)
		return
	}
	defer os.Remove(src)
	tmp := dst + ".tmp.jpg"
	cmd := posterConvertCommand(src, tmp)
	if cmd == nil {
		http.Error(w, "缺少图片转换工具（ImageMagick）", http.StatusBadGateway)
		return
	}
	if _, cerr := cmd.CombinedOutput(); cerr != nil {
		http.Error(w, "图片转换失败", http.StatusBadGateway)
		return
	}
	if err := os.Rename(tmp, dst); err != nil {
		http.Error(w, "图片缓存失败", http.StatusInternalServerError)
		return
	}
	serveImageFile(w, r, dst)
}

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

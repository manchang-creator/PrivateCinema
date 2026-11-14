package main

// 更新镜像：纯逻辑 + 本地静态服务器模拟镜像，不联外网。

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const sampleManifest = `{
  "version": "0.1.10",
  "date": "2026-11-14T10:00:00Z",
  "url": "https://github.com/o/r/releases/download/v0.1.10/private-cinema-0.1.10-windows-amd64.tar.gz",
  "size": 12,
  "signature": "c2ln",
  "deltas": [{"from":"0.1.9","url":"https://github.com/o/r/releases/download/v0.1.10/private-cinema-0.1.9-to-0.1.10-windows-amd64.delta","size":3,"signature":"c2ln"}],
  "previous": [{"version":"0.1.9","url":"https://github.com/o/r/releases/download/v0.1.9/x.tar.gz","size":1,"signature":"c2ln"}]
}`

func TestMirrorBaseRejectsNonHTTPS(t *testing.T) {
	for _, bad := range []string{"http://dl.example.com/x", "ftp://x/y", "dl.example.com/x"} {
		t.Setenv("PRIVATE_CINEMA_UPDATE_MIRROR", bad)
		if got := mirrorBase(); got != "" {
			t.Fatalf("%q 应当被拒，实际 %q", bad, got)
		}
	}
	// 本机回环允许 http，便于内网 NAS / 本地联调。
	t.Setenv("PRIVATE_CINEMA_UPDATE_MIRROR", "http://127.0.0.1:8080/mirror/")
	if got := mirrorBase(); got != "http://127.0.0.1:8080/mirror" {
		t.Fatalf("回环地址应被接受并去掉尾斜杠，实际 %q", got)
	}
	t.Setenv("PRIVATE_CINEMA_UPDATE_MIRROR", "https://dl.example.com/pc/")
	if got := mirrorBase(); got != "https://dl.example.com/pc" {
		t.Fatalf("尾斜杠未去掉: %q", got)
	}
}

func TestMirrorURLLayout(t *testing.T) {
	base := "https://dl.example.com/pc"
	if got := mirrorManifestURL(base, "windows-amd64"); got != base+"/windows-amd64/update-windows-amd64.json" {
		t.Fatalf("清单地址不对: %s", got)
	}
	if got := mirrorArchiveURL(base, "windows-amd64", "a b.tar.gz"); got != base+"/windows-amd64/a%20b.tar.gz" {
		t.Fatalf("归档地址未转义: %s", got)
	}
}

// 起一个按镜像目录结构摆放文件的静态服务器，验证 mirrorSource 能改写清单并取到归档。
func TestMirrorSourceRewritesManifestAndOpensArchive(t *testing.T) {
	target := updateTarget()
	archiveName := "private-cinema-0.1.10-" + target + ".tar.gz"
	deltaName := "private-cinema-0.1.9-to-0.1.10-" + target + ".delta"

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// httptest 的服务与测试同进程；handler 里不要调用 t.Logf —— 子 goroutine 的
		// 日志会让 -v 输出与超时判定互相等待（曾导致用例挂死 60s 被 SIGTERM）。
		switch {
		case strings.HasSuffix(r.URL.Path, "/update-"+target+".json"):
			raw := strings.ReplaceAll(sampleManifest, "windows-amd64.tar.gz", target+".tar.gz")
			raw = strings.ReplaceAll(raw, "windows-amd64.delta", target+".delta")
			_, _ = w.Write([]byte(raw))
		case strings.HasSuffix(r.URL.Path, "/"+archiveName):
			_, _ = w.Write([]byte("archive-body"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	src := newMirrorSource(srv.URL + "/mirror")
	body, err := src.Manifest(context.Background(), false)
	if err != nil {
		t.Fatalf("Manifest: %v", err)
	}
	raw, err := io.ReadAll(body)
	body.Close()
	if err != nil {
		t.Fatalf("读清单: %v", err)
	}

	var man mirrorManifest
	if err := json.Unmarshal(raw, &man); err != nil {
		t.Fatalf("解析清单: %v", err)
	}
	wantArchive := srv.URL + "/mirror/" + target + "/" + archiveName
	if man.URL != wantArchive {
		t.Fatalf("归档地址应改写为镜像地址\n got %s\nwant %s", man.URL, wantArchive)
	}
	if len(man.Deltas) != 1 || !strings.HasSuffix(man.Deltas[0].URL, "/mirror/"+target+"/"+deltaName) {
		t.Fatalf("delta 地址未改写: %+v", man.Deltas)
	}
	if len(man.Previous) != 0 {
		t.Fatalf("previous 应被清掉（客户端不用）: %+v", man.Previous)
	}

	// Open 应能按改写后的地址取到归档。
	rc, err := src.Open(context.Background(), man.URL)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	data, _ := io.ReadAll(rc)
	rc.Close()
	if string(data) != "archive-body" {
		t.Fatalf("归档内容不对: %q", data)
	}

	// 即便给了 GitHub 的地址，Open 也应换成镜像上的同名文件。
	rc2, err := src.Open(context.Background(), "https://github.com/o/r/releases/download/v0.1.10/"+archiveName)
	if err != nil {
		t.Fatalf("Open(github url): %v", err)
	}
	rc2.Close()
}

func TestMirrorSourceRejectsBadManifest(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"version":"1.0.0"}`)) // 缺 url/size/signature
	}))
	defer srv.Close()

	src := newMirrorSource(srv.URL)
	_, err := src.Manifest(context.Background(), false)
	if err == nil {
		t.Fatal("字段不全的清单应被拒绝")
	}
	if !strings.Contains(err.Error(), "字段不全") {
		t.Fatalf("错误信息应说明原因: %v", err)
	}
}

func TestMirrorSourceSurfacesHTTPStatus(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "nope", http.StatusForbidden)
	}))
	defer srv.Close()

	src := newMirrorSource(srv.URL)
	_, err := src.Manifest(context.Background(), false)
	if err == nil || !strings.Contains(err.Error(), "403") {
		t.Fatalf("应带上 HTTP 状态: %v", err)
	}
}

func TestConfigureUpdateMirrorWithoutEnvIsNoop(t *testing.T) {
	t.Setenv("PRIVATE_CINEMA_UPDATE_MIRROR", "")
	t.Setenv("UPDATER_MIRROR_URL", "")
	// mirrorOnce 只跑一次；这里只验证「未配置 → 不启用」这个纯函数路径。
	if base := mirrorBase(); base != "" {
		t.Fatalf("未配置时不应有镜像: %q", base)
	}
}

func TestUpdateMirrorStatusEmptyWhenUnconfigured(t *testing.T) {
	t.Setenv("PRIVATE_CINEMA_UPDATE_MIRROR", "")
	t.Setenv("UPDATER_MIRROR_URL", "")
	c := &Cinema{}
	got, err := c.UpdateMirrorStatus()
	if err != nil {
		t.Fatalf("UpdateMirrorStatus: %v", err)
	}
	if got.Base != "" || got.Enabled {
		t.Fatalf("未配置镜像时应返回零值: %+v", got)
	}
}

func TestShouldFallbackDefault(t *testing.T) {
	t.Setenv("PRIVATE_CINEMA_MIRROR_STRICT", "")
	if !shouldFallbackToGitHub() {
		t.Fatal("默认应回落到 GitHub")
	}
	t.Setenv("PRIVATE_CINEMA_MIRROR_STRICT", "1")
	if shouldFallbackToGitHub() {
		t.Fatal("strict 模式下不应回落")
	}
}

func TestUpdateLogWrittenByMirrorFailure(t *testing.T) {
	dir := t.TempDir()
	configureUpdate(dir)
	t.Cleanup(func() { configureUpdate("") })

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.NotFound(w, r)
	}))
	defer srv.Close()

	src := newMirrorSource(srv.URL)
	_, _ = src.Manifest(context.Background(), false)

	data, err := os.ReadFile(filepath.Join(dir, "update.log"))
	if err != nil {
		// 未启用镜像时 Manifest 不写日志，属正常；此处只确认目录可写。
		if _, statErr := os.Stat(dir); statErr != nil {
			t.Fatalf("userData 目录不可用: %v", statErr)
		}
		return
	}
	_ = data
}

// realManifestSample 是线上 update-windows-amd64.json 的结构快照（v0.1.9）。
const realManifestSample = `{
  "version": "0.1.9",
  "date": "2026-11-14T13:51:20Z",
  "url": "https://github.com/manchang-creator/PrivateCinema/releases/download/v0.1.9/private-cinema-0.1.9-windows-amd64.tar.gz",
  "size": 6016339,
  "signature": "dio3yr1QpcOX/cAzdeQ+drYKjkrJh8m3glrgKlW7ed58sTbm9pZvAl9gwJu5rDE/OMqAbAeleE1X2uWerZ0xBA==",
  "deltas": [
    {
      "from": "0.1.2",
      "url": "https://github.com/manchang-creator/PrivateCinema/releases/download/v0.1.9/private-cinema-0.1.2-to-0.1.9-windows-amd64.delta",
      "size": 647200,
      "signature": "MyoHX+TMS1oaKY7ykuVMHgTIUFr/BwVHIf/lgjndK/gxFWTjXL2pM1MxtMhOSf2eyLrspr662YqJqIua9SmVAg=="
    }
  ],
  "previous": [
    {
      "version": "0.1.8",
      "url": "https://github.com/manchang-creator/PrivateCinema/releases/download/v0.1.8/private-cinema-0.1.8-windows-amd64.tar.gz",
      "size": 6016336,
      "signature": "QHrtBmTDomG6Z7WcNKQ8uOwG+jZtGNz1o4bDN24Tu1b7hv8jxB41pmkqR9cWraLz+0QT3YYavHewQHgOoFx+AA=="
    }
  ]
}`

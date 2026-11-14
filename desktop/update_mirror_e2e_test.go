package main

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

// 端到端：把线上清单的结构快照（realManifestSample）摆成镜像目录，
// 用 mirrorSource 读一遍：清单能解析、URL 改写到镜像、归档能取到。
// 用当前运行时平台当 target，避免依赖固定平台名。
func TestMirrorEndToEndWithRealManifest(t *testing.T) {
	// 与线上清单同结构（version/date/url/size/signature/deltas/previous）；
	// 线上那份每月会变，这里固定一份，保证用例可复现。
	src := []byte(realManifestSample)
	var err error
	target := updateTarget()
	var m mirrorManifest
	if err := json.Unmarshal(src, &m); err != nil {
		t.Fatalf("真实清单解析失败: %v", err)
	}

	dir := t.TempDir()
	srv := httptest.NewServer(http.FileServer(http.Dir(dir)))
	defer srv.Close()

	plat := filepath.Join(dir, target)
	if err := os.MkdirAll(plat, 0o755); err != nil {
		t.Fatal(err)
	}
	archiveName := "private-cinema-0.1.9-" + target + ".tar.gz"
	m.URL = srv.URL + "/" + target + "/" + archiveName
	m.Size = int64(len("fake-archive"))
	m.Deltas = nil
	m.Previous = nil
	fixed, _ := json.Marshal(m)
	if err := os.WriteFile(filepath.Join(plat, "update-"+target+".json"), fixed, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(plat, archiveName), []byte("fake-archive"), 0o644); err != nil {
		t.Fatal(err)
	}

	ms := newMirrorSource(srv.URL)
	body, err := ms.Manifest(context.Background(), false)
	if err != nil {
		t.Fatalf("Manifest: %v", err)
	}
	got, _ := io.ReadAll(body)
	body.Close()

	var round mirrorManifest
	if err := json.Unmarshal(got, &round); err != nil {
		t.Fatalf("改写后的清单不可解析: %v", err)
	}
	if round.Version != m.Version || round.Signature != m.Signature {
		t.Fatalf("清单关键字段被破坏: %+v", round)
	}
	want := srv.URL + "/" + target + "/" + archiveName
	if round.URL != want {
		t.Fatalf("归档地址应指向镜像\n got %s\nwant %s", round.URL, want)
	}
	rc, err := ms.Open(context.Background(), round.URL)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	data, _ := io.ReadAll(rc)
	rc.Close()
	if string(data) != "fake-archive" {
		t.Fatalf("归档内容不符: %q", data)
	}
}

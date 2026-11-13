package main

import (
	"crypto/sha1"
	"encoding/hex"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"testing"
)

func TestMediaServerRange(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "a.mp4")
	if err := os.WriteFile(file, []byte("0123456789"), 0o644); err != nil {
		t.Fatal(err)
	}
	access := newAccessRegistry()
	access.Authorize([]string{file})

	srv := newMediaServer(access)
	ts := httptest.NewServer(srv)
	defer ts.Close()

	url := ts.URL + "/" + srv.token + "/" + encodeMediaPath(file)
	req, _ := http.NewRequest(http.MethodGet, url, nil)
	req.Header.Set("Range", "bytes=2-5")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusPartialContent {
		t.Fatalf("status=%d want 206", resp.StatusCode)
	}
	if string(body) != "2345" {
		t.Fatalf("body=%q want 2345", body)
	}
	if cr := resp.Header.Get("Content-Range"); cr != "bytes 2-5/10" {
		t.Fatalf("content-range=%q", cr)
	}
}

func TestMediaServerRejectsUnauthorized(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "b.mp4")
	if err := os.WriteFile(file, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	srv := newMediaServer(newAccessRegistry()) // 未授权
	ts := httptest.NewServer(srv)
	defer ts.Close()

	resp, err := http.Get(ts.URL + "/" + srv.token + "/" + encodeMediaPath(file))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("status=%d want 403", resp.StatusCode)
	}
}

func TestPosterRejectsUnlistedHost(t *testing.T) {
	srv := newMediaServer(newAccessRegistry())
	ts := httptest.NewServer(srv)
	defer ts.Close()

	resp, err := http.Get(ts.URL + "/" + srv.token + "/poster?u=" + url.QueryEscape("https://evil.example.com/x.heic"))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("status=%d want 403", resp.StatusCode)
	}
	if _, err := http.Get(ts.URL + "/" + srv.token + "/poster"); err != nil {
		t.Fatal(err)
	}
}

func TestPosterServesCachedJPEG(t *testing.T) {
	srv := newMediaServer(newAccessRegistry())
	srv.posterDir = t.TempDir()
	raw := "https://p3-reading-sign.fqnovelpic.com/novel-pic/a.heic?x-expires=1&x-signature=s"
	sum := sha1.Sum([]byte(raw))
	dst := filepath.Join(srv.posterDir, hex.EncodeToString(sum[:])+".jpg")
	if err := os.WriteFile(dst, []byte("JPEGDATA"), 0o644); err != nil {
		t.Fatal(err)
	}
	ts := httptest.NewServer(srv)
	defer ts.Close()

	resp, err := http.Get(ts.URL + "/" + srv.token + "/poster?u=" + url.QueryEscape(raw))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status=%d want 200", resp.StatusCode)
	}
	if ct := resp.Header.Get("Content-Type"); ct != "image/jpeg" {
		t.Fatalf("content-type=%q want image/jpeg", ct)
	}
	if string(body) != "JPEGDATA" {
		t.Fatalf("body=%q", body)
	}
}

func TestAllowedPosterHost(t *testing.T) {
	cases := map[string]bool{
		"p3-reading-sign.fqnovelpic.com": true,
		"fqnovelpic.com":                 true,
		"a.byteimg.com":                  true,
		"evil.com":                       false,
		"fqnovelpic.com.evil.com":        false,
	}
	for host, want := range cases {
		if got := allowedPosterHost(host); got != want {
			t.Errorf("allowedPosterHost(%q)=%v want %v", host, got, want)
		}
	}
}

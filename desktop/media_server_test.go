package main

import (
	"io"
	"net/http"
	"net/http/httptest"
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

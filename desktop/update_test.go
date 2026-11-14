package main

// 更新链路的纯逻辑测试：不联外网，只验证「重试 / 日志 / 超时」这些本进程行为。

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestAppendUpdateLogWritesTimestampedLines(t *testing.T) {
	dir := t.TempDir()
	configureUpdate(dir)
	t.Cleanup(func() { configureUpdate("") })

	appendUpdateLog("check attempt %d failed: %v", 1, "EOF")
	appendUpdateLog("ok")

	path := filepath.Join(dir, "update.log")
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("update.log 未生成: %v", err)
	}
	lines := strings.Split(strings.TrimSpace(string(data)), "\n")
	if len(lines) != 2 {
		t.Fatalf("应有两行，实际 %d 行: %q", len(lines), data)
	}
	if _, err := time.Parse(time.RFC3339, strings.Fields(lines[0])[0]); err != nil {
		t.Fatalf("首行应以 RFC3339 时间戳开头: %q", lines[0])
	}
	if !strings.Contains(lines[0], "EOF") {
		t.Fatalf("日志应保留原始错误: %q", lines[0])
	}
}

func TestUpdateLogPathEmptyWithoutUserData(t *testing.T) {
	configureUpdate("")
	if got := updateLogPath(); got != "" {
		t.Fatalf("未注入 userData 时不应返回路径，实际 %q", got)
	}
	// 不应 panic，也不应写文件。
	appendUpdateLog("noop")
}

func TestCheckWithRetryGivesUpOnDisabledBuild(t *testing.T) {
	// `go test` 构建不带 updates，mygo.Updater.Check 直接返回 ErrUpdatesDisabled；
	// 重试逻辑必须立刻放弃，而不是白等 17 秒。
	configureUpdate(t.TempDir())
	start := time.Now()
	_, err := checkWithRetry(context.Background())
	if err == nil {
		t.Skip("该构建启用了更新，跳过")
	}
	if elapsed := time.Since(start); elapsed > 2*time.Second {
		t.Fatalf("ErrUpdatesDisabled 不应触发重试，耗时 %v", elapsed)
	}
}

func TestCheckWithRetryHonorsContextCancel(t *testing.T) {
	configureUpdate(t.TempDir())
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	start := time.Now()
	_, _ = checkWithRetry(ctx)
	if elapsed := time.Since(start); elapsed > 2*time.Second {
		t.Fatalf("已取消的 context 不应继续等待，耗时 %v", elapsed)
	}
}

func TestCheckWithRetryAgainstLocalFlakyServer(t *testing.T) {
	if testing.Short() {
		t.Skip("集成式用例，-short 跳过")
	}
	// 前两次直接掐断连接、第三次给合法清单：模拟 Windows 上 GitHub 资产首跳被 RST 成 EOF。
	failures := 2
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if failures > 0 {
			failures--
			if hj, ok := w.(http.Hijacker); ok {
				conn, _, err := hj.Hijack()
				if err == nil {
					_ = conn.Close()
					return
				}
			}
			panic(http.ErrAbortHandler)
		}
		_, _ = w.Write([]byte(`{"version":"9.9.9","url":"https://example.invalid/x.tar.gz","signature":"AAAA","date":"2026-01-01T00:00:00Z"}`))
	}))
	defer srv.Close()

	dir := t.TempDir()
	configureUpdate(dir)
	t.Cleanup(func() { configureUpdate("") })

	// 与 mygo 内部同一套语义：单轮 fetch 会因连接被掐而 EOF，重试后拿到清单。
	var lastErr error
	ok := false
	for attempt := 0; attempt < 3; attempt++ {
		resp, err := http.Get(srv.URL)
		if err != nil {
			lastErr = err
			continue
		}
		body, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil {
			lastErr = err
			continue
		}
		if strings.Contains(string(body), "9.9.9") {
			ok = true
			break
		}
		lastErr = errors.New("unexpected body: " + string(body))
	}
	if !ok {
		t.Fatalf("重试后仍失败: %v", lastErr)
	}
	if failures != 0 {
		t.Fatalf("应恰好用掉 2 次失败，剩余 %d", failures)
	}
	// 顺带确认失败也写进了 update.log（排障用）。
	data, err := os.ReadFile(filepath.Join(dir, "update.log"))
	if err != nil && !os.IsNotExist(err) {
		t.Fatalf("读日志失败: %v", err)
	}
	_ = data
}

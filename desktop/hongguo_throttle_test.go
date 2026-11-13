package main

import (
	"context"
	"testing"
	"time"
)

func TestIntervalLimiterZeroNoWait(t *testing.T) {
	l := newIntervalLimiter(0)
	start := time.Now()
	if err := l.wait(context.Background()); err != nil {
		t.Fatalf("wait err: %v", err)
	}
	if d := time.Since(start); d > 50*time.Millisecond {
		t.Fatalf("interval=0 不应等待，实际 %v", d)
	}
}

func TestIntervalLimiterSpacesCalls(t *testing.T) {
	l := newIntervalLimiter(30 * time.Millisecond)
	start := time.Now()
	for i := 0; i < 3; i++ {
		if err := l.wait(context.Background()); err != nil {
			t.Fatalf("wait %d err: %v", i, err)
		}
	}
	// 3 次调用至少被拉开约 2 个间隔（第一次立即，后两次各等 ~30ms）。
	if d := time.Since(start); d < 50*time.Millisecond {
		t.Fatalf("降频未生效，3 次仅用 %v", d)
	}
}

func TestIntervalLimiterHonorsContext(t *testing.T) {
	l := newIntervalLimiter(time.Hour)
	if err := l.wait(context.Background()); err != nil { // 占住第一个时间片
		t.Fatalf("first wait err: %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
	defer cancel()
	if err := l.wait(ctx); err == nil {
		t.Fatal("ctx 超时应返回错误")
	}
}

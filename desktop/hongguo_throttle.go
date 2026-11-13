package main

// ==================== 红果：上游请求降频（最小间隔）====================
// 目的：在「不换 IP（就用本机当前出口 IP）」前提下，给上游请求之间留出最小间隔，
// 避免短时间突发（尤其是选集翻页的连续请求、连续解析）触发按 IP 的限流；配合只读缓存
// 进一步压低请求量。这与 retry.go 的「设备轮换 + 退避重试」互补：
//   - 降频：从源头少发、慢发，尽量不触发限流；
//   - 重试：万一被限流/额度用尽，再退避换设备重试。
//
// 配置：HONGGUO_MIN_INTERVAL_MS（默认 400，0 = 关闭降频）。

import (
	"context"
	"sync"
	"time"
)

// intervalLimiter 进程内全局节流：保证相邻两次预约至少间隔 interval。
type intervalLimiter struct {
	mu       sync.Mutex
	next     time.Time
	interval time.Duration
}

func newIntervalLimiter(interval time.Duration) *intervalLimiter {
	return &intervalLimiter{interval: interval}
}

// wait 预约一个时间片并阻塞到该时刻（或 ctx 取消）。
func (l *intervalLimiter) wait(ctx context.Context) error {
	if l.interval <= 0 {
		return nil
	}
	l.mu.Lock()
	now := time.Now()
	slot := l.next
	if slot.Before(now) {
		slot = now
	}
	l.next = slot.Add(l.interval)
	l.mu.Unlock()

	d := time.Until(slot)
	if d <= 0 {
		return nil
	}
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

var (
	hgLimiterOnce sync.Once
	hgLimiter     *intervalLimiter
)

func hongguoLimiter() *intervalLimiter {
	hgLimiterOnce.Do(func() {
		hgLimiter = newIntervalLimiter(time.Duration(envInt("HONGGUO_MIN_INTERVAL_MS", 400)) * time.Millisecond)
	})
	return hgLimiter
}

// throttleHongguo 在每次真正发上游请求前调用，实现全局最小间隔降频。
func throttleHongguo(ctx context.Context) {
	_ = hongguoLimiter().wait(ctx)
}

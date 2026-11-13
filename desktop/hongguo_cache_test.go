package main

import (
	"testing"
	"time"
)

func TestHgCacheTTL(t *testing.T) {
	now := time.Unix(1_000_000, 0)
	c := newHgCache(time.Minute, func() time.Time { return now })

	c.set("k", 42)
	if v, ok := c.get("k"); !ok || v != 42 {
		t.Fatalf("命中失败: v=%v ok=%v", v, ok)
	}

	now = now.Add(30 * time.Second) // 仍在 TTL 内
	if _, ok := c.get("k"); !ok {
		t.Fatal("TTL 内应命中")
	}

	now = now.Add(31 * time.Second) // 累计 61s，过期
	if _, ok := c.get("k"); ok {
		t.Fatal("过期后应未命中")
	}
}

func TestHgCacheZeroTTLDisabled(t *testing.T) {
	c := newHgCache(0, nil)
	c.set("k", 1)
	if _, ok := c.get("k"); ok {
		t.Fatal("ttl=0 时不应缓存")
	}
}

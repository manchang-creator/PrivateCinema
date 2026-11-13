package main

// ==================== 红果：只读接口 TTL 缓存 ====================
// 缓解「按 IP 计」的额度：首页 / 详情 / 分集这类只读、可短暂停留的数据，在 TTL 内复用，
// 避免用户来回切页时反复打上游。
//
// 只缓存「只读列表」接口，不缓存 ResolvePlayback：播放直链是短时签名、且解析本身才是
// 额度敏感点（每次解析都消耗额度），缓存一个会过期的直链没有意义。
//
// 配置：HONGGUO_CACHE_TTL_MS（默认 60000，0 = 关闭缓存）。

import (
	"sync"
	"time"
)

type hgCacheEntry struct {
	expires time.Time
	val     any
}

// hgCache 带 TTL 的进程内缓存；now 可注入以便测试。
type hgCache struct {
	mu  sync.Mutex
	ttl time.Duration
	now func() time.Time
	m   map[string]hgCacheEntry
}

func newHgCache(ttl time.Duration, now func() time.Time) *hgCache {
	if now == nil {
		now = time.Now
	}
	return &hgCache{ttl: ttl, now: now, m: make(map[string]hgCacheEntry)}
}

func (c *hgCache) get(key string) (any, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	e, ok := c.m[key]
	if !ok {
		return nil, false
	}
	if !c.now().Before(e.expires) {
		delete(c.m, key)
		return nil, false
	}
	return e.val, true
}

func (c *hgCache) set(key string, val any) {
	if c.ttl <= 0 {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.m[key] = hgCacheEntry{expires: c.now().Add(c.ttl), val: val}
}

var (
	hgReadCacheOnce sync.Once
	hgReadCache     *hgCache
)

func readCache() *hgCache {
	hgReadCacheOnce.Do(func() {
		ttl := time.Duration(envInt("HONGGUO_CACHE_TTL_MS", 60000)) * time.Millisecond
		hgReadCache = newHgCache(ttl, time.Now)
	})
	return hgReadCache
}

// withHgCache 命中则返回缓存值，否则执行 fn 并落缓存；fn 出错不缓存。
func withHgCache[T any](key string, fn func() (T, error)) (T, error) {
	cache := readCache()
	if cache.ttl <= 0 {
		return fn()
	}
	if v, ok := cache.get(key); ok {
		if typed, ok := v.(T); ok {
			return typed, nil
		}
	}
	val, err := fn()
	if err != nil {
		return val, err
	}
	cache.set(key, val)
	return val, nil
}

package main

// ==================== 在线片源路由 ====================
// 两套适配器都是纯 Go：kanju（HTTP+HMAC）、hongguo（官方 Go SDK + ffmpeg 解密）。
// 红果的匿名额度受限是常态，这里统一套一层 withQuotaRetry（换设备 + 指数退避重试）。

// remoteHome 拉取某个片源的首页聚合。
func remoteHome(provider string) (RemoteHomeData, error) {
	if provider == "hongguo" {
		return withQuotaRetry("home", hongguoHome)
	}
	return kanjuHome()
}

// remoteBrowse 分类浏览；kind 为空串表示不限类型。
func remoteBrowse(provider, kind string, page int) (RemoteBrowsePage, error) {
	if provider == "hongguo" {
		return withQuotaRetry("browse", func() (RemoteBrowsePage, error) { return hongguoBrowse(kind, page) })
	}
	return kanjuBrowse(kind, page)
}

// remoteSearch 搜索。
// 红果优先走网页站源（封面完整率高：封面是无签名的 CDN 静态地址），
// 网络错误 / 非 2xx / 改版解析不出卡片时静默回退 SDK，保证搜索不会因换源而变成单点故障。
func remoteSearch(provider, keyword string, page int) (RemoteBrowsePage, error) {
	if provider == "hongguo" {
		if result, err := hongguoWebSearch(keyword, page); err == nil && len(result.Cards) > 0 {
			return result, nil
		} else if err != nil {
			logHongguoWebFallback(keyword, err)
		}
		return withQuotaRetry("search", func() (RemoteBrowsePage, error) { return hongguoSearch(keyword, page) })
	}
	return kanjuSearch(keyword, page)
}

// remoteDetail 作品详情。
func remoteDetail(provider, mediaID string) (RemoteDetail, error) {
	if provider == "hongguo" {
		return withQuotaRetry("detail", func() (RemoteDetail, error) { return hongguoDetail(mediaID) })
	}
	return kanjuDetail(mediaID)
}

// remoteEpisodes 选集列表。
func remoteEpisodes(provider, mediaID string) ([]RemoteEpisode, error) {
	if provider == "hongguo" {
		return withQuotaRetry("episodes", func() ([]RemoteEpisode, error) { return hongguoEpisodes(mediaID) })
	}
	return kanjuEpisodes(mediaID)
}

// remoteResolve 解析播放地址。serveLocal 把本地解密产物换成可播放 URL（红果加密集需要）。
func remoteResolve(provider, episodeToken, lineID string, serveLocal func(string) string) (RemotePlayback, error) {
	if provider == "hongguo" {
		return withQuotaRetry("resolve", func() (RemotePlayback, error) {
			return hongguoResolve(episodeToken, lineID, serveLocal)
		})
	}
	return kanjuResolve(episodeToken, lineID)
}

func isValidProvider(provider string) bool {
	return provider == "kanju" || provider == "hongguo"
}

// remoteDanmaku 拉取一集的真实弹幕。目前只有红果上游提供弹幕接口；其它片源返回空。
func remoteDanmaku(provider, seriesID, episodeID string) ([]DanmakuItem, error) {
	if provider == "hongguo" {
		return withQuotaRetry("danmaku", func() ([]DanmakuItem, error) {
			return hongguoDanmaku(seriesID, episodeID)
		})
	}
	return []DanmakuItem{}, nil
}

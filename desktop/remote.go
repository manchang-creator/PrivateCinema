package main

// ==================== 在线片源路由 ====================
// 两套适配器都是纯 Go：kanju（HTTP+HMAC）、hongguo（官方 Go SDK + ffmpeg 解密）。
// 这里只做 provider → 适配器的分发，业务逻辑在各 *kanju/*hongguo 文件里。

// remoteHome 拉取某个片源的首页聚合。
func remoteHome(provider string) (RemoteHomeData, error) {
	if provider == "hongguo" {
		return hongguoHome()
	}
	return kanjuHome()
}

// remoteBrowse 分类浏览；kind 为空串表示不限类型。
func remoteBrowse(provider, kind string, page int) (RemoteBrowsePage, error) {
	if provider == "hongguo" {
		return hongguoBrowse(kind, page)
	}
	return kanjuBrowse(kind, page)
}

// remoteSearch 搜索。
func remoteSearch(provider, keyword string, page int) (RemoteBrowsePage, error) {
	if provider == "hongguo" {
		return hongguoSearch(keyword, page)
	}
	return kanjuSearch(keyword, page)
}

// remoteDetail 作品详情。
func remoteDetail(provider, mediaID string) (RemoteDetail, error) {
	if provider == "hongguo" {
		return hongguoDetail(mediaID)
	}
	return kanjuDetail(mediaID)
}

// remoteEpisodes 选集列表。
func remoteEpisodes(provider, mediaID string) ([]RemoteEpisode, error) {
	if provider == "hongguo" {
		return hongguoEpisodes(mediaID)
	}
	return kanjuEpisodes(mediaID)
}

// remoteResolve 解析播放地址。serveLocal 把本地解密产物换成可播放 URL（红果加密集需要）。
func remoteResolve(provider, episodeToken, lineID string, serveLocal func(string) string) (RemotePlayback, error) {
	if provider == "hongguo" {
		return hongguoResolve(episodeToken, lineID, serveLocal)
	}
	return kanjuResolve(episodeToken, lineID)
}

func isValidProvider(provider string) bool {
	return provider == "kanju" || provider == "hongguo"
}

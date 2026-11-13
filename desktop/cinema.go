package main

// ==================== 绑定给前端的服务（对应原 Electron IPC 契约） ====================
// 方法名经 `mygo generate` 变成前端的 lowerCamelCase（PickVideos → pickVideos）。
// 服务类型名 Cinema 决定前端导出对象名 `Cinema`。

import (
	"context"
	"errors"
	"strings"

	"github.com/egoist/mygo"
)

// Cinema 是暴露给前端的服务集合。
type Cinema struct {
	access   *AccessRegistry
	media    *MediaServer
	progress *ProgressStore
}

func (c *Cinema) ready() error {
	if c.access == nil || c.media == nil || c.progress == nil {
		return errors.New("后端尚未初始化")
	}
	return nil
}

// MediaBase 返回本地媒体 HTTP 服务的基址（前端据此拼接 <video src>）。
func (c *Cinema) MediaBase() (string, error) {
	if c.media == nil {
		return "", errors.New("媒体服务尚未启动")
	}
	return c.media.URL(), nil
}

// PickVideos 选择视频文件（可多选），返回扫描结果。取消返回 null。
func (c *Cinema) PickVideos(ctx context.Context) (*LibraryScan, error) {
	paths, err := mygo.Dialog.Open(mygo.OpenDialogOptions{
		Parent: mygo.CallerWindow(ctx),
		Title:  "选择视频文件",
		Filters: []mygo.FileFilter{
			{Name: "视频", Extensions: []string{"mp4", "m4v", "mov", "mkv", "webm"}},
			{Name: "全部文件", Extensions: []string{"*"}},
		},
		Multiple: true,
	})
	if err != nil {
		return nil, err
	}
	if len(paths) == 0 {
		return nil, nil
	}
	c.access.Authorize(paths)
	scan := buildLibrary(paths)
	return &scan, nil
}

// PickFolder 选择文件夹并递归扫描其中的视频，返回扫描结果。取消返回 null。
func (c *Cinema) PickFolder(ctx context.Context) (*LibraryScan, error) {
	paths, err := mygo.Dialog.Open(mygo.OpenDialogOptions{
		Parent:    mygo.CallerWindow(ctx),
		Title:     "选择媒体文件夹",
		Directory: true,
	})
	if err != nil {
		return nil, err
	}
	if len(paths) == 0 {
		return nil, nil
	}
	files, err := collectVideoFiles(paths[0], 4)
	if err != nil {
		return nil, err
	}
	if len(files) == 0 {
		empty := LibraryScan{Items: []MediaItem{}, Episodes: []Episode{}}
		return &empty, nil
	}
	c.access.Authorize(files)
	scan := buildLibrary(files)
	return &scan, nil
}

// FindSubtitle 在视频同目录下按同名规则查找字幕，找到则返回文本内容。
func (c *Cinema) FindSubtitle(videoPath string) (*SubtitleFile, error) {
	return findSubtitleFor(videoPath), nil
}

// PickSubtitle 手动选择字幕文件。取消返回 null。
func (c *Cinema) PickSubtitle(ctx context.Context) (*SubtitleFile, error) {
	paths, err := mygo.Dialog.Open(mygo.OpenDialogOptions{
		Parent:  mygo.CallerWindow(ctx),
		Title:   "选择字幕文件",
		Filters: []mygo.FileFilter{{Name: "字幕", Extensions: []string{"srt", "vtt"}}},
	})
	if err != nil {
		return nil, err
	}
	if len(paths) == 0 {
		return nil, nil
	}
	return readSubtitle(paths[0])
}

// LoadProgress 读取某集的播放进度；无记录返回 null。
func (c *Cinema) LoadProgress(query ProgressQuery) (*WatchProgress, error) {
	if err := c.ready(); err != nil {
		return nil, err
	}
	return c.progress.Load(query.MediaID, query.EpisodeID), nil
}

// SaveProgress 写入某集的播放进度。
func (c *Cinema) SaveProgress(progress WatchProgress) error {
	if err := c.ready(); err != nil {
		return err
	}
	return c.progress.Save(progress)
}

// ListProgress 列出全部进度（按最近播放倒序）。
func (c *Cinema) ListProgress() ([]WatchProgress, error) {
	if err := c.ready(); err != nil {
		return nil, err
	}
	return c.progress.List(), nil
}

// RemoveProgress 删除某集进度。
func (c *Cinema) RemoveProgress(query ProgressQuery) error {
	if err := c.ready(); err != nil {
		return err
	}
	return c.progress.Remove(query.MediaID, query.EpisodeID)
}

// ListDisplays 列出所有显示器的亮度状态；不可用的也返回并附原因。
func (c *Cinema) ListDisplays() ([]DisplayBrightness, error) {
	return listDisplays(), nil
}

// SetBrightness 设置某台显示器的亮度，值会被收敛到支持范围。
func (c *Cinema) SetBrightness(id string, value float64) (BrightnessWriteResult, error) {
	return setDisplayBrightness(id, value), nil
}

// ---------- 在线片源 ----------

// RemoteHome 拉取在线首页聚合。
func (c *Cinema) RemoteHome(provider string) (RemoteHomeData, error) {
	if !isValidProvider(provider) {
		return RemoteHomeData{}, errors.New("未知片源 " + provider)
	}
	return remoteHome(provider)
}

// RemoteBrowse 在线分类浏览；kind 为空表示不限类型。
func (c *Cinema) RemoteBrowse(provider string, kind string, page int) (RemoteBrowsePage, error) {
	if !isValidProvider(provider) {
		return RemoteBrowsePage{}, errors.New("未知片源 " + provider)
	}
	return remoteBrowse(provider, strings.TrimSpace(kind), page)
}

// RemoteSearch 在线搜索。
func (c *Cinema) RemoteSearch(provider, keyword string, page int) (RemoteBrowsePage, error) {
	if !isValidProvider(provider) {
		return RemoteBrowsePage{}, errors.New("未知片源 " + provider)
	}
	return remoteSearch(provider, keyword, page)
}

// RemoteDetail 在线作品详情。
func (c *Cinema) RemoteDetail(provider, mediaID string) (RemoteDetail, error) {
	if !isValidProvider(provider) {
		return RemoteDetail{}, errors.New("未知片源 " + provider)
	}
	return remoteDetail(provider, mediaID)
}

// RemoteEpisodes 在线作品选集列表。
func (c *Cinema) RemoteEpisodes(provider, mediaID string) ([]RemoteEpisode, error) {
	if !isValidProvider(provider) {
		return nil, errors.New("未知片源 " + provider)
	}
	return remoteEpisodes(provider, mediaID)
}

// RemoteResolve 按集 token 解析出可直接播放的地址。
func (c *Cinema) RemoteResolve(provider, episodeToken, lineID string) (RemotePlayback, error) {
	if !isValidProvider(provider) {
		return RemotePlayback{}, errors.New("未知片源 " + provider)
	}
	serveLocal := func(localPath string) string {
		c.access.Authorize([]string{localPath})
		if c.media == nil {
			return ""
		}
		return c.media.FileURL(localPath)
	}
	return remoteResolve(provider, episodeToken, lineID, serveLocal)
}

// RemoteDanmaku 拉取一集的弹幕。红果有真实精选弹幕，其它片源返回空数组。
func (c *Cinema) RemoteDanmaku(provider, seriesID, episodeID string) ([]DanmakuItem, error) {
	if !isValidProvider(provider) {
		return nil, errors.New("未知片源 " + provider)
	}
	return remoteDanmaku(provider, seriesID, episodeID)
}

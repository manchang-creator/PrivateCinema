package main

// ==================== 领域模型（Go ↔ 前端 JSON） ====================
// 与 packages/core/src/shared/types.ts、ipc.ts 一一对应：
// json tag 必须保持 camelCase 且与 TS 字段完全同名，否则前端拿到 undefined。
// 这些类型同时喂给 mygo.Bind，由 `mygo generate` 反向生成 TS 客户端。

// MediaKind 内容类型。
type MediaKind string

const (
	KindMovie   MediaKind = "movie"
	KindSeries  MediaKind = "series"
	KindAnime   MediaKind = "anime"
	KindVariety MediaKind = "variety"
)

// MediaSourceId 媒体来源标识。
type MediaSourceId string

const (
	SourceLocal   MediaSourceId = "local"
	SourceKanju   MediaSourceId = "kanju"
	SourceHongguo MediaSourceId = "hongguo"
)

// MediaItem 统一媒体条目。
type MediaItem struct {
	ID              string        `json:"id"`
	Title           string        `json:"title"`
	Kind            MediaKind     `json:"kind"`
	Year            int           `json:"year"`
	Genres          []string      `json:"genres"`
	DurationMinutes int           `json:"durationMinutes"`
	Overview        string        `json:"overview"`
	FilePath        string        `json:"filePath,omitempty"`
	SizeBytes       int64         `json:"sizeBytes,omitempty"`
	Source          MediaSourceId `json:"source,omitempty"`
	PosterURL       string        `json:"posterUrl,omitempty"`
	Remarks         string        `json:"remarks,omitempty"`
	EpisodeCount    int           `json:"episodeCount,omitempty"`
}

// Episode 单集。
type Episode struct {
	ID           string        `json:"id"`
	MediaID      string        `json:"mediaId"`
	SeasonIndex  int           `json:"seasonIndex"`
	Index        int           `json:"index"`
	Title        string        `json:"title"`
	Duration     float64       `json:"duration"`
	FilePath     string        `json:"filePath"`
	Source       MediaSourceId `json:"source,omitempty"`
	EpisodeToken string        `json:"episodeToken,omitempty"`
}

// LibraryScan 扫描结果。
type LibraryScan struct {
	Items    []MediaItem `json:"items"`
	Episodes []Episode   `json:"episodes"`
}

// SubtitleFile 字幕文件内容。
type SubtitleFile struct {
	Name    string `json:"name"`
	Content string `json:"content"`
}

// ProgressQuery 进度读写的最小单元。
type ProgressQuery struct {
	MediaID   string `json:"mediaId"`
	EpisodeID string `json:"episodeId"`
}

// WatchProgress 播放进度。
type WatchProgress struct {
	MediaID      string  `json:"mediaId"`
	EpisodeID    string  `json:"episodeId"`
	MediaTitle   string  `json:"mediaTitle"`
	EpisodeTitle string  `json:"episodeTitle"`
	EpisodeIndex int     `json:"episodeIndex"`
	Position     float64 `json:"position"`
	Duration     float64 `json:"duration"`
	LastPlayedAt string  `json:"lastPlayedAt"`
	Completed    bool    `json:"completed"`
}

// DisplayBrightness 一台显示器的亮度状态（联合类型用可选字段表达）。
type DisplayBrightness struct {
	ID        string  `json:"id"`
	Label     string  `json:"label"`
	Primary   bool    `json:"primary"`
	Available bool    `json:"available"`
	Current   float64 `json:"current"`
	Min       float64 `json:"min"`
	Max       float64 `json:"max"`
	Reason    string  `json:"reason,omitempty"`
}

// BrightnessWriteResult 亮度写入结果。
type BrightnessWriteResult struct {
	OK     bool   `json:"ok"`
	Reason string `json:"reason,omitempty"`
}

// ==================== 在线片源（多源）模型 ====================

// RemoteCard 远端片库卡片。
type RemoteCard struct {
	ID        string    `json:"id"`
	Title     string    `json:"title"`
	Kind      MediaKind `json:"kind"`
	Year      int       `json:"year"`
	Area      string    `json:"area"`
	Genres    []string  `json:"genres"`
	Remarks   string    `json:"remarks"`
	PosterURL string    `json:"posterUrl"`
	// BackdropURL 横版剧照（16:9），用于 hero 大图；缺失时前端回退 PosterURL。
	BackdropURL string `json:"backdropUrl,omitempty"`
}

// RemoteSection 首页一个分区。
type RemoteSection struct {
	ID       string       `json:"id"`
	Title    string       `json:"title"`
	Subtitle string       `json:"subtitle"`
	Cards    []RemoteCard `json:"cards"`
}

// RemoteHomeData 首页聚合。
type RemoteHomeData struct {
	Sections []RemoteSection `json:"sections"`
}

// RemoteBrowsePage 一页浏览结果。
type RemoteBrowsePage struct {
	Cards   []RemoteCard `json:"cards"`
	Page    int          `json:"page"`
	HasMore bool         `json:"hasMore"`
}

// RemoteDetail 远端作品详情。
type RemoteDetail struct {
	ID           string    `json:"id"`
	Title        string    `json:"title"`
	Kind         MediaKind `json:"kind"`
	Year         int       `json:"year"`
	Area         string    `json:"area"`
	Genres       []string  `json:"genres"`
	Overview     string    `json:"overview"`
	PosterURL    string    `json:"posterUrl"`
	BackdropURL  string    `json:"backdropUrl,omitempty"`
	Remarks      string    `json:"remarks"`
	Actors       []string  `json:"actors"`
	Directors    []string  `json:"directors"`
	EpisodeCount int       `json:"episodeCount"`
}

// RemoteEpisode 远端一集。
type RemoteEpisode struct {
	ID     string `json:"id"`
	Token  string `json:"token"`
	Number int    `json:"number"`
	Title  string `json:"title"`
}

// RemoteLine 可用播放线路（不含地址）。
type RemoteLine struct {
	ID         string `json:"id"`
	Label      string `json:"label"`
	ProviderID string `json:"providerId"`
	URLKind    string `json:"urlKind"` // "mp4" | "hls"
}

// RemotePlayback 解析后的播放结果。
type RemotePlayback struct {
	URL       string       `json:"url"`
	URLKind   string       `json:"urlKind"`
	LineID    string       `json:"lineId"`
	LineLabel string       `json:"lineLabel"`
	Lines     []RemoteLine `json:"lines"`
}

// DanmakuItem 一条弹幕。字段与 packages/core/src/shared/types.ts 的 DanmakuItem 对齐，
// 前端拿到后可直接喂给弹幕引擎。time 为视频时间点（秒）。
type DanmakuItem struct {
	ID        string  `json:"id"`
	MediaID   string  `json:"mediaId"`
	EpisodeID string  `json:"episodeId"`
	Time      float64 `json:"time"`
	Content   string  `json:"content"`
	Type      string  `json:"type"` // "scroll" | "top" | "bottom"
	Color     string  `json:"color"`
	UserID    string  `json:"userId"`
	CreatedAt string  `json:"createdAt"`
}

// AppInfo 应用与更新相关的元信息（设置页「关于/更新」用）。
type AppInfo struct {
	Version        string `json:"version"`
	Platform       string `json:"platform"`
	IsDev          bool   `json:"isDev"`
	UpdatesEnabled bool   `json:"updatesEnabled"`
	AutoUpdate     bool   `json:"autoUpdate"`
}

// UpdateInfo 一次「检查更新」的结果。
type UpdateInfo struct {
	Enabled   bool   `json:"enabled"`
	Available bool   `json:"available"`
	Current   string `json:"current"`
	Version   string `json:"version"`
	Notes     string `json:"notes"`
	Date      string `json:"date"`
}

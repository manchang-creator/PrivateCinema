package main

// ==================== 在线片源：红果短剧（openhongguo）====================
// 由 linux/src/main/hongguo.ts 移植而来。原实现通过 openhongguo 的 Node WASM 绑定调用，
// 这里改用官方 Go SDK（github.com/beilunyang/openhongguo）直接调用：
//   - sdk.Client       负责匿名设备读取片库 / 详情 / 分集 / 播放模型；
//   - sdk.ContentKey   从播放模型算出 CENC（cenc-aes-ctr）内容密钥（纯本地计算）；
//   - adapters.NewClient 用现成实现补齐 Transport 与 ProfileStore，把匿名设备档案落地为文件。
//
// 播放链路：Discover / Search → ListEpisodes（每集 id）→ ResolvePlayback（各清晰度直链 +
// 内容密钥）。红果分集是 CENC 加密的 HEVC/bytevc1，Chromium 无法直接播放，因此用系统 ffmpeg
// 以 -decryption_key 解密并转码成 H.264/AAC 单文件，落地到本地缓存后交给播放器；
// 同一集同一清晰度只解密一次。

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/beilunyang/openhongguo/adapters"
	"github.com/beilunyang/openhongguo/sdk"
	"github.com/beilunyang/openhongguo/sdk/model"
)

// ==================== 运行配置 ====================

type hongguoConfig struct {
	// cacheDir 是解密产物的落地目录（建议放在 userData 下，可跨重启复用）。
	cacheDir string
	// ffmpegPath 是 ffmpeg 可执行文件；默认走 PATH。
	ffmpegPath string
	// profilePath 是匿名设备档案 JSON 的落地路径。
	profilePath string
}

var (
	hongguoConfMu sync.RWMutex
	hongguoConf   = hongguoConfig{
		cacheDir:   filepath.Join(os.TempDir(), "private-cinema-hongguo"),
		ffmpegPath: defaultFfmpegPath(),
	}
)

func defaultFfmpegPath() string {
	if p := os.Getenv("FFMPEG_PATH"); p != "" {
		return p
	}
	return "ffmpeg"
}

// configureHongguo 由主进程启动时注入实际缓存目录 / ffmpeg 路径 / 匿名设备档案路径。
func configureHongguo(cacheDir, ffmpegPath, profilePath string) {
	hongguoConfMu.Lock()
	defer hongguoConfMu.Unlock()
	if cacheDir != "" {
		hongguoConf.cacheDir = cacheDir
	}
	if ffmpegPath != "" {
		hongguoConf.ffmpegPath = ffmpegPath
	}
	hongguoConf.profilePath = profilePath
}

func currentHongguoConfig() hongguoConfig {
	hongguoConfMu.RLock()
	defer hongguoConfMu.RUnlock()
	return hongguoConf
}

// ==================== 惰性单例客户端 ====================

// hongguoTimeout 对应 TS 里 client 的 timeoutMs=20s。Go SDK 的 Options 没有超时字段，
// 这里用每次调用的 context 超时来等价实现。
const hongguoTimeout = 20 * time.Second

var (
	hgClientOnce sync.Once
	hgClient     *sdk.Client
	hgClientErr  error
)

// getClient 惰性创建单例客户端：匿名设备档案由 SDK 自行持久化到 profilePath。
func getClient() (*sdk.Client, error) {
	hgClientOnce.Do(func() {
		cfg := currentHongguoConfig()
		opts := sdk.Options{
			RetryAttempts: envInt("HONGGUO_RETRY_ATTEMPTS", 2),
			DeviceResets:  sdk.Int(envInt("HONGGUO_DEVICE_RESETS", 3)),
		}
		if os.Getenv("HONGUO_DEBUG") == "1" {
			opts.Logger = log.New(os.Stdout, "[hongguo] ", 0)
		}
		hgClient, hgClientErr = adapters.NewClient(cfg.profilePath, opts)
	})
	return hgClient, hgClientErr
}

func hongguoCtx() (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.Background(), hongguoTimeout)
}

// ==================== 归一化 ====================

// mapKind 把红果 ContentType 映射为领域 MediaKind：
// 5=电影，6=电视剧，1004=漫剧，其余（真人短剧/场景剧/短剧等）按剧集处理。
func mapKind(contentType int) MediaKind {
	switch contentType {
	case 5:
		return KindMovie
	case 1004:
		return KindAnime
	default:
		return KindSeries
	}
}

// coverOf 返回封面 URL。TS 里 `cover_expires_at` 为零值的分支两条路径都返回同一个 url，
// 属无效判断；这里只保留「去空白、空则空串」的等价语义。
func coverOf(coverURL string) string {
	url := strings.TrimSpace(coverURL)
	if url == "" {
		return ""
	}
	return url
}

// mapSummary 把目录行（SeriesSummary）归一化为前端卡片。
func mapSummary(summary model.SeriesSummary) RemoteCard {
	count := summary.EpisodeCount
	genres := make([]string, 0, 1)
	if summary.Category != "" {
		genres = append(genres, summary.Category)
	}
	remarks := ""
	if count > 0 {
		remarks = fmt.Sprintf("共 %d 集", count)
	}
	return RemoteCard{
		ID:        summary.ID,
		Title:     summary.Title,
		Kind:      KindSeries,
		Year:      0,
		Area:      "",
		Genres:    genres,
		Remarks:   remarks,
		PosterURL: coverOf(summary.CoverURL),
	}
}

// yearOf 把发布时间换成发布年份；零值返回 0。
// TS 里 created_at 是 RFC3339 / unix 秒字符串，Go SDK 已解析为 time.Time（Series.CreatedAt）。
func yearOf(createdAt time.Time) int {
	if createdAt.IsZero() {
		return 0
	}
	return createdAt.Year()
}

var hgInfoSplitRe = regexp.MustCompile(`[·/、,\s]+`)

func splitInfoText(text string) []string {
	return hgInfoSplitRe.Split(text, -1)
}

func dedupeLimit(items []string, limit int) []string {
	seen := make(map[string]struct{}, len(items))
	out := make([]string, 0, len(items))
	for _, it := range items {
		if it == "" {
			continue
		}
		if _, ok := seen[it]; ok {
			continue
		}
		seen[it] = struct{}{}
		out = append(out, it)
		if limit > 0 && len(out) >= limit {
			break
		}
	}
	return out
}

// genresFromRows 从详情次要信息行里抽取标签：InfoCategory=3、InfoTags=9。
func genresFromRows(series model.Series) []string {
	parts := make([]string, 0, 8)
	if series.Category != "" {
		parts = append(parts, series.Category)
	}
	for _, row := range series.Rows {
		if row.Kind == model.InfoCategory || row.Kind == model.InfoTags {
			for _, part := range splitInfoText(row.Text) {
				parts = append(parts, part)
			}
		}
	}
	return dedupeLimit(parts, 8)
}

var hgActorPrefixRe = regexp.MustCompile(`^演员[·:：\s]*`)

// actorsFromRows 从详情次要信息行里抽取演员：InfoTwoActors=33，文本形如「演员·张三 李四」。
func actorsFromRows(series model.Series) []string {
	names := make([]string, 0, 12)
	for _, row := range series.Rows {
		if row.Kind != model.InfoTwoActors {
			continue
		}
		text := hgActorPrefixRe.ReplaceAllString(row.Text, "")
		for _, part := range splitInfoText(text) {
			names = append(names, part)
		}
	}
	return dedupeLimit(names, 12)
}

// ==================== 首页 ====================

// hongguoHome 首页聚合（带 TTL 缓存，降低按 IP 计的请求量）。
func hongguoHome() (RemoteHomeData, error) {
	return withHgCache("hongguo:home", hongguoHomeFetch)
}

// hongguoHomeFetch 首页聚合：推荐频道 + 各热搜榜（取得到的才加入）。
func hongguoHomeFetch() (RemoteHomeData, error) {
	client, err := getClient()
	if err != nil {
		return RemoteHomeData{}, err
	}

	sections := make([]RemoteSection, 0, 4)

	// 推荐频道失败不阻塞其它分区
	if page, err := func() (*sdk.Page[model.SeriesSummary], error) {
		ctx, cancel := hongguoCtx()
		defer cancel()
		throttleHongguo(ctx)
		return client.Discover(ctx, sdk.DiscoverOptions{})
	}(); err == nil {
		cards := make([]RemoteCard, 0, len(page.Items))
		for _, item := range page.Items {
			cards = append(cards, mapSummary(item))
		}
		if len(cards) > 0 {
			sections = append(sections, RemoteSection{ID: "hg-recommend", Title: "推荐", Subtitle: "", Cards: cards})
		}
	}

	// 热搜榜失败不影响首页
	if hot, err := func() (*model.HotSearch, error) {
		ctx, cancel := hongguoCtx()
		defer cancel()
		throttleHongguo(ctx)
		return client.HotSearch(ctx)
	}(); err == nil && hot != nil {
		for _, board := range hot.Boards {
			cards := make([]RemoteCard, 0, len(board.Items))
			for _, item := range board.Items {
				remarks := item.Tag
				if item.EpisodeCount > 0 {
					remarks = fmt.Sprintf("共 %d 集", item.EpisodeCount)
				}
				cards = append(cards, RemoteCard{
					ID:        item.SeriesID,
					Title:     item.Title,
					Kind:      KindSeries,
					Year:      0,
					Area:      "",
					Genres:    make([]string, 0),
					Remarks:   remarks,
					PosterURL: coverOf(item.CoverURL),
				})
			}
			if len(cards) > 0 {
				sections = append(sections, RemoteSection{
					ID:       "hg-board-" + board.Name,
					Title:    board.Name,
					Subtitle: "",
					Cards:    cards,
				})
			}
		}
	}

	if len(sections) == 0 {
		return RemoteHomeData{}, errors.New("红果首页暂无内容，请稍后重试")
	}
	return RemoteHomeData{Sections: sections}, nil
}

// ==================== 游标分页缓存 ====================

// 红果列表是游标分页（不是页码）。UI 只会按 1、2、3… 顺序翻页，这里缓存上一页游标，
// 只有请求的页码正好接在上一页之后才续取，否则从头/返回空。
type hgCursorState struct {
	page   int
	cursor *string
}

type hgSearchState struct {
	hgCursorState
	keyword string
}

var (
	hgStateMu   sync.Mutex
	browseState *hgCursorState
	searchState *hgSearchState
)

// hgCursorFor 返回续取游标。proceed=false 表示拿不到续取游标（请求页 >1 且状态不连续），
// 此时应直接返回空页；cursor=nil 且 proceed=true 表示从第一页取。
func hgCursorFor(state *hgCursorState, page int) (cursor *string, proceed bool) {
	if page == 1 {
		return nil, true
	}
	if state == nil || state.page != page-1 || state.cursor == nil {
		return nil, false
	}
	return state.cursor, true
}

func hgSafePage(page int) int {
	if page < 1 {
		return 1
	}
	return page
}

func cursorPtr(s string) *string {
	if s == "" {
		return nil
	}
	c := s
	return &c
}

// ==================== 浏览 / 搜索 ====================

// hongguoBrowse 分类浏览（红果无电影/综艺等频道，沿用推荐流，游标分页）。
func hongguoBrowse(kind string, page int) (RemoteBrowsePage, error) {
	client, err := getClient()
	if err != nil {
		return RemoteBrowsePage{}, err
	}
	safePage := hgSafePage(page)

	hgStateMu.Lock()
	cursor, proceed := hgCursorFor(browseState, safePage)
	hgStateMu.Unlock()
	if !proceed {
		return RemoteBrowsePage{Cards: make([]RemoteCard, 0), Page: safePage, HasMore: false}, nil
	}

	opts := sdk.DiscoverOptions{}
	if cursor != nil {
		opts.Cursor = *cursor
	}

	ctx, cancel := hongguoCtx()
	throttleHongguo(ctx)
	result, err := client.Discover(ctx, opts)
	cancel()
	if err != nil {
		return RemoteBrowsePage{}, err
	}

	cards := make([]RemoteCard, 0, len(result.Items))
	for _, item := range result.Items {
		cards = append(cards, mapSummary(item))
	}

	hgStateMu.Lock()
	browseState = &hgCursorState{page: safePage, cursor: cursorPtr(result.Cursor)}
	hgStateMu.Unlock()

	return RemoteBrowsePage{
		Cards:   cards,
		Page:    safePage,
		HasMore: result.HasMore && result.Cursor != "",
	}, nil
}

// hongguoSearch 搜索（游标分页）。
func hongguoSearch(keyword string, page int) (RemoteBrowsePage, error) {
	client, err := getClient()
	if err != nil {
		return RemoteBrowsePage{}, err
	}
	safePage := hgSafePage(page)
	q := strings.TrimSpace(keyword)
	if q == "" {
		return RemoteBrowsePage{Cards: make([]RemoteCard, 0), Page: 1, HasMore: false}, nil
	}

	hgStateMu.Lock()
	var sameSearch *hgCursorState
	if searchState != nil && searchState.keyword == q {
		sameSearch = &searchState.hgCursorState
	}
	cursor, proceed := hgCursorFor(sameSearch, safePage)
	hgStateMu.Unlock()
	if !proceed {
		return RemoteBrowsePage{Cards: make([]RemoteCard, 0), Page: safePage, HasMore: false}, nil
	}

	opts := sdk.SearchOptions{}
	if cursor != nil {
		opts.Cursor = *cursor
	}

	ctx, cancel := hongguoCtx()
	throttleHongguo(ctx)
	result, err := client.Search(ctx, q, opts)
	cancel()
	if err != nil {
		return RemoteBrowsePage{}, err
	}

	cards := make([]RemoteCard, 0, len(result.Items))
	for _, item := range result.Items {
		cards = append(cards, mapSummary(item))
	}

	hgStateMu.Lock()
	searchState = &hgSearchState{
		hgCursorState: hgCursorState{page: safePage, cursor: cursorPtr(result.Cursor)},
		keyword:       q,
	}
	hgStateMu.Unlock()

	return RemoteBrowsePage{
		Cards:   cards,
		Page:    safePage,
		HasMore: result.HasMore && result.Cursor != "",
	}, nil
}

// ==================== 详情 / 分集 ====================

// hongguoDetail 作品详情（带 TTL 缓存）。
func hongguoDetail(mediaID string) (RemoteDetail, error) {
	return withHgCache("hongguo:detail:"+mediaID, func() (RemoteDetail, error) {
		return hongguoDetailFetch(mediaID)
	})
}

// hongguoDetailFetch 作品详情。
func hongguoDetailFetch(mediaID string) (RemoteDetail, error) {
	client, err := getClient()
	if err != nil {
		return RemoteDetail{}, err
	}

	ctx, cancel := hongguoCtx()
	throttleHongguo(ctx)
	series, err := client.GetSeries(ctx, mediaID)
	cancel()
	if err != nil {
		return RemoteDetail{}, err
	}
	if series == nil {
		return RemoteDetail{}, errors.New("作品不存在")
	}

	count := series.EpisodeCount
	remarks := ""
	switch {
	case series.RightText != "":
		remarks = series.RightText
	case count > 0:
		remarks = fmt.Sprintf("共 %d 集", count)
	}

	return RemoteDetail{
		ID:           series.ID,
		Title:        series.Title,
		Kind:         mapKind(int(series.ContentType)),
		Year:         yearOf(series.CreatedAt),
		Area:         "",
		Genres:       genresFromRows(*series),
		Overview:     series.Description,
		PosterURL:    coverOf(series.CoverURL),
		Remarks:      remarks,
		Actors:       actorsFromRows(*series),
		Directors:    make([]string, 0),
		EpisodeCount: count,
	}, nil
}

// hongguoEpisodes 分集列表（带 TTL 缓存）。
func hongguoEpisodes(mediaID string) ([]RemoteEpisode, error) {
	return withHgCache("hongguo:episodes:"+mediaID, func() ([]RemoteEpisode, error) {
		return hongguoEpisodesFetch(mediaID)
	})
}

// hongguoEpisodesFetch 分集列表。红果一部剧可能有数百集，服务端通常一页返回全部，这里最多续取若干页。
func hongguoEpisodesFetch(mediaID string) ([]RemoteEpisode, error) {
	client, err := getClient()
	if err != nil {
		return nil, err
	}

	collected := make([]model.Episode, 0, 64)
	var cursor string
	for i := 0; i < 10; i++ {
		opts := sdk.EpisodeOptions{}
		if cursor != "" {
			opts.Cursor = cursor
		}
		ctx, cancel := hongguoCtx()
		throttleHongguo(ctx)
		page, err := client.ListEpisodes(ctx, mediaID, opts)
		cancel()
		if err != nil {
			return nil, err
		}
		collected = append(collected, page.Items...)
		if !page.HasMore || page.Cursor == "" {
			break
		}
		cursor = page.Cursor
	}

	out := make([]RemoteEpisode, 0, len(collected))
	for _, episode := range collected {
		// Playable 由 SDK 按 disable_play 取反，默认 true；只有明确禁止播放的才是 false。
		if !episode.Playable {
			continue
		}
		title := episode.Title
		if title == "" {
			title = fmt.Sprintf("第 %d 集", episode.Number)
		}
		out = append(out, RemoteEpisode{
			ID:     episode.ID,
			Token:  episode.ID, // resolvePlayback 接受分集 id，作为 token 透传
			Number: episode.Number,
			Title:  title,
		})
	}
	return out, nil
}

// ==================== 弹幕 ====================

// hongguoDanmaku 拉取一集的真实弹幕（红果「精选弹幕」评论列表）。
// 上游按播放时间分窗返回：不带游标时先查一次分集详情拿时长，再从 StartMs 起
// 逐窗翻到片尾；每台匿名设备拿到的是服务端下发的一个子集（并非全集）。
// 这里翻完所有窗口、按 id 去重、按时间排序后返回；结果做 TTL 缓存避免反复打上游。
func hongguoDanmaku(seriesID, episodeID string) ([]DanmakuItem, error) {
	return withHgCache("hongguo:danmaku:"+episodeID, func() ([]DanmakuItem, error) {
		return hongguoDanmakuFetch(seriesID, episodeID)
	})
}

func hongguoDanmakuFetch(seriesID, episodeID string) ([]DanmakuItem, error) {
	client, err := getClient()
	if err != nil {
		return nil, err
	}

	// 一个 30s 窗口一页；上限防呆（1 小时 ≈ 120 页），正常短剧几页就结束。
	const maxPages = 150
	seen := make(map[string]struct{})
	out := make([]DanmakuItem, 0, 128)
	cursor := ""
	for page := 0; page < maxPages; page++ {
		ctx, cancel := hongguoCtx()
		throttleHongguo(ctx)
		res, err := client.ListDanmaku(ctx, seriesID, episodeID, sdk.DanmakuOptions{Cursor: cursor, PageSize: 90})
		cancel()
		if err != nil {
			// 已经拿到一部分就别因为后续某页失败而整批丢掉。
			if len(out) > 0 {
				break
			}
			return nil, wrapFriendly(err)
		}
		for _, d := range res.Items {
			if d.ID != "" {
				if _, ok := seen[d.ID]; ok {
					continue
				}
				seen[d.ID] = struct{}{}
			}
			text := strings.TrimSpace(d.Text)
			if text == "" {
				continue
			}
			id := d.ID
			if id == "" {
				id = fmt.Sprintf("%s-%d", episodeID, d.OffsetMS)
			}
			created := ""
			if !d.CreatedAt.IsZero() {
				created = d.CreatedAt.UTC().Format(time.RFC3339)
			}
			out = append(out, DanmakuItem{
				ID:        "hg-" + id,
				MediaID:   seriesID,
				EpisodeID: episodeID,
				Time:      float64(d.OffsetMS) / 1000.0,
				Content:   text,
				Type:      "scroll",
				Color:     "#FFFFFF",
				UserID:    "hongguo",
				CreatedAt: created,
			})
		}
		if !res.HasMore || res.Cursor == "" {
			break
		}
		cursor = res.Cursor
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Time < out[j].Time })
	return out, nil
}

// ==================== 播放解析 ====================

// labelOf 给线路取名：优先清晰度（Definition），其次画质（Quality），最后「线路 N」。
func labelOf(stream model.Stream, index int) string {
	definition := ""
	if stream.Definition != "" {
		definition = stream.Definition
	}
	quality := ""
	if stream.Quality != "" {
		quality = stream.Quality
	}
	if definition != "" {
		return definition
	}
	if quality != "" {
		return quality
	}
	return fmt.Sprintf("线路 %d", index+1)
}

// 默认清晰度优先级：优先给转码成本较低的 480p，再退到 360p / 更高。
var preferredDefinitions = []string{"480p", "360p", "540p", "720p", "1080p"}

var hgLineIDRe = regexp.MustCompile(`^hg-(\d+)$`)

// pickStreamIndex 选出一条流。lineId 支持 `hg-<index>` 或清晰度标签；否则按优先级挑单文件流。
func pickStreamIndex(streams []model.Stream, lineID string) int {
	if lineID != "" {
		if m := hgLineIDRe.FindStringSubmatch(lineID); m != nil {
			if index, err := strconv.Atoi(m[1]); err == nil && index >= 0 && index < len(streams) {
				return index
			}
		}
		for i, stream := range streams {
			if stream.Definition == lineID {
				return i
			}
		}
	}
	for _, definition := range preferredDefinitions {
		for i, stream := range streams {
			if stream.Definition == definition && !stream.HLS && !stream.Dash {
				return i
			}
		}
	}
	for i, stream := range streams {
		if !stream.HLS && !stream.Dash {
			return i
		}
	}
	return 0
}

// friendlyResolveError 把 SDK 的错误翻译成给用户看的中文，保留可诊断信息。
func friendlyResolveError(err error) string {
	switch {
	case errors.Is(err, sdk.ErrAnonymousLimited):
		return "红果匿名播放额度暂时用尽（上游限制），请稍后重试"
	case errors.Is(err, sdk.ErrAuthenticationRequired):
		return "该集需要登录，匿名接口无法播放"
	case errors.Is(err, sdk.ErrRateLimited):
		return "请求过于频繁，已被红果限流，请稍后重试"
	case errors.Is(err, sdk.ErrContentUnavailable):
		return "该集已下架或不可用"
	case errors.Is(err, sdk.ErrDRMProtected):
		return "该集为加密内容，暂不支持直接播放"
	default:
		if err != nil {
			return err.Error()
		}
		return "播放地址解析失败"
	}
}

// friendlyError 保留可读中文消息，同时用 Unwrap 保留原始错误链，
// 好让外层 withQuotaRetry 能用 errors.Is 识别匿名额度类错误并换设备重试。
type friendlyError struct {
	msg   string
	cause error
}

func (e *friendlyError) Error() string { return e.msg }
func (e *friendlyError) Unwrap() error { return e.cause }

func wrapFriendly(err error) error {
	return &friendlyError{msg: friendlyResolveError(err), cause: err}
}

func streamURLKind(hls bool) string {
	if hls {
		return "hls"
	}
	return "mp4"
}

// ==================== ffmpeg 解密 ====================

// tailBuffer 只保留最后 8000 字节的 stderr。
type tailBuffer struct {
	mu  sync.Mutex
	buf []byte
}

func (t *tailBuffer) Write(p []byte) (int, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.buf = append(t.buf, p...)
	if len(t.buf) > 8000 {
		t.buf = t.buf[len(t.buf)-8000:]
	}
	return len(p), nil
}

func (t *tailBuffer) String() string {
	t.mu.Lock()
	defer t.mu.Unlock()
	return string(t.buf)
}

func lastLinesTail(s string, n int) string {
	lines := strings.Split(s, "\n")
	if len(lines) > n {
		lines = lines[len(lines)-n:]
	}
	return strings.TrimSpace(strings.Join(lines, " "))
}

// runFfmpeg 调一次 ffmpeg；失败把 stderr 末尾带出来，便于定位。
func runFfmpeg(ffmpegPath string, args []string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	cmd := exec.CommandContext(ctx, ffmpegPath, args...)
	var tail tailBuffer
	cmd.Stderr = &tail

	err := cmd.Run()
	if ctx.Err() == context.DeadlineExceeded {
		return errors.New("ffmpeg 解密超时（5 分钟）")
	}
	if err == nil {
		return nil
	}
	if errors.Is(err, exec.ErrNotFound) {
		return errors.New("未找到 ffmpeg：请先安装 ffmpeg 并加入 PATH")
	}
	var execErr *exec.Error
	if errors.As(err, &execErr) {
		return errors.New("未找到 ffmpeg：请先安装 ffmpeg 并加入 PATH")
	}
	code := -1
	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) {
		code = exitErr.ExitCode()
	}
	return fmt.Errorf("ffmpeg 解密失败（退出码 %d）：%s", code, lastLinesTail(tail.String(), 3))
}

// decryptInFlight 用「输出路径 → 进行中的任务」做同 key 并发去重，
// 避免两个 ffmpeg 抢写同一文件。
type hgDecryptCall struct {
	done chan struct{}
	path string
	err  error
}

var (
	hgDecryptMu sync.Mutex
	hgDecrypts  = make(map[string]*hgDecryptCall)
)

// ensureDecrypted 解密 + 转码一集到本地缓存；已存在则直接复用。key 为 16 字节 AES 十六进制。
func ensureDecrypted(episodeID string, stream model.Stream, key string) (string, error) {
	cfg := currentHongguoConfig()

	// 缓存键只用「分集 + 清晰度」：播放直链每次带新的签名，不能进哈希，否则永远不命中。
	sum := sha1.Sum([]byte(episodeID + "|" + stream.Definition))
	hash := hex.EncodeToString(sum[:])[:20]
	output := filepath.Join(cfg.cacheDir, hash+".mp4")

	if info, err := os.Stat(output); err == nil && info.Size() > 0 {
		return output, nil
	}

	hgDecryptMu.Lock()
	if call, ok := hgDecrypts[output]; ok {
		hgDecryptMu.Unlock()
		<-call.done
		return call.path, call.err
	}
	call := &hgDecryptCall{done: make(chan struct{})}
	hgDecrypts[output] = call
	hgDecryptMu.Unlock()

	call.path, call.err = decryptOne(cfg, output, stream, key)
	close(call.done)

	hgDecryptMu.Lock()
	delete(hgDecrypts, output)
	hgDecryptMu.Unlock()

	return call.path, call.err
}

func decryptOne(cfg hongguoConfig, output string, stream model.Stream, key string) (string, error) {
	if err := os.MkdirAll(cfg.cacheDir, 0o755); err != nil {
		return "", err
	}
	// 临时文件带 pid + 时间戳，杜绝并发写同一路径。
	temp := fmt.Sprintf("%s.%d.%d.part.mp4", output, os.Getpid(), time.Now().UnixNano())
	args := []string{
		"-hide_banner", "-loglevel", "error", "-y",
		"-decryption_key", key,
		"-i", stream.URL,
		"-c:v", "libx264", "-preset", "ultrafast", "-crf", "26",
		"-maxrate", "1400k", "-bufsize", "2800k",
		"-c:a", "aac", "-b:a", "96k",
		temp,
	}
	if err := runFfmpeg(cfg.ffmpegPath, args); err != nil {
		_ = os.Remove(temp)
		return "", err
	}
	if err := os.Rename(temp, output); err != nil {
		_ = os.Remove(temp)
		return "", err
	}
	return output, nil
}

// ==================== 对外：解析一集播放地址 ====================

// hongguoResolve 解析一集的播放地址。
//   - 未加密：直接返回 http 直链；
//   - 加密（红果常态）：用 ffmpeg 解密 + 转码成 H.264 落到本地缓存，再经 serveLocal 换成可播放 URL。
//
// 指定 lineID（hg-<index> 或清晰度标签）时用对应清晰度；否则默认 480p/360p。
func hongguoResolve(episodeID, lineID string, serveLocal func(string) string) (RemotePlayback, error) {
	client, err := getClient()
	if err != nil {
		return RemotePlayback{}, err
	}

	ctx, cancel := hongguoCtx()
	throttleHongguo(ctx)
	resolved, err := client.ResolvePlayback(ctx, episodeID, sdk.PlaybackOptions{})
	cancel()
	if err != nil {
		// 加密内容：SDK 照常返回播放模型，同时带回 ErrDRMProtected，交给 ContentKey 取密钥。
		if !(errors.Is(err, sdk.ErrDRMProtected) && resolved != nil) {
			return RemotePlayback{}, wrapFriendly(err)
		}
	}
	if resolved == nil {
		return RemotePlayback{}, wrapFriendly(err)
	}

	streams := make([]model.Stream, 0, len(resolved.Streams))
	for _, stream := range resolved.Streams {
		if stream.URL != "" {
			streams = append(streams, stream)
		}
	}
	if len(streams) == 0 {
		return RemotePlayback{}, errors.New("该集暂无可用播放地址")
	}

	lines := make([]RemoteLine, 0, len(streams))
	for index, stream := range streams {
		lines = append(lines, RemoteLine{
			ID:         fmt.Sprintf("hg-%d", index),
			Label:      labelOf(stream, index),
			ProviderID: "hongguo",
			URLKind:    streamURLKind(stream.HLS),
		})
	}

	chosenIndex := pickStreamIndex(streams, lineID)
	chosen := streams[chosenIndex]

	// 非加密：直接交给播放器
	if !chosen.Protected {
		return RemotePlayback{
			URL:       chosen.URL,
			URLKind:   streamURLKind(chosen.HLS),
			LineID:    fmt.Sprintf("hg-%d", chosenIndex),
			LineLabel: labelOf(chosen, chosenIndex),
			Lines:     lines,
		}, nil
	}

	// 加密：解密 + 转码成本地文件
	contentKey, err := sdk.ContentKey(resolved)
	if err != nil {
		return RemotePlayback{}, wrapFriendly(err)
	}
	if contentKey.Hex == "" {
		return RemotePlayback{}, errors.New("该集为加密内容，但未能取得解密密钥，暂时无法播放")
	}
	if chosen.HLS || chosen.Dash {
		return RemotePlayback{}, errors.New("该清晰度不是可直接解密的单文件，请切换其它线路")
	}
	if serveLocal == nil {
		return RemotePlayback{}, errors.New("该集为加密内容，需要本地解密后才能播放")
	}

	localPath, err := ensureDecrypted(episodeID, chosen, contentKey.Hex)
	if err != nil {
		return RemotePlayback{}, err
	}
	return RemotePlayback{
		URL:       serveLocal(localPath),
		URLKind:   "mp4",
		LineID:    fmt.Sprintf("hg-%d", chosenIndex),
		LineLabel: labelOf(chosen, chosenIndex),
		Lines:     lines,
	}, nil
}

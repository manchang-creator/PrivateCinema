package main

// ==================== 在线片源客户端（看剧AI / kanju1.com）====================
// 本文件是 linux/src/main/kanju.ts 的 1:1 Go 移植（package main）。
//
// 该站是一个聚合前端，所有内容接口都要求请求签名（HMAC-SHA256）：
//   message = METHOD + "\n" + path(含 query) + "\n" + timestamp + "\n" + nonce
//   signature = HMAC_SHA256(SECRET, message)  (hex)
// 头部：x-ai-movie-timestamp / x-ai-movie-nonce / x-ai-movie-signature +
//       固定的客户端标识头，服务端据此判定为本站前端而非爬虫。
//
// 播放链路：catalog → episodes（拿每集 token）→ playback/resolve（拿线路）
//   → 线路 url 为 `resolve://<ticket>` 时再经 playback/resolve-line 换成真实直链。
// 返回的 mp4 直链带时效签名，播放器按需重解析即可。
//
// 说明：为避免与同包内其它适配器（如 hongguo）的辅助符号冲突，除对外导出的
// kanju* 接口外，内部辅助函数统一加 kanju 前缀。

import (
	"bytes"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// ==================== 常量（照抄 TS）====================

const (
	kanjuBase            = "https://kanju1.com"
	kanjuSecret          = "557d0e4ae929f438da6bd84412374e6086b8af09b3fed54bf22601d5bf8c54a0"
	kanjuClientName      = "dianyingtiantang-frontend"
	kanjuClientVersion   = "1.0.0"
	kanjuBuildVersion    = "dianyingtiantang-v2026.11.06.2-search-header-f6f73501a448-web"
	kanjuProtocolVersion = "2026-07-05.library-v2.playback-v1"
)

// urlKind 取值。
const (
	kanjuUrlKindMP4 = "mp4"
	kanjuUrlKindHLS = "hls"
)

// kanjuHTTPClient 全局 http 客户端（对应 fetch 的默认行为，附加超时）。
var kanjuHTTPClient = &http.Client{Timeout: 30 * time.Second}

// kanjuM3U8Re 对应 TS 的 /\.m3u8(?:$|[?#])/i。
var kanjuM3U8Re = regexp.MustCompile(`(?i)\.m3u8(?:$|[?#])`)

// ==================== 签名请求 ====================

// kanjuQueryParam 一个有序的 query 键值对。
// TS 用对象字面量，键的插入顺序决定序列化顺序；Go map 无序，故用有序切片表达。
type kanjuQueryParam struct {
	key   string
	value any // string | int | int64 | nil；nil 或 "" 会被跳过
}

// kanjuBuildQuery 按插入顺序拼出 "?k=v&k=v"，空白/特殊字符用 url.QueryEscape 编码。
// 与 TS buildQuery 一致：undefined（Go 的 nil）与空串跳过；数字 0 会被保留。
// 关键点：签名用的 path 与实际请求的 URL 复用同一份输出，保证两者完全一致。
func kanjuBuildQuery(params []kanjuQueryParam) string {
	var b strings.Builder
	first := true
	for _, p := range params {
		s, ok := kanjuQueryValueString(p.value)
		if !ok {
			continue
		}
		if !first {
			b.WriteByte('&')
		}
		first = false
		b.WriteString(url.QueryEscape(p.key))
		b.WriteByte('=')
		b.WriteString(url.QueryEscape(s))
	}
	if first {
		return ""
	}
	return "?" + b.String()
}

// kanjuQueryValueString 判定某个 query 值是否参与拼接，并转成字符串。
func kanjuQueryValueString(v any) (string, bool) {
	switch x := v.(type) {
	case nil:
		return "", false
	case string:
		if x == "" {
			return "", false
		}
		return x, true
	case int:
		return strconv.Itoa(x), true
	case int64:
		return strconv.FormatInt(x, 10), true
	case uint:
		return strconv.FormatUint(uint64(x), 10), true
	default:
		s := fmt.Sprint(v)
		if s == "" {
			return "", false
		}
		return s, true
	}
}

// kanjuRequestOptions 请求选项。
type kanjuRequestOptions struct {
	method string // "" 即 GET
	query  []kanjuQueryParam
	body   any // nil 表示无 body
}

// kanjuRequest 发起签名请求并解析 JSON。对应 TS request<T>。
func kanjuRequest[T any](pathname string, opts kanjuRequestOptions) (T, error) {
	var zero T

	method := opts.method
	if method == "" {
		method = http.MethodGet
	}
	path := pathname + kanjuBuildQuery(opts.query)

	timestamp := strconv.FormatInt(time.Now().UnixMilli(), 10)
	nonceBytes := make([]byte, 16)
	if _, err := rand.Read(nonceBytes); err != nil {
		return zero, fmt.Errorf("看剧AI 生成随机数失败：%v", err)
	}
	nonce := hex.EncodeToString(nonceBytes)

	message := method + "\n" + path + "\n" + timestamp + "\n" + nonce
	signature := kanjuSign(message)

	// 头部照抄 TS；用直接赋值保留原始大小写（x-ai-movie-* 全小写）。
	headers := map[string]string{
		"Accept":                      "application/json",
		"x-ai-movie-client-name":      kanjuClientName,
		"x-ai-movie-client-version":   kanjuClientVersion,
		"x-ai-movie-build-version":    kanjuBuildVersion,
		"x-ai-movie-protocol-version": kanjuProtocolVersion,
		"x-ai-movie-timestamp":        timestamp,
		"x-ai-movie-nonce":            nonce,
		"x-ai-movie-signature":        signature,
		"x-ai-movie-site-host":        "kanju1.com",
		"Origin":                      "https://kanju1.com",
		"Referer":                     "https://kanju1.com/",
		"User-Agent":                  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
	}

	var bodyReader io.Reader
	if opts.body != nil {
		payload, err := json.Marshal(opts.body)
		if err != nil {
			return zero, fmt.Errorf("看剧AI 请求体序列化失败：%s %s → %v", method, pathname, err)
		}
		bodyReader = bytes.NewReader(payload)
		headers["Content-Type"] = "application/json"
	}

	req, err := http.NewRequest(method, kanjuBase+path, bodyReader)
	if err != nil {
		return zero, fmt.Errorf("看剧AI 构造请求失败：%s %s → %v", method, pathname, err)
	}
	for k, v := range headers {
		req.Header[k] = []string{v}
	}

	resp, err := kanjuHTTPClient.Do(req)
	if err != nil {
		return zero, fmt.Errorf("看剧AI 请求失败：%s %s → %v", method, pathname, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return zero, fmt.Errorf("看剧AI 接口失败：%s %s → HTTP %d", method, pathname, resp.StatusCode)
	}

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return zero, fmt.Errorf("看剧AI 读取响应失败：%s %s → %v", method, pathname, err)
	}

	var out T
	if err := json.Unmarshal(data, &out); err != nil {
		return zero, fmt.Errorf("看剧AI 响应解析失败：%s %s → %v", method, pathname, err)
	}
	return out, nil
}

// kanjuSign 用 SECRET 对 message 做 HMAC-SHA256，返回 hex。
func kanjuSign(message string) string {
	mac := hmac.New(sha256.New, []byte(kanjuSecret))
	mac.Write([]byte(message))
	return hex.EncodeToString(mac.Sum(nil))
}

// ==================== 原始报文类型（仅本文件内使用）====================
// json tag 与 TS 接口的 snake_case 字段一一对齐。可选数字字段用指针，
// 以精确复刻 TS 的 `??`（仅 null/undefined 才回退，present 的 0 不回退）。

type RawCard struct {
	ID          string   `json:"id"`
	Title       string   `json:"title"`
	ContentKind string   `json:"content_kind"`
	Year        int      `json:"year"`
	Area        string   `json:"area"`
	Genres      []string `json:"genres"`
	PosterURL   string   `json:"poster_url"`
	Remarks     string   `json:"remarks"`
}

type RawHome struct {
	Sections []struct {
		ID       string    `json:"id"`
		Title    string    `json:"title"`
		Subtitle string    `json:"subtitle"`
		Cards    []RawCard `json:"cards"`
	} `json:"sections"`
}

type RawBrowse struct {
	Cards      []RawCard `json:"cards"`
	Pagination *struct {
		Page    *int `json:"page"`
		HasMore bool `json:"has_more"`
	} `json:"pagination"`
}

type RawDetail struct {
	ID                string   `json:"id"`
	Title             string   `json:"title"`
	ContentKind       string   `json:"content_kind"`
	Year              int      `json:"year"`
	Area              string   `json:"area"`
	Genres            []string `json:"genres"`
	Description       string   `json:"description"`
	PosterURL         string   `json:"poster_url"`
	Remarks           string   `json:"remarks"`
	Actors            []string `json:"actors"`
	Directors         []string `json:"directors"`
	EpisodeCount      *int     `json:"episode_count"`
	TotalEpisodeCount *int     `json:"total_episode_count"`
}

// RawEpisode 对应 TS 内联的 episodes 元素类型。
type RawEpisode struct {
	ID     string `json:"id"`
	Token  string `json:"token"`
	Number *int   `json:"number"`
	Title  string `json:"title"`
}

type RawEpisodes struct {
	Episodes []RawEpisode `json:"episodes"`
}

type RawLineOption struct {
	PlaybackSourceID string `json:"playback_source_id"`
	ID               string `json:"id"`
	Label            string `json:"label"`
	DisplayLabel     string `json:"display_label"`
	ProviderName     string `json:"provider_name"`
	ProviderID       string `json:"provider_id"`
	URL              string `json:"url"`
	URLKind          string `json:"url_kind"`
	ResolveMode      string `json:"resolve_mode"`
	ResolveTicket    string `json:"resolve_ticket"`
	Selected         bool   `json:"selected"`
}

type RawResolve struct {
	LineOptions []RawLineOption `json:"line_options"`
}

type RawResolveLine struct {
	Line *struct {
		URL        string `json:"url"`
		URLKind    string `json:"url_kind"`
		Label      string `json:"label"`
		ProviderID string `json:"provider_id"`
	} `json:"line"`
}

// ==================== 归一化辅助 ====================

// kanjuCoalesce 返回第一个非空串（复刻 TS 的 `a ?? b ?? c` 在“缺省即空串”场景下的常见行为）。
func kanjuCoalesce(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}

// kanjuNonNilStrings 保证返回非 nil 切片（TS 的 `x ?? []`）。
func kanjuNonNilStrings(v []string) []string {
	if v == nil {
		return []string{}
	}
	return v
}

// kanjuMapKind 归一化内容类型，对应 TS mapKind。
func kanjuMapKind(raw string) MediaKind {
	switch raw {
	case "movie", "documentary":
		return KindMovie
	case "anime":
		return KindAnime
	case "variety", "sports":
		return KindVariety
	case "series", "short_drama", "tv":
		return KindSeries
	default:
		return KindSeries
	}
}

// kanjuMapCard 把原始卡片归一化为 RemoteCard，对应 TS mapCard。
func kanjuMapCard(card RawCard) RemoteCard {
	return RemoteCard{
		ID:        card.ID,
		Title:     card.Title,
		Kind:      kanjuMapKind(card.ContentKind),
		Year:      card.Year,
		Area:      card.Area,
		Genres:    kanjuNonNilStrings(card.Genres),
		Remarks:   card.Remarks,
		PosterURL: card.PosterURL,
	}
}

// kanjuDeriveUrlKind 推断直链类型，对应 TS deriveUrlKind。
// declared 为服务端声明（hls/m3u8/mp4）；否则按 url 后缀判断为 hls，默认 mp4。
func kanjuDeriveUrlKind(rawURL string, declared string) string {
	if declared == "hls" || declared == "m3u8" {
		return kanjuUrlKindHLS
	}
	if declared == "mp4" {
		return kanjuUrlKindMP4
	}
	if kanjuM3U8Re.MatchString(rawURL) {
		return kanjuUrlKindHLS
	}
	return kanjuUrlKindMP4
}

// kanjuToRemoteLines 把原始线路列表归一化为不含地址的 RemoteLine 列表。
func kanjuToRemoteLines(options []RawLineOption) []RemoteLine {
	lines := make([]RemoteLine, 0, len(options))
	for index, option := range options {
		id := kanjuCoalesce(option.PlaybackSourceID, option.ID)
		if id == "" {
			id = fmt.Sprintf("line-%d", index)
		}
		label := kanjuCoalesce(option.Label, option.DisplayLabel, option.ProviderName)
		if label == "" {
			label = id
		}
		lines = append(lines, RemoteLine{
			ID:         id,
			Label:      label,
			ProviderID: option.ProviderID,
			URLKind:    kanjuDeriveUrlKind(option.URL, option.URLKind),
		})
	}
	return lines
}

// kanjuOrderOptions 计算候选线路顺序：指定线路 > 默认选中 > 其余（去重）。
// 对应 TS orderOptions。
func kanjuOrderOptions(options []RawLineOption, lineID string) []RawLineOption {
	ordered := make([]RawLineOption, 0, len(options))
	seen := make(map[string]bool, len(options))
	push := func(option RawLineOption) {
		id := kanjuCoalesce(option.PlaybackSourceID, option.ID)
		if seen[id] {
			return
		}
		seen[id] = true
		ordered = append(ordered, option)
	}

	if lineID != "" {
		for _, option := range options {
			if kanjuCoalesce(option.PlaybackSourceID, option.ID) == lineID {
				push(option)
				break
			}
		}
	}

	for _, option := range options {
		if option.Selected {
			push(option)
			break
		}
	}

	for _, option := range options {
		push(option)
	}
	return ordered
}

// kanjuResolvedURL resolveLine 的返回结果。
type kanjuResolvedURL struct {
	url     string
	urlKind string
}

// kanjuResolveLine 单条线路 → 真实直链。`resolve://<ticket>` 需二次兑换。
func kanjuResolveLine(option RawLineOption) (kanjuResolvedURL, error) {
	url := strings.TrimSpace(option.URL)
	if strings.HasPrefix(url, "http") {
		return kanjuResolvedURL{url: url, urlKind: kanjuDeriveUrlKind(url, option.URLKind)}, nil
	}

	var ticket string
	if strings.HasPrefix(url, "resolve://") {
		ticket = url[len("resolve://"):]
	} else {
		ticket = strings.TrimSpace(option.ResolveTicket)
	}
	if ticket == "" {
		return kanjuResolvedURL{}, errors.New("线路缺少解析票据")
	}

	raw, err := kanjuRequest[RawResolveLine]("/v1/playback/resolve-line", kanjuRequestOptions{
		method: http.MethodPost,
		query:  []kanjuQueryParam{{key: "view", value: "compact"}},
		body: struct {
			Ticket string `json:"ticket"`
		}{Ticket: ticket},
	})
	if err != nil {
		return kanjuResolvedURL{}, err
	}

	resolved := ""
	resolvedKind := ""
	if raw.Line != nil {
		resolved = strings.TrimSpace(raw.Line.URL)
		resolvedKind = raw.Line.URLKind
	}
	if resolved == "" {
		return kanjuResolvedURL{}, errors.New("解析结果为空")
	}
	return kanjuResolvedURL{url: resolved, urlKind: kanjuDeriveUrlKind(resolved, resolvedKind)}, nil
}

// ==================== 对外接口 ====================

// kanjuHome 首页聚合：所有分区。
func kanjuHome() (RemoteHomeData, error) {
	raw, err := kanjuRequest[RawHome]("/v1/feed/home", kanjuRequestOptions{
		query: []kanjuQueryParam{
			{key: "scope", value: "public"},
			{key: "mode", value: "preview"},
			{key: "sections", value: 6},
			{key: "cards", value: 12},
		},
	})
	if err != nil {
		return RemoteHomeData{}, err
	}

	sections := make([]RemoteSection, 0, len(raw.Sections))
	outIndex := 0
	for _, section := range raw.Sections {
		if len(section.Cards) == 0 {
			continue
		}
		id := section.ID
		if id == "" {
			id = fmt.Sprintf("section-%d", outIndex)
		}
		title := section.Title
		if title == "" {
			title = "推荐"
		}
		cards := make([]RemoteCard, 0, len(section.Cards))
		for _, card := range section.Cards {
			cards = append(cards, kanjuMapCard(card))
		}
		sections = append(sections, RemoteSection{
			ID:       id,
			Title:    title,
			Subtitle: section.Subtitle,
			Cards:    cards,
		})
		outIndex++
	}
	return RemoteHomeData{Sections: sections}, nil
}

// kanjuBrowsePage 把原始浏览报文归一化为 RemoteBrowsePage。
func kanjuBrowsePage(raw RawBrowse, page int) RemoteBrowsePage {
	fallback := page
	if fallback < 1 {
		fallback = 1
	}
	resultPage := fallback
	hasMore := false
	if raw.Pagination != nil {
		if raw.Pagination.Page != nil {
			resultPage = *raw.Pagination.Page
		}
		hasMore = raw.Pagination.HasMore
	}

	cards := make([]RemoteCard, 0, len(raw.Cards))
	for _, card := range raw.Cards {
		cards = append(cards, kanjuMapCard(card))
	}
	return RemoteBrowsePage{Cards: cards, Page: resultPage, HasMore: hasMore}
}

// kanjuBrowse 分类浏览。kind 为空串表示不限类型。
func kanjuBrowse(kind string, page int) (RemoteBrowsePage, error) {
	p := page
	if p < 1 {
		p = 1
	}
	query := []kanjuQueryParam{
		{key: "page", value: p},
		{key: "limit", value: 24},
		{key: "intent", value: "latest_catalog"},
	}
	if kind != "" {
		query = append(query, kanjuQueryParam{key: "kind", value: kind})
	}
	raw, err := kanjuRequest[RawBrowse]("/v1/browse/catalog", kanjuRequestOptions{query: query})
	if err != nil {
		return RemoteBrowsePage{}, err
	}
	return kanjuBrowsePage(raw, page), nil
}

// kanjuSearch 搜索。
func kanjuSearch(keyword string, page int) (RemoteBrowsePage, error) {
	p := page
	if p < 1 {
		p = 1
	}
	query := []kanjuQueryParam{
		{key: "q", value: keyword},
		{key: "page", value: p},
		{key: "limit", value: 24},
	}
	raw, err := kanjuRequest[RawBrowse]("/v1/browse/catalog", kanjuRequestOptions{query: query})
	if err != nil {
		return RemoteBrowsePage{}, err
	}
	return kanjuBrowsePage(raw, page), nil
}

// kanjuDetail 作品详情。
func kanjuDetail(mediaID string) (RemoteDetail, error) {
	raw, err := kanjuRequest[RawDetail]("/v1/catalog/"+url.PathEscape(mediaID), kanjuRequestOptions{})
	if err != nil {
		return RemoteDetail{}, err
	}

	episodeCount := 0
	if raw.TotalEpisodeCount != nil {
		episodeCount = *raw.TotalEpisodeCount
	} else if raw.EpisodeCount != nil {
		episodeCount = *raw.EpisodeCount
	}

	return RemoteDetail{
		ID:           raw.ID,
		Title:        raw.Title,
		Kind:         kanjuMapKind(raw.ContentKind),
		Year:         raw.Year,
		Area:         raw.Area,
		Genres:       kanjuNonNilStrings(raw.Genres),
		Overview:     raw.Description,
		PosterURL:    raw.PosterURL,
		Remarks:      raw.Remarks,
		Actors:       kanjuNonNilStrings(raw.Actors),
		Directors:    kanjuNonNilStrings(raw.Directors),
		EpisodeCount: episodeCount,
	}, nil
}

// kanjuEpisodes 选集列表。
func kanjuEpisodes(mediaID string) ([]RemoteEpisode, error) {
	raw, err := kanjuRequest[RawEpisodes]("/v1/catalog/"+url.PathEscape(mediaID)+"/episodes", kanjuRequestOptions{})
	if err != nil {
		return nil, err
	}

	episodes := make([]RemoteEpisode, 0, len(raw.Episodes))
	for index, episode := range raw.Episodes {
		number := index + 1
		if episode.Number != nil {
			number = *episode.Number
		}
		title := episode.Title
		if title == "" {
			title = fmt.Sprintf("第 %d 集", number)
		}
		episodes = append(episodes, RemoteEpisode{
			ID:     episode.ID,
			Token:  episode.Token,
			Number: number,
			Title:  title,
		})
	}
	return episodes, nil
}

// kanjuResolve 按集 token 解析播放地址。
// 优先返回 mp4 直链（Chromium 原生可播）；全部为 HLS 时返回首个可解析结果。
func kanjuResolve(episodeToken, lineID string) (RemotePlayback, error) {
	raw, err := kanjuRequest[RawResolve]("/v1/playback/resolve/"+url.PathEscape(episodeToken), kanjuRequestOptions{})
	if err != nil {
		return RemotePlayback{}, err
	}

	options := raw.LineOptions
	if len(options) == 0 {
		return RemotePlayback{}, errors.New("该集暂无可用线路")
	}
	remoteLines := kanjuToRemoteLines(options)

	type fallbackLine struct {
		url     string
		urlKind string
		option  RawLineOption
	}
	var fallback *fallbackLine

	ordered := kanjuOrderOptions(options, lineID)
	if len(ordered) > 12 {
		ordered = ordered[:12]
	}

	for _, option := range ordered {
		resolved, rerr := kanjuResolveLine(option)
		if rerr != nil {
			continue
		}
		if resolved.urlKind == kanjuUrlKindMP4 {
			return RemotePlayback{
				URL:       resolved.url,
				URLKind:   kanjuUrlKindMP4,
				LineID:    kanjuCoalesce(option.PlaybackSourceID, option.ID),
				LineLabel: kanjuCoalesce(option.Label, option.DisplayLabel, option.ProviderName),
				Lines:     remoteLines,
			}, nil
		}
		if fallback == nil {
			fallback = &fallbackLine{url: resolved.url, urlKind: resolved.urlKind, option: option}
		}
	}

	if fallback != nil {
		return RemotePlayback{
			URL:       fallback.url,
			URLKind:   fallback.urlKind,
			LineID:    kanjuCoalesce(fallback.option.PlaybackSourceID, fallback.option.ID),
			LineLabel: kanjuCoalesce(fallback.option.Label, fallback.option.DisplayLabel),
			Lines:     remoteLines,
		}, nil
	}
	return RemotePlayback{}, errors.New("全部线路解析失败")
}

package main

// ==================== 本地媒体扫描（移植自 linux/src/main/library.ts） ====================
// 语义与原 TS 实现保持一致：只认本地视频扩展名；单文件=单集；同目录下
// 文件名匹配 SxxEyy 且前缀相同的归为同一部剧。桌面端无沙盒，路径即绝对路径。

import (
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

var videoExtensions = map[string]bool{
	".mp4": true, ".m4v": true, ".mov": true, ".mkv": true, ".webm": true,
}

// 剧集命名：`名字.S01E02.标题.mp4`；大小写与分隔符都放宽。
var episodePattern = regexp.MustCompile(`^(.*?)[.\s_-]*[Ss](\d{1,2})[.\s_-]*[Ee](\d{1,3})(.*)$`)

var (
	reLeadingBracket = regexp.MustCompile(`^\[[^\]]*\]\s*`)
	reDots           = regexp.MustCompile(`[._]+`)
	reYear           = regexp.MustCompile(`\s*\((\d{4})\)\s*`)
	reSpaces         = regexp.MustCompile(`\s+`)
	reLeadSep        = regexp.MustCompile(`^[.\s_-]+`)
	reSlugNonAlnum   = regexp.MustCompile(`[^a-z0-9]+`)
)

func isVideoFile(path string) bool {
	return videoExtensions[strings.ToLower(filepath.Ext(path))]
}

// cleanTitle 把 `[组名] 片名 (2020) 1080p` 收敛成可读标题。
func cleanTitle(raw string) string {
	s := reLeadingBracket.ReplaceAllString(raw, "")
	s = reDots.ReplaceAllString(s, " ")
	s = reYear.ReplaceAllString(s, " ")
	s = reSpaces.ReplaceAllString(s, " ")
	return strings.TrimSpace(s)
}

type parsedEpisode struct {
	seriesTitle  string
	seasonIndex  int
	index        int
	episodeTitle string
}

// parseEpisodeName 从文件名推断剧集信息；不匹配返回 nil。
func parseEpisodeName(fileName string) *parsedEpisode {
	stem := strings.TrimSuffix(filepath.Base(fileName), filepath.Ext(fileName))
	m := episodePattern.FindStringSubmatch(stem)
	if m == nil {
		return nil
	}
	seriesTitle := cleanTitle(m[1])
	if seriesTitle == "" {
		return nil
	}
	rest := strings.TrimSpace(reDots.ReplaceAllString(reLeadSep.ReplaceAllString(m[4], ""), " "))
	season, _ := strconv.Atoi(m[2])
	idx, _ := strconv.Atoi(m[3])
	title := rest
	if title == "" {
		title = "第 " + strconv.Itoa(idx) + " 集"
	}
	return &parsedEpisode{seriesTitle: seriesTitle, seasonIndex: season, index: idx, episodeTitle: title}
}

// collectVideoFiles 递归列出目录下的视频文件（最多 4 层，避免误扫盘根）。
func collectVideoFiles(root string, depth int) ([]string, error) {
	entries, err := os.ReadDir(root)
	if err != nil {
		return nil, err
	}
	var found []string
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), ".") {
			continue
		}
		full := filepath.Join(root, entry.Name())
		if entry.IsDir() {
			if depth > 0 {
				sub, err := collectVideoFiles(full, depth-1)
				if err == nil {
					found = append(found, sub...)
				}
			}
			continue
		}
		if isVideoFile(full) {
			found = append(found, full)
		}
	}
	sort.Strings(found)
	return found, nil
}

type episodeDraft struct {
	path   string
	title  string
	index  int
	season int
}

// buildLibrary 把一批视频文件归组成媒体条目。
func buildLibrary(files []string) LibraryScan {
	type bucket struct {
		title string
		files []episodeDraft
	}
	grouped := make(map[string]*bucket)
	var order []string // 保持首次出现顺序
	var movies []episodeDraft

	for _, path := range files {
		parsed := parseEpisodeName(path)
		if parsed == nil {
			movies = append(movies, episodeDraft{
				path: path, title: cleanTitle(strings.TrimSuffix(filepath.Base(path), filepath.Ext(path))), index: 1, season: 1,
			})
			continue
		}
		b, ok := grouped[parsed.seriesTitle]
		if !ok {
			b = &bucket{title: parsed.seriesTitle}
			grouped[parsed.seriesTitle] = b
			order = append(order, parsed.seriesTitle)
		}
		b.files = append(b.files, episodeDraft{
			path: path, title: parsed.episodeTitle, index: parsed.index, season: parsed.seasonIndex,
		})
	}

	items := make([]MediaItem, 0)
	episodes := make([]Episode, 0)

	for _, draft := range movies {
		mediaID := "local-" + strconv.Itoa(len(items)) + "-" + slug(draft.title)
		media := makeMediaItem(mediaID, draft.title, KindMovie, draft.path)
		items = append(items, media)
		episodes = append(episodes, makeEpisode(media, draft))
	}

	for _, key := range order {
		b := grouped[key]
		mediaID := "local-" + strconv.Itoa(len(items)) + "-" + slug(b.title)
		media := makeMediaItem(mediaID, b.title, KindSeries, b.files[0].path)
		items = append(items, media)
		ordered := append([]episodeDraft(nil), b.files...)
		sort.SliceStable(ordered, func(i, j int) bool {
			if ordered[i].season != ordered[j].season {
				return ordered[i].season < ordered[j].season
			}
			return ordered[i].index < ordered[j].index
		})
		for _, draft := range ordered {
			episodes = append(episodes, makeEpisode(media, draft))
		}
	}

	return LibraryScan{Items: items, Episodes: episodes}
}

func makeEpisode(media MediaItem, draft episodeDraft) Episode {
	return Episode{
		ID:          media.ID + "#s" + strconv.Itoa(draft.season) + "e" + strconv.Itoa(draft.index),
		MediaID:     media.ID,
		SeasonIndex: draft.season,
		Index:       draft.index,
		Title:       draft.title,
		Duration:    0, // 以视频实际解码时长为准，扫描阶段不解码
		FilePath:    draft.path,
	}
}

func makeMediaItem(id, title string, kind MediaKind, samplePath string) MediaItem {
	var size int64
	if info, err := os.Stat(samplePath); err == nil {
		size = info.Size()
	}
	return MediaItem{
		ID:        id,
		Title:     title,
		Kind:      kind,
		Year:      extractYear(title),
		Genres:    []string{},
		Overview:  "",
		FilePath:  samplePath,
		SizeBytes: size,
	}
}

func extractYear(title string) int {
	if m := reYear.FindStringSubmatch(title); m != nil {
		y, _ := strconv.Atoi(m[1])
		return y
	}
	return 0
}

// slug 生成稳定的 ASCII id 片段，避免中文路径进入 id。
func slug(title string) string {
	ascii := strings.Trim(reSlugNonAlnum.ReplaceAllString(strings.ToLower(title), "-"), "-")
	if ascii != "" {
		return ascii
	}
	var hash uint32
	for _, r := range title {
		hash = hash*31 + uint32(r)
	}
	return "h" + strconv.FormatUint(uint64(hash), 36)
}

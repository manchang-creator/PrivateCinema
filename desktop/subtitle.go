package main

// ==================== 字幕文件发现（移植自 linux/src/main/subtitle-file.ts） ====================
// 与视频同目录、同文件名（或带语言后缀）的字幕视为该视频的字幕。
// 优先级：精确同名 > .zh / .chs / .chi > .en；同优先级取字典序第一个。

import (
	"os"
	"path/filepath"
	"sort"
	"strings"
)

var subtitleExtensions = map[string]bool{".srt": true, ".vtt": true}

// 语言后缀优先级，越靠前越优先。
var languagePriority = []string{"zh", "chs", "chi", "zh-cn", "zh-hans", "sc", "en"}

func findSubtitleFor(videoPath string) *SubtitleFile {
	dir := filepath.Dir(videoPath)
	stem := strings.ToLower(strings.TrimSuffix(filepath.Base(videoPath), filepath.Ext(videoPath)))

	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil
	}

	type candidate struct {
		path  string
		score int
	}
	var candidates []candidate
	for _, entry := range entries {
		name := entry.Name()
		ext := strings.ToLower(filepath.Ext(name))
		if !subtitleExtensions[ext] {
			continue
		}
		nameStem := strings.ToLower(strings.TrimSuffix(name, filepath.Ext(name)))
		if !strings.HasPrefix(nameStem, stem) {
			continue
		}
		suffix := nameStem[len(stem):]
		// 只允许「完全同名」或「同名 + 语言后缀」，避免 a.srt 抢走 ab.mp4 的字幕。
		if suffix != "" {
			switch suffix[0] {
			case '.', '-', '_', ' ':
			default:
				continue
			}
		}
		candidates = append(candidates, candidate{path: filepath.Join(dir, name), score: scoreSuffix(suffix)})
	}
	if len(candidates) == 0 {
		return nil
	}
	sort.SliceStable(candidates, func(i, j int) bool {
		if candidates[i].score != candidates[j].score {
			return candidates[i].score < candidates[j].score
		}
		return candidates[i].path < candidates[j].path
	})
	sub, _ := readSubtitle(candidates[0].path)
	return sub
}

func readSubtitle(path string) (*SubtitleFile, error) {
	content, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	return &SubtitleFile{Name: filepath.Base(path), Content: string(content)}, nil
}

// scoreSuffix 分数越小越优先。
func scoreSuffix(suffix string) int {
	if suffix == "" {
		return 0
	}
	token := strings.ToLower(strings.TrimLeft(suffix, ".-_ "))
	for i, lang := range languagePriority {
		if token == lang {
			return i + 1
		}
	}
	return len(languagePriority) + 1
}

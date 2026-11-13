package main

// ==================== 播放进度存储（移植自 linux/src/main/progress.ts） ====================
// 单一真相源：后端独占一个 JSON 文件，前端只能经绑定读写。
// 原子写入（先写临时文件再 rename），避免进程中途被杀留下半截文件。

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"sync"
)

type progressFile struct {
	Version int             `json:"version"`
	Records []WatchProgress `json:"records"`
}

// ProgressStore 线程安全的进度存储。
type ProgressStore struct {
	mu       sync.Mutex
	filePath string
	cache    *progressFile
}

func newProgressStore(userDataDir string) *ProgressStore {
	return &ProgressStore{filePath: filepath.Join(userDataDir, "progress.json")}
}

func (s *ProgressStore) readLocked() *progressFile {
	if s.cache != nil {
		return s.cache
	}
	var pf progressFile
	if raw, err := os.ReadFile(s.filePath); err == nil {
		if json.Unmarshal(raw, &pf) != nil || pf.Records == nil {
			pf = progressFile{Version: 1, Records: []WatchProgress{}}
		}
	} else {
		// 首次运行 / 文件损坏：从空表开始。进度是纯本地可重建数据。
		pf = progressFile{Version: 1, Records: []WatchProgress{}}
	}
	pf.Version = 1
	s.cache = &pf
	return s.cache
}

func (s *ProgressStore) writeLocked(pf *progressFile) error {
	s.cache = pf
	if err := os.MkdirAll(filepath.Dir(s.filePath), 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(pf, "", "  ")
	if err != nil {
		return err
	}
	tmp := s.filePath + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, s.filePath)
}

func (s *ProgressStore) Load(mediaID, episodeID string) *WatchProgress {
	s.mu.Lock()
	defer s.mu.Unlock()
	pf := s.readLocked()
	for i := range pf.Records {
		if pf.Records[i].MediaID == mediaID && pf.Records[i].EpisodeID == episodeID {
			rec := pf.Records[i]
			return &rec
		}
	}
	return nil
}

func (s *ProgressStore) List() []WatchProgress {
	s.mu.Lock()
	defer s.mu.Unlock()
	pf := s.readLocked()
	out := make([]WatchProgress, len(pf.Records))
	copy(out, pf.Records)
	sort.SliceStable(out, func(i, j int) bool { return out[i].LastPlayedAt > out[j].LastPlayedAt })
	return out
}

func (s *ProgressStore) Save(p WatchProgress) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	pf := s.readLocked()
	replaced := false
	for i := range pf.Records {
		if pf.Records[i].MediaID == p.MediaID && pf.Records[i].EpisodeID == p.EpisodeID {
			pf.Records[i] = p
			replaced = true
			break
		}
	}
	if !replaced {
		pf.Records = append(pf.Records, p)
	}
	return s.writeLocked(pf)
}

func (s *ProgressStore) Remove(mediaID, episodeID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	pf := s.readLocked()
	next := make([]WatchProgress, 0, len(pf.Records))
	for _, r := range pf.Records {
		if r.MediaID == mediaID && r.EpisodeID == episodeID {
			continue
		}
		next = append(next, r)
	}
	if len(next) == len(pf.Records) {
		return nil
	}
	pf.Records = next
	return s.writeLocked(pf)
}

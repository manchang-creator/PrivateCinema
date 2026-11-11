// ==================== 应用外壳 ====================
// 只有两个状态：片库 / 播放。播放状态带齐播放所需的一切，
// 播放页因此不需要再回查任何全局状态。

import { useCallback, useState, type JSX } from 'react'
import type { Episode, MediaItem } from '@shared/types'
import { LibraryScreen } from './ui/LibraryScreen'
import { PlayerScreen } from './player/PlayerScreen'

interface PlaybackState {
  media: MediaItem
  episode: Episode
  playlist: Episode[]
  startPosition: number
}

export function App(): JSX.Element {
  const [items, setItems] = useState<MediaItem[]>([])
  const [episodes, setEpisodes] = useState<Episode[]>([])
  const [playback, setPlayback] = useState<PlaybackState | null>(null)

  const handleScan = useCallback((scan: { items: MediaItem[]; episodes: Episode[] }) => {
    setItems(scan.items)
    setEpisodes(scan.episodes)
  }, [])

  const handlePlay = useCallback(
    (media: MediaItem, episode: Episode, startPosition: number) => {
      const playlist = episodes
        .filter((item) => item.mediaId === media.id)
        .sort((a, b) => a.seasonIndex - b.seasonIndex || a.index - b.index)
      setPlayback({ media, episode, playlist, startPosition })
    },
    [episodes],
  )

  const handleSelectEpisode = useCallback(
    (episode: Episode) => {
      setPlayback((previous) => {
        if (previous === null) return previous
        // 换集从头播放；进度由播放页的卸载钩子落盘
        return { ...previous, episode, startPosition: 0 }
      })
    },
    [],
  )

  if (playback !== null) {
    return (
      <PlayerScreen
        // key 保证换集时组件重建：视频元素与弹幕引擎都必须从干净状态开始
        key={`${playback.media.id}:${playback.episode.id}:${playback.startPosition}`}
        media={playback.media}
        episode={playback.episode}
        playlist={playback.playlist}
        startPosition={playback.startPosition}
        onSelectEpisode={handleSelectEpisode}
        onExit={() => setPlayback(null)}
      />
    )
  }

  return (
    <LibraryScreen
      items={items}
      episodes={episodes}
      onScan={handleScan}
      onPlay={handlePlay}
    />
  )
}

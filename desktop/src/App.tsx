// ==================== 应用外壳 ====================
// 只有两个状态：浏览（外壳 + 页面）与播放（全屏播放页）。
// 浏览侧维护一个自己实现的 history 栈，顶栏的「前进 / 后退」走它，
// 而不是浏览器 history —— 这样返回详情页、返回来源列表都能精确还原。

import { useCallback, useEffect, useMemo, useState, type JSX } from 'react'
import type { Episode, MediaItem, RemoteCard, WatchProgress } from '@private-cinema/core/shared'
import { remotePlaylist } from './lib/media-kit'
import { subscribeMeta } from './lib/remote-cache'
import {
  NAV_ITEMS,
  navOf,
  type DetailTarget,
  type NavName,
  type Route,
} from './lib/router'
import { useHistory } from './lib/store'
import { DetailPage } from './ui/DetailPage'
import { FollowingPage } from './ui/FollowingPage'
import { HomeScreen } from './ui/HomeScreen'
import { LibraryScreen } from './ui/LibraryScreen'
import { SearchPage } from './ui/SearchPage'
import { SettingsPage } from './ui/SettingsPage'
import { Shell } from './ui/Shell'
import { PlayerScreen } from './player/PlayerScreen'
import { accentVars } from './ui/palette'

interface PlaybackState {
  media: MediaItem
  episode: Episode
  playlist: Episode[]
  startPosition: number
}

const MAX_STACK = 40

export function App(): JSX.Element {
  const [items, setItems] = useState<MediaItem[]>([])
  const [episodes, setEpisodes] = useState<Episode[]>([])
  const [progress, setProgress] = useState<WatchProgress[]>([])
  const [playback, setPlayback] = useState<PlaybackState | null>(null)

  // 浏览历史栈：stack[cursor] 是当前页
  const [stack, setStack] = useState<Route[]>([{ name: 'home' }])
  const [cursor, setCursor] = useState(0)
  const route = stack[cursor] ?? { name: 'home' }
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const history = useHistory()

  // 远端元数据缓存更新（详情拉回来后补上标题/封面）→ 让 detail 页重渲染
  const [, setMetaTick] = useState(0)
  useEffect(() => subscribeMeta(() => setMetaTick((value) => value + 1)), [])

  const refreshProgress = useCallback(async () => {
    try {
      setProgress(await window.cinema.listProgress())
    } catch {
      setProgress([])
    }
  }, [])

  useEffect(() => {
    void refreshProgress()
  }, [refreshProgress])

  // 从播放页返回后进度可能已更新
  useEffect(() => {
    if (playback === null) void refreshProgress()
  }, [playback, refreshProgress])

  // ==================== 导航 ====================

  const go = useCallback(
    (next: Route) => {
      setStack((previous) => {
        const trimmed = previous.slice(0, cursor + 1)
        const last = trimmed[trimmed.length - 1]
        // 同页重复点击不压栈
        if (last !== undefined && JSON.stringify(last) === JSON.stringify(next)) return previous
        return [...trimmed, next].slice(-MAX_STACK)
      })
      setCursor((current) => Math.min(current + 1, MAX_STACK - 1))
    },
    [cursor],
  )

  const back = useCallback(() => setCursor((current) => Math.max(0, current - 1)), [])
  const forward = useCallback(
    () => setCursor((current) => Math.min(stack.length - 1, current + 1)),
    [stack.length],
  )

  const navigate = useCallback(
    (name: NavName) => {
      if (name === 'home') go({ name: 'home' })
      else if (name === 'library') go({ name: 'library' })
      else if (name === 'following') go({ name: 'following' })
      else if (name === 'search') go({ name: 'search', keyword: '' })
      else go({ name: 'settings' })
    },
    [go],
  )

  const openDetail = useCallback((target: DetailTarget) => go({ name: 'detail', target }), [go])
  const search = useCallback((keyword: string) => go({ name: 'search', keyword }), [go])

  // ==================== 扫描本地片库 ====================

  const scan = useCallback(
    async (mode: 'files' | 'folder') => {
      setBusy(true)
      setError(null)
      try {
        const result =
          mode === 'files' ? await window.cinema.pickVideos() : await window.cinema.pickFolder()
        if (result === null) return
        if (result.items.length === 0) {
          setError('没有找到可播放的视频文件（支持 mp4 / m4v / mov / mkv / webm）')
          return
        }
        // 追加而不是覆盖：已有条目保持不变，新条目并进来
        setItems((previous) => {
          const map = new Map(previous.map((item) => [item.id, item]))
          for (const item of result.items) map.set(item.id, item)
          return [...map.values()]
        })
        setEpisodes((previous) => {
          const map = new Map(previous.map((item) => [item.id, item]))
          for (const item of result.episodes) map.set(item.id, item)
          return [...map.values()]
        })
        await refreshProgress()
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : '扫描失败')
      } finally {
        setBusy(false)
      }
    },
    [refreshProgress],
  )

  // ==================== 播放 ====================

  const handlePlay = useCallback(
    (media: MediaItem, episode: Episode, startPosition: number, playlist: Episode[]) => {
      setPlayback({ media, episode, playlist, startPosition })
      // 记一条历史（本地与在线都记，追剧页的「历史」分段用得上）
      history.push({ mediaId: media.id, episodeId: episode.id, title: media.title, cover: '' })
    },
    [history],
  )

  const handleSelectEpisode = useCallback((next: Episode) => {
    setPlayback((previous) => {
      if (previous === null) return previous
      // 换集从头播放；进度由播放页的卸载钩子落盘
      return { ...previous, episode: next, startPosition: 0 }
    })
  }, [])

  const removeRecord = useCallback(
    async (record: WatchProgress) => {
      try {
        await window.cinema.removeProgress({
          mediaId: record.mediaId,
          episodeId: record.episodeId,
        })
        await refreshProgress()
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : '移除记录失败')
      }
    },
    [refreshProgress],
  )

  // 远端作品直接开播（首页 banner / 详情的播放按钮都走这里）
  const playRemote = useCallback(
    async (
      provider: string,
      card: RemoteCard,
      list: ReadonlyArray<{ id: string; number: number; title: string; token: string }>,
      startIndex: number,
    ) => {
      const { media, playlist } = remotePlaylist(provider, card, list)
      const target = playlist[startIndex] ?? playlist[0]
      if (target === undefined) {
        setError('这部作品还没有可播放的选集')
        return
      }
      handlePlay(media, target, 0, playlist)
    },
    [handlePlay],
  )

  // ==================== 渲染 ====================

  const nav = navOf(route)

  const ambientSeed = useMemo(() => {
    if (route.name === 'detail') return route.target.title
    if (route.name === 'search') return route.keyword === '' ? '私人影院' : route.keyword
    return NAV_ITEMS.find((item) => item.name === nav)?.label ?? '私人影院'
  }, [route, nav])

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

  const page = ((): JSX.Element => {
    switch (route.name) {
      case 'library':
        return (
          <LibraryScreen
            items={items}
            episodes={episodes}
            busy={busy}
            error={error}
            onScan={scan}
            onOpen={(media) =>
              openDetail({ source: 'local', provider: 'local', id: media.id, title: media.title, cover: '' })
            }
          />
        )
      case 'following':
        return (
          <FollowingPage
            items={items}
            episodes={episodes}
            progress={progress}
            onOpenDetail={openDetail}
            onPlayLocal={(media, episode, start) =>
              handlePlay(
                media,
                episode,
                start,
                episodes
                  .filter((entry) => entry.mediaId === media.id)
                  .sort((a, b) => a.seasonIndex - b.seasonIndex || a.index - b.index),
              )
            }
            onRemoveProgress={(record) => void removeRecord(record)}
            onBrowse={() => navigate('home')}
          />
        )
      case 'search':
        return <SearchPage keyword={route.keyword} onOpenDetail={openDetail} onSearch={search} />
      case 'settings':
        return <SettingsPage />
      case 'detail':
        return (
          <DetailPage
            target={route.target}
            items={items}
            episodes={episodes}
            onPlayLocal={(media, episode, start) =>
              handlePlay(
                media,
                episode,
                start,
                episodes
                  .filter((entry) => entry.mediaId === media.id)
                  .sort((a, b) => a.seasonIndex - b.seasonIndex || a.index - b.index),
              )
            }
            onPlayRemote={(provider, card, list, index) => void playRemote(provider, card, list, index)}
            onOpenDetail={openDetail}
            onBack={back}
          />
        )
      default:
        return (
          <HomeScreen
            items={items}
            episodes={episodes}
            progress={progress}
            busy={busy}
            onOpenDetail={openDetail}
            onPlayLocal={(media, episode, start) =>
              handlePlay(
                media,
                episode,
                start,
                episodes
                  .filter((entry) => entry.mediaId === media.id)
                  .sort((a, b) => a.seasonIndex - b.seasonIndex || a.index - b.index),
              )
            }
            onPlayRemote={(provider, card, list, index) => void playRemote(provider, card, list, index)}
            onSearch={search}
            onLibrary={() => navigate('library')}
            onScan={scan}
          />
        )
    }
  })()

  return (
    <Shell
      route={route}
      nav={nav}
      canBack={cursor > 0}
      canForward={cursor < stack.length - 1}
      onBack={back}
      onForward={forward}
      onNavigate={navigate}
      onSearch={search}
      hero={route.name === 'home' || route.name === 'detail'}
      style={accentVars(ambientSeed)}
    >
      {page}
    </Shell>
  )
}

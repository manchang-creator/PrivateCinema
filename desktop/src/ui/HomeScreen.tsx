// ==================== 首页 ====================
// 结构参考 B 站首页 + 腾讯视频首页：
//   1. 全幅轮播 banner（数据不足时用「继续观看」顶上，不摆空壳）；
//   2. 类型快捷入口（电影 / 剧集 / 动漫 / 综艺 / 短剧），一点直达筛选结果；
//   3. 智能分档货架：想看没看完 → 类型货架 → 最新 → 高分；
//   4. 每个货架都有骨架屏，首屏不会先空一屏再「砰」地填满。

import { useCallback, useEffect, useMemo, useState, type JSX } from 'react'
import {
  REMOTE_PROVIDERS,
  type Episode,
  type MediaItem,
  type RemoteCard,
  type RemoteSection,
} from '@private-cinema/core/shared'
import { formatTime } from '@private-cinema/core/ui'
import { remotePlaylist, sortEpisodes, kindLabel } from '../lib/media-kit'
import { getMeta, rememberCard } from '../lib/remote-cache'
import { TRENDING } from '../lib/remote-cache'
import type { DetailTarget } from '../lib/router'
import { rememberCandidate, useWeekOffset, useWeeklyBoard } from '../lib/weekly'
import { HeroCarousel, type HeroItem } from './HeroCarousel'
import { PosterCard } from './PosterCard'
import { Rail, SectionHead } from './Rail'
import { WeeklyCalendar, todaySummary } from './WeeklyCalendar'
import { Icon, type IconName } from './icons'

interface Props {
  items: MediaItem[]
  episodes: Episode[]
  progress: WatchProgressLite[]
  onOpenDetail: (target: DetailTarget) => void
  onPlayLocal: (media: MediaItem, episode: Episode, position: number) => void
  onPlayRemote: (
    provider: string,
    card: RemoteCard,
    episodes: ReadonlyArray<{ id: string; number: number; title: string; token: string }>,
    startIndex: number,
  ) => void
  onSearch: (keyword: string) => void
  onLibrary: () => void
  onScan: (mode: 'files' | 'folder') => void
  busy: boolean
}

interface WatchProgressLite {
  mediaId: string
  episodeId: string
  mediaTitle: string
  episodeTitle: string
  position: number
  duration: number
  completed: boolean
}

const QUICK_KINDS: ReadonlyArray<{ key: string; label: string; icon: IconName }> = [
  { key: 'movie', label: '电影', icon: 'star' },
  { key: 'series', label: '剧集', icon: 'layers' },
  { key: 'anime', label: '动漫', icon: 'fire' },
  { key: 'variety', label: '综艺', icon: 'calendar' },
  { key: 'short', label: '短剧', icon: 'clock' },
]

export function HomeScreen({
  items,
  episodes,
  progress,
  onOpenDetail,
  onPlayLocal,
  onPlayRemote,
  onSearch,
  onLibrary,
  onScan,
  busy,
}: Props): JSX.Element {
  const [sections, setSections] = useState<RemoteSection[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  // 本周追剧：日历自己维护数据，货架里出现的连载作品顺手登记成「可能在追」的候选
  const [weekOffset, setWeekOffset] = useWeekOffset()
  const weekly = useWeeklyBoard(weekOffset, setWeekOffset)

  // 首页聚合：两个片源并发拉，任一失败不影响另一家
  const loadHome = useCallback(() => {
    setSections(null)
    setError(null)
    void Promise.all(
      REMOTE_PROVIDERS.map((provider) =>
        window.cinema
          .remoteHome(provider.id)
          .then((data) => data.sections)
          .catch(() => [] as RemoteSection[]),
      ),
    ).then((groups) => {
      const merged: RemoteSection[] = []
      let index = 0
      // 交错合并：A 区1、B 区1、A 区2、B 区2…，两家片源都能露脸
      const max = Math.max(...groups.map((group) => group.length), 0)
      for (let round = 0; round < max; round += 1) {
        groups.forEach((group, groupIndex) => {
          const section = group[round]
          if (section === undefined) return
          index += 1
          const provider = REMOTE_PROVIDERS[groupIndex]?.id ?? 'kanju'
          for (const card of section.cards) {
            rememberCard(provider, card)
            rememberCandidate(provider, card)
          }
          merged.push({
            ...section,
            id: `${provider}-${section.id}-${index}`,
            subtitle:
              section.subtitle !== ''
                ? section.subtitle
                : (REMOTE_PROVIDERS[groupIndex]?.name ?? ''),
          })
        })
      }
      if (merged.length === 0) setError('在线片源暂时不可用，先看看本地片库或换个时间再试。')
      setSections(merged)
    })
  }, [])

  useEffect(() => {
    loadHome()
  }, [loadHome])

  // ==================== 本地继续观看 ====================
  const continueRecords = useMemo(() => {
    const valid = progress.filter(
      (record) =>
        items.some((item) => item.id === record.mediaId) &&
        episodes.some((item) => item.id === record.episodeId),
    )
    const active = valid.filter((record) => !record.completed)
    const done = valid.filter((record) => record.completed)
    return [...active, ...done].slice(0, 12)
  }, [progress, items, episodes])

  const continueHero = useMemo<HeroItem[]>(
    () =>
      continueRecords.slice(0, 6).map((record) => {
        const media = items.find((item) => item.id === record.mediaId)
        const remaining = Math.max(0, record.duration - record.position)
        return {
          id: `${record.mediaId}:${record.episodeId}`,
          title: record.mediaTitle,
          cover: '',
          summary: record.completed
            ? `${record.episodeTitle} 已看完，接着往后看。`
            : `${record.episodeTitle} · 还剩 ${formatTime(remaining)}`,
          tags: ['继续观看', media === undefined ? '本地片库' : kindLabel(media.kind)],
          corner: `${Math.round((record.position / Math.max(1, record.duration)) * 100)}%`,
        }
      }),
    [continueRecords, items],
  )

  const remoteHero = useMemo<HeroItem[]>(() => {
    const first = sections?.[0]?.cards ?? []
    const second = sections?.[1]?.cards ?? []
    const pool = [...first.slice(0, 5), ...second.slice(0, 2)]
    const seen = new Set<string>()
    return pool
      .filter((card) => {
        if (seen.has(card.id)) return false
        seen.add(card.id)
        return true
      })
      .map((card) => {
        const meta = getMeta('kanju', card.id) ?? getMeta('hongguo', card.id)
        return {
          id: card.id,
          title: card.title,
          cover: card.posterUrl,
          summary:
            card.genres.length > 0
              ? `${card.area !== '' ? `${card.area} · ` : ''}${card.genres.join(' / ')}`
              : '点击查看完整简介与选集。',
          tags: [kindLabel(card.kind), card.year > 0 ? String(card.year) : '', card.area, card.remarks],
          corner: card.remarks,
          // 下面两个字段不进 Hero，用来回查卡片
          provider: meta?.provider,
        } as HeroItem & { provider?: string }
      })
  }, [sections])

  const heroItems = continueHero.length > 0 ? continueHero : remoteHero
  const heroSource = continueHero.length > 0 ? 'local' : 'remote'

  const playHero = useCallback(
    (item: HeroItem) => {
      if (heroSource === 'local') {
        const [mediaId, episodeId] = item.id.split(':')
        const media = items.find((entry) => entry.id === mediaId)
        const episode = episodes.find((entry) => entry.id === episodeId)
        if (media === undefined || episode === undefined) return
        const record = progress.find(
          (entry) => entry.mediaId === mediaId && entry.episodeId === episodeId,
        )
        onPlayLocal(media, episode, record?.position ?? 0)
        return
      }
      void openRemote(item)
    },
    [episodes, heroSource, items, onPlayLocal, progress],
  )

  const openRemote = useCallback(
    async (item: HeroItem) => {
      const provider = (item as HeroItem & { provider?: 'kanju' | 'hongguo' }).provider ?? 'kanju'
      const list = await window.cinema.remoteEpisodes(provider, item.id).catch(() => [])
      if (list.length === 0) {
        onOpenDetail({ source: 'remote', provider, id: item.id, title: item.title, cover: item.cover })
        return
      }
      const card: RemoteCard = {
        id: item.id,
        title: item.title,
        kind: 'series',
        year: 0,
        area: '',
        genres: [],
        remarks: item.corner ?? '',
        posterUrl: item.cover,
      }
      onPlayRemote(provider, card, list, 0)
    },
    [onOpenDetail, onPlayRemote],
  )

  const detailHero = useCallback(
    (item: HeroItem) => {
      if (heroSource === 'local') {
        const [mediaId] = item.id.split(':')
        onOpenDetail({ source: 'local', provider: 'local', id: mediaId, title: item.title, cover: '' })
        return
      }
      const provider = (item as HeroItem & { provider?: string }).provider ?? 'kanju'
      onOpenDetail({ source: 'remote', provider, id: item.id, title: item.title, cover: item.cover })
    },
    [heroSource, onOpenDetail],
  )

  const playRecord = useCallback(
    (record: WatchProgressLite) => {
      const media = items.find((entry) => entry.id === record.mediaId)
      const episode = episodes.find((entry) => entry.id === record.episodeId)
      if (media === undefined || episode === undefined) return
      onPlayLocal(media, episode, record.position)
    },
    [episodes, items, onPlayLocal],
  )

  const localRecent = useMemo(() => {
    return [...items]
      .sort((a, b) => (b.year ?? 0) - (a.year ?? 0) || a.title.localeCompare(b.title, 'zh'))
      .slice(0, 12)
  }, [items])

  const empty = items.length === 0 && sections !== null && sections.length === 0

  return (
    <div className="page home">
      <HeroCarousel
        items={heroItems}
        onPlay={playHero}
        onDetail={detailHero}
        playLabel={heroSource === 'local' ? '继续观看' : '立即播放'}
      />

      <div className="page-inner">
        {/* 类型快捷入口：一点直达搜索 / 筛选 */}
        <div className="quick-row" role="list" aria-label="类型快捷入口">
          {QUICK_KINDS.map((entry) => (
            <button
              key={entry.key}
              type="button"
              role="listitem"
              className="quick-chip"
              onClick={() =>
                entry.key === 'short' ? onSearch('短剧') : onSearch(kindLabel(entry.key))
              }
            >
              <span className="quick-chip-icon">
                <Icon name={entry.icon} size={17} />
              </span>
              {entry.label}
            </button>
          ))}
          <span className="quick-sep" aria-hidden="true" />
          <button type="button" className="quick-chip ghost" onClick={() => onScan('folder')} disabled={busy}>
            <span className="quick-chip-icon">
              <Icon name="folder-open" size={17} />
            </span>
            导入本地影片
          </button>
        </div>

        {error !== null && <div className="notice error">{error}</div>}

        {/* 本周追剧：一眼看到今天更什么、动漫落在一周哪几天；点开发就是完整行程单 */}
        <WeeklyCalendar
          board={weekly}
          compact
          onOpenDetail={onOpenDetail}
          headerHint={todaySummary(weekly)}
        />

        {/* 继续观看：只在有本地记录时出现，卡片走 16:9 横排 */}
        {continueRecords.length > 0 && (
          <section className="section">
            <SectionHead
              title="继续观看"
              sub={`${continueRecords.length} 部在追`}
              action={
                <button type="button" className="link-btn" onClick={onLibrary}>
                  全部片库
                  <Icon name="chevron-right" size={14} />
                </button>
              }
            />
            <Rail>
              {continueRecords.map((record) => {
                const media = items.find((item) => item.id === record.mediaId)
                const pct =
                  record.duration > 0
                    ? Math.min(100, Math.round((record.position / record.duration) * 100))
                    : 0
                return (
                  <PosterCard
                    key={`${record.mediaId}:${record.episodeId}`}
                    className="pcard-wide"
                    title={record.mediaTitle}
                    cover=""
                    sub={`${record.episodeTitle} · ${
                      record.completed ? '已看完' : `还剩 ${formatTime(Math.max(0, record.duration - record.position))}`
                    }`}
                    badge={media === undefined ? '' : kindLabel(media.kind)}
                    tag={`${pct}%`}
                    progress={pct}
                    done={record.completed}
                    onClick={() => playRecord(record)}
                  />
                )
              })}
            </Rail>
          </section>
        )}

        {/* 在线货架 */}
        {sections === null && (
          <>
            <SkeletonRow title="为你推荐" />
            <SkeletonRow title="热门剧集" />
          </>
        )}

        {sections !== null &&
          sections.slice(0, 8).map((section, index) => {
            const provider = section.id.startsWith('hongguo') ? 'hongguo' : 'kanju'
            return (
              <section key={section.id} className="section">
                <SectionHead
                  title={section.title}
                  sub={section.subtitle}
                  action={
                    <button
                      type="button"
                      className="link-btn"
                      onClick={() => onSearch(section.title)}
                    >
                      更多
                      <Icon name="chevron-right" size={14} />
                    </button>
                  }
                />
                <Rail alwaysNav={index === 0} autoPlayMs={index === 0 ? 8000 : undefined}>
                  {section.cards.map((card) => (
                    <PosterCard
                      key={`${section.id}-${card.id}`}
                      className={index === 0 ? 'pcard-lg' : undefined}
                      title={card.title}
                      cover={card.posterUrl}
                      tag={card.remarks}
                      sub={[card.year > 0 ? String(card.year) : '', card.area, kindLabel(card.kind)]
                        .filter((part) => part !== '')
                        .join(' · ')}
                      titleInCover={index === 0}
                      onClick={() =>
                        onOpenDetail({
                          source: 'remote',
                          provider,
                          id: card.id,
                          title: card.title,
                          cover: card.posterUrl,
                        })
                      }
                    />
                  ))}
                </Rail>
              </section>
            )
          })}

        {/* 本地最近添加 */}
        {localRecent.length > 0 && (
          <section className="section">
            <SectionHead
              title="本地片库"
              sub={`${items.length} 部作品`}
              action={
                <button type="button" className="link-btn" onClick={onLibrary}>
                  进入片库
                  <Icon name="chevron-right" size={14} />
                </button>
              }
            />
            <Rail>
              {localRecent.map((media) => {
                const own = sortEpisodes(episodes.filter((item) => item.mediaId === media.id))
                return (
                  <PosterCard
                    key={media.id}
                    title={media.title}
                    cover=""
                    tag={kindLabel(media.kind)}
                    sub={[media.year > 0 ? String(media.year) : '', `${own.length} 集`]
                      .filter((part) => part !== '')
                      .join(' · ')}
                    onClick={() =>
                      onOpenDetail({
                        source: 'local',
                        provider: 'local',
                        id: media.id,
                        title: media.title,
                        cover: '',
                      })
                    }
                  />
                )
              })}
            </Rail>
          </section>
        )}

        {empty && (
          <div className="empty-state">
            <span className="empty-icon">
              <Icon name="folder-open" size={30} />
            </span>
            <h3>还没有内容</h3>
            <p>在线片源暂时取不到数据。先把本地影片导入，随时可以离线看。</p>
            <button type="button" className="btn-primary" onClick={() => onScan('folder')}>
              <Icon name="folder" size={16} />
              选择文件夹
            </button>
          </div>
        )}

        <footer className="page-foot">
          <span>私人影院 PrivateCinema</span>
          <span>本地播放 · 在线聚合 · 弹幕字幕</span>
          <button type="button" className="link-btn" onClick={loadHome}>
            <Icon name="refresh" size={13} />
            刷新首页
          </button>
        </footer>
      </div>
    </div>
  )
}

function SkeletonRow({ title }: { title: string }): JSX.Element {
  return (
    <section className="section">
      <SectionHead title={title} />
      <div className="rail">
        {Array.from({ length: 7 }).map((_, index) => (
          <div key={index} className="pcard skeleton">
            <span className="pcard-poster sk-block" />
            <span className="sk-line" />
            <span className="sk-line short" />
          </div>
        ))}
      </div>
    </section>
  )
}

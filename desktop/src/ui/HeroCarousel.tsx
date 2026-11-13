// ==================== Hero 大图轮播 ====================
// 首页与详情页共用。对齐 B 站/腾讯视频首页 banner：
//   - 全幅背景图（模糊放大的封面 + 压暗），前景信息左对齐；
//   - 右下角缩略图导航，当前项高亮；
//   - 左「播放」右「详情」双按钮；
//   - 自动轮播，鼠标悬浮暂停，尊重 reduced-motion。

import { useEffect, useState, type CSSProperties, type JSX } from 'react'
import { proxiedPoster } from './PosterCard'
import { posterGradient } from './palette'
import { Icon } from './icons'

export interface HeroItem {
  id: string
  title: string
  cover: string
  /** 一行摘要 */
  summary: string
  /** 标签：类型 / 年份 / 地区 / 更新状态 */
  tags: string[]
  /** 角标上的小字，例如「全 24 集」 */
  corner?: string
}

interface Props {
  items: HeroItem[]
  onPlay: (item: HeroItem) => void
  onDetail: (item: HeroItem) => void
  playLabel?: string
  autoPlayMs?: number
  /** 缩略图导航最多显示几个 */
  thumbs?: number
}

export function HeroCarousel({
  items,
  onPlay,
  onDetail,
  playLabel = '立即播放',
  autoPlayMs = 7000,
  thumbs = 7,
}: Props): JSX.Element | null {
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)

  // 数据换掉时回到第一条
  useEffect(() => {
    setIndex(0)
  }, [items])

  const total = items.length
  const safeIndex = total === 0 ? 0 : index % total

  useEffect(() => {
    if (total <= 1 || paused) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const timer = window.setInterval(() => {
      setIndex((current) => (current + 1) % total)
    }, autoPlayMs)
    return () => window.clearInterval(timer)
  }, [total, paused, autoPlayMs])

  if (total === 0) return null
  const current = items[safeIndex]
  if (current === undefined) return null
  const cover = proxiedPoster(current.cover)

  return (
    <section
      className="hero"
      aria-label="主推内容"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div
        className="hero-bg"
        aria-hidden="true"
        /* 缺图（本地裸文件没有海报）时用标题散列出的渐变兜底，深/浅主题都能用 */
        style={cover === '' ? posterGradient(current.title) : undefined}
      >
        {cover !== '' && <img src={cover} alt="" referrerPolicy="no-referrer" />}
        <span className="hero-veil" />
      </div>

      <div className="hero-body" key={current.id}>
        <div className="hero-text">
          <div className="hero-tags">
            {current.tags
              .filter((tag) => tag !== '')
              .slice(0, 5)
              .map((tag, position) => (
                <span key={`${tag}-${position}`} className={position === 0 ? 'tag solid' : 'tag'}>
                  {tag}
                </span>
              ))}
          </div>
          <h1 className="hero-title">{current.title}</h1>
          <p className="hero-summary">{current.summary}</p>
          <div className="hero-actions">
            <button type="button" className="btn-primary" onClick={() => onPlay(current)}>
              <Icon name="play" size={16} />
              {playLabel}
            </button>
            <button type="button" className="btn-glass" onClick={() => onDetail(current)}>
              <Icon name="info" size={16} />
              详情
            </button>
          </div>
        </div>

        {total > 1 && (
          <div className="hero-thumbs" role="tablist" aria-label="主推切换">
            {items.slice(0, thumbs).map((item, position) => {
              const thumbCover = proxiedPoster(item.cover)
              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={position === safeIndex}
                  aria-label={item.title}
                  className={position === safeIndex ? 'hero-thumb active' : 'hero-thumb'}
                  style={heroThumbStyle(thumbCover)}
                  onClick={() => setIndex(position)}
                >
                  {thumbCover === '' && <span>{item.title.slice(0, 1)}</span>}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {current.corner !== undefined && current.corner !== '' && (
        <span className="hero-corner">{current.corner}</span>
      )}
    </section>
  )
}

function heroThumbStyle(cover: string): CSSProperties {
  return cover === ''
    ? {}
    : { backgroundImage: `url("${cover.replace(/"/g, '%22')}")` }
}

// ==================== 通用海报卡 ====================
// 一个组件覆盖全站三处用法：横排大卡（hero/货架）、网格卡、横向列表卡。
// 真正的差异只有尺寸，所以尺寸全交给父级（.rail / .poster-grid / .poster-list）的 CSS，
// 这里只负责：封面（含远端封面代理与失败兜底）、角标、进度条、播放浮层。

import { useState, type CSSProperties, type JSX } from 'react'
import { getMediaBase } from '../media'
import { Icon } from './icons'
import { percentOf, shortTitle, shortTitleSize } from '../lib/media-kit'
import { posterGradient } from './palette'

interface Props {
  title: string
  cover: string
  /** 右上角 / 左下角角标文案，例如「更新至16集」 */
  badge?: string
  /** 左上角标签，例如「剧集」 */
  tag?: string
  /** 副标题，例如「2026 · 中国大陆 · 剧集」 */
  sub?: string
  /** 观看进度（0–100），0 表示不显示 */
  progress?: number
  /** 已看完：进度条换成「已看完」标记 */
  done?: boolean
  /** 大卡在封面里显示片名（B 站番剧卡片做法） */
  titleInCover?: boolean
  onClick?: () => void
  onRemove?: () => void
  removeLabel?: string
  className?: string
  style?: CSSProperties
}

/**
 * 封面 URL 归一：红果等片源的封面是 HEIC/HEIF，WebView 解不了，走后端 loopback
 * 海报代理（Go 侧转 JPEG）；其它格式（jpg/png/webp）原样直连。
 */
export function proxiedPoster(raw: string): string {
  if (raw === '') return ''
  if (!/\.(heic|heif)(\?|#|$)/i.test(raw)) return raw
  const base = getMediaBase()
  if (base === '') return raw
  return `${base}poster?u=${encodeURIComponent(raw)}`
}

export function PosterCard({
  title,
  cover,
  badge,
  tag,
  sub,
  progress,
  done,
  titleInCover,
  onClick,
  onRemove,
  removeLabel,
  className,
  style,
}: Props): JSX.Element {
  const [broken, setBroken] = useState(false)
  const src = proxiedPoster(cover)
  // 三种状态要能看出区别：
  //   有图且没坏 → 正常封面；有图但加载失败 → broken，显示「封面加载失败」；
  //   上游本来就没图 → 显示完整短标题 + 类型标签，底色走 posterGradient。
  const hasCover = src !== ''
  const placeholder = !hasCover || broken
  const showProgress = progress !== undefined && progress > 0
  const pct = percentOf(progress ?? 0, 100)

  return (
    <div className={className === undefined ? 'pcard' : `pcard ${className}`} style={style}>
      <button
        type="button"
        className="pcard-main"
        onClick={onClick}
        aria-label={title === '' ? '查看详情' : title}
      >
        <span className="pcard-poster" style={posterGradient(title)}>
          {placeholder && (
            <span className="pcard-art" aria-hidden="true">
              <span className="pcard-art-title" style={{ fontSize: `${shortTitleSize(title)}px` }}>
                {shortTitle(title)}
              </span>
              {broken ? (
                <span className="pcard-art-note">封面加载失败</span>
              ) : (
                tag !== undefined &&
                tag !== '' && <span className="pcard-art-note">{tag}</span>
              )}
            </span>
          )}
          {src !== '' && !broken && (
            <img
              className="pcard-img"
              src={src}
              alt=""
              loading="lazy"
              referrerPolicy="no-referrer"
              onError={() => setBroken(true)}
            />
          )}
          <span className="pcard-scrim" aria-hidden="true" />

          {tag !== undefined && tag !== '' && <span className="pcard-tag">{tag}</span>}
          {badge !== undefined && badge !== '' && <span className="pcard-badge">{badge}</span>}

          {titleInCover === true && (
            <span className="pcard-cover-title" aria-hidden="true">
              {title}
            </span>
          )}

          <span className="pcard-play" aria-hidden="true">
            <Icon name="play" size={16} />
          </span>

          {showProgress && (
            <span className={done === true ? 'pcard-progress done' : 'pcard-progress'} aria-hidden="true">
              <span className="pcard-progress-fill" style={{ width: `${pct}%` }} />
            </span>
          )}
        </span>
        <span className="pcard-title">{title}</span>
        {sub !== undefined && sub !== '' && <span className="pcard-sub">{sub}</span>}
        {showProgress && (
          <span className="pcard-meta">{done === true ? '已看完' : `已看 ${pct}%`}</span>
        )}
      </button>

      {onRemove !== undefined && (
        <button
          type="button"
          className="pcard-remove"
          aria-label={removeLabel ?? `移除「${title}」`}
          title={removeLabel ?? '移除'}
          onClick={(event) => {
            event.stopPropagation()
            onRemove()
          }}
        >
          <Icon name="close" size={13} />
        </button>
      )}
    </div>
  )
}

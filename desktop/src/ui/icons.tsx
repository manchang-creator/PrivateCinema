// ==================== 内联图标集 ====================
// 全部 24×24 线性图标，颜色跟随 currentColor，描边圆角端点，不引入图标依赖。
// 命名对齐界面语义（home/fire/…）而不是图形，方便换皮时只改这里。

import type { JSX, SVGProps } from 'react'

export type IconName =
  | 'home'
  | 'fire'
  | 'history'
  | 'heart'
  | 'heart-filled'
  | 'play'
  | 'pause'
  | 'search'
  | 'settings'
  | 'monitor'
  | 'folder'
  | 'folder-open'
  | 'file'
  | 'star'
  | 'like'
  | 'comment'
  | 'share'
  | 'chevron-left'
  | 'chevron-right'
  | 'chevron-down'
  | 'close'
  | 'calendar'
  | 'layers'
  | 'clock'
  | 'arrow-left'
  | 'arrow-right'
  | 'refresh'
  | 'info'
  | 'grid'
  | 'list'
  | 'volume'
  | 'volume-mute'
  | 'subtitles'
  | 'danmaku'
  | 'brightness'
  | 'expand'
  | 'shrink'
  | 'skip-back'
  | 'skip-forward'
  | 'menu'
  | 'trash'
  | 'sort'

const CHILDREN: Record<IconName, JSX.Element> = {
  home: (
    <>
      <path d="M4 10.5L12 4l8 6.5" />
      <path d="M6 10v9.5h12V10" />
    </>
  ),
  fire: (
    <path d="M12 3.5c3 3.2 5.5 5.4 5.5 9a5.5 5.5 0 11-11 0c0-2 .9-3.4 2.2-4.7.4 1.2 1 1.9 1.8 2.2.6-2.2.7-4.3 1.5-6.5z" />
  ),
  history: (
    <>
      <path d="M3.6 12a8.4 8.4 0 108.4-8.4A8.4 8.4 0 004.4 8" />
      <path d="M3.4 3.9V8.4h4.5" />
      <path d="M12 7.6V12l3.1 1.8" />
    </>
  ),
  heart: <path d="M12 20s-7.5-4.6-7.5-9.3A4.2 4.2 0 0112 7.9a4.2 4.2 0 017.5 2.8C19.5 15.4 12 20 12 20z" />,
  'heart-filled': (
    <path
      d="M12 20s-7.5-4.6-7.5-9.3A4.2 4.2 0 0112 7.9a4.2 4.2 0 017.5 2.8C19.5 15.4 12 20 12 20z"
      fill="currentColor"
    />
  ),
  play: <path d="M8 5.2v13.6L19 12z" fill="currentColor" stroke="none" />,
  pause: <path d="M8 5.5v13M16 5.5v13" strokeWidth={2.4} />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.4-3.4" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.5v2.6M12 18.9v2.6M4.2 4.2l1.9 1.9M17.9 17.9l1.9 1.9M2.5 12h2.6M18.9 12h2.6M4.2 19.8l1.9-1.9M17.9 6.1l1.9-1.9" />
    </>
  ),
  monitor: (
    <>
      <rect x="2.5" y="4" width="19" height="12.5" rx="2.2" />
      <path d="M8 20.5h8M12 16.5v4" />
    </>
  ),
  folder: <path d="M3 7.2a2 2 0 012-2h4.1l2 2.1H19a2 2 0 012 2v8.5a2 2 0 01-2 2H5a2 2 0 01-2-2z" />,
  'folder-open': (
    <>
      <path d="M3 7.2a2 2 0 012-2h4.1l2 2.1H19a2 2 0 012 2v1.2H3z" />
      <path d="M3 10.5h18l-2 8.2a1.6 1.6 0 01-1.6 1.3H6.6A1.6 1.6 0 015 18.7z" />
    </>
  ),
  file: (
    <>
      <path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z" />
      <path d="M14 3v5h5" />
    </>
  ),
  star: <path d="M12 3.6l2.55 5.17 5.7.83-4.13 4.03.98 5.68L12 16.63l-5.1 2.68.98-5.68L3.75 9.6l5.7-.83z" />,
  like: (
    <>
      <path d="M7 20V10l4.2-6a2 2 0 013.4 1.6L14 10h4.4a2.2 2.2 0 012.1 2.8l-1.5 5.6A2.2 2.2 0 0116.9 20z" />
      <path d="M7 10H4.2v10H7" />
    </>
  ),
  comment: (
    <path d="M4.5 4.5h15a1.5 1.5 0 011.5 1.5v9.5a1.5 1.5 0 01-1.5 1.5H9.2L5 20.2v-3.2H4.5A1.5 1.5 0 013 15.5V6a1.5 1.5 0 011.5-1.5z" />
  ),
  share: (
    <>
      <circle cx="18" cy="5.5" r="2.6" />
      <circle cx="6" cy="12" r="2.6" />
      <circle cx="18" cy="18.5" r="2.6" />
      <path d="M8.3 10.7l7.4-3.9M8.3 13.3l7.4 3.9" />
    </>
  ),
  'chevron-left': <path d="M15 5l-7 7 7 7" />,
  'chevron-right': <path d="M9 5l7 7-7 7" />,
  'chevron-down': <path d="M5 9l7 7 7-7" />,
  close: <path d="M6.2 6.2l11.6 11.6M17.8 6.2L6.2 17.8" />,
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2.2" />
      <path d="M3 9.6h18M8 3v4M16 3v4" />
    </>
  ),
  layers: (
    <>
      <path d="M12 3l9 5-9 5-9-5z" />
      <path d="M3 13l9 5 9-5" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.6" />
      <path d="M12 7.2v5.1l3.2 1.9" />
    </>
  ),
  'arrow-left': <path d="M19.5 12H4.5M10.5 6L4.5 12l6 6" />,
  'arrow-right': <path d="M4.5 12h15M13.5 6l6 6-6 6" />,
  refresh: (
    <>
      <path d="M20 11a8 8 0 10-2.4 5.7" />
      <path d="M20 4.5V11h-6.5" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.6" />
      <path d="M12 11v5.2M12 7.9h.01" />
    </>
  ),
  grid: (
    <>
      <rect x="4" y="4" width="7" height="7" rx="1.6" />
      <rect x="13" y="4" width="7" height="7" rx="1.6" />
      <rect x="4" y="13" width="7" height="7" rx="1.6" />
      <rect x="13" y="13" width="7" height="7" rx="1.6" />
    </>
  ),
  list: (
    <>
      <path d="M4 6.5h16M4 12h16M4 17.5h16" />
    </>
  ),
  volume: (
    <>
      <path d="M4 9.2v5.6h3.6L13 19V5L7.6 9.2z" />
      <path d="M16.2 9.4a4 4 0 010 5.2" />
    </>
  ),
  'volume-mute': (
    <>
      <path d="M4 9.2v5.6h3.6L13 19V5L7.6 9.2z" />
      <path d="M16.5 9.5l4.5 5M21 9.5l-4.5 5" />
    </>
  ),
  subtitles: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2.2" />
      <path d="M7 13.5h4.2M13.2 13.5H17" />
    </>
  ),
  danmaku: (
    <>
      <path d="M4.5 4.5h15a1.5 1.5 0 011.5 1.5v9.5a1.5 1.5 0 01-1.5 1.5H9.2L5 20.2v-3.2H4.5A1.5 1.5 0 013 15.5V6a1.5 1.5 0 011.5-1.5z" />
      <path d="M7 9h6.5M7 12.2h9.4" />
    </>
  ),
  brightness: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.4v2.2M12 19.4v2.2M2.4 12h2.2M19.4 12h2.2M5.1 5.1l1.6 1.6M17.3 17.3l1.6 1.6M18.9 5.1l-1.6 1.6M6.7 17.3l-1.6 1.6" />
    </>
  ),
  expand: <path d="M4 9V4.5h4.5M15.5 4.5H20V9M20 15v4.5h-4.5M8.5 19.5H4V15" />,
  shrink: <path d="M9 4.5V9H4.5M19.5 9H15V4.5M15 19.5V15h4.5M4.5 15H9v4.5" />,
  'skip-back': (
    <>
      <path d="M18 6.5v11L9.5 12z" fill="currentColor" stroke="none" />
      <path d="M6 6v12" />
    </>
  ),
  'skip-forward': (
    <>
      <path d="M6 6.5v11L14.5 12z" fill="currentColor" stroke="none" />
      <path d="M18 6v12" />
    </>
  ),
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  trash: (
    <>
      <path d="M4.5 7h15M9.5 7V4.8h5V7M6.5 7l.9 12.4a1.6 1.6 0 001.6 1.5h6a1.6 1.6 0 001.6-1.5L17.5 7" />
      <path d="M10.5 10.8v6M13.5 10.8v6" />
    </>
  ),
  sort: (
    <>
      <path d="M7 4.5v15M4 16.5l3 3 3-3" />
      <path d="M14 6.5h6M14 12h4.5M14 17.5h3" />
    </>
  ),
}

interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName
  size?: number
}

export function Icon({ name, size = 18, ...rest }: IconProps): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {CHILDREN[name]}
    </svg>
  )
}

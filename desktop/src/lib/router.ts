// ==================== 路由 ====================
// 桌面端不需要 URL 路由：一个 history 栈 + 前进后退就够了。
// 结构对齐 B 站的「返回 / 前进」与腾讯视频的侧栏一级入口：
//   home / library / following / search / detail / player
// 详情与播放都进栈，所以从播放页返回会先回到详情页，再返回到列表页。

export interface DetailTarget {
  source: 'local' | 'remote'
  provider: string
  /** 作品 id */
  id: string
  /** 已知标题，详情加载中也能显示 */
  title: string
  cover: string
}

export type Route =
  | { name: 'home' }
  | { name: 'library' }
  | { name: 'following' }
  | { name: 'search'; keyword: string }
  | { name: 'detail'; target: DetailTarget }
  | { name: 'settings' }

export type NavName = 'home' | 'library' | 'following' | 'search' | 'settings'

export const NAV_ITEMS: ReadonlyArray<{ name: NavName; label: string }> = [
  { name: 'home', label: '首页' },
  { name: 'library', label: '片库' },
  { name: 'following', label: '追剧' },
  { name: 'search', label: '搜索' },
  { name: 'settings', label: '设置' },
]

/** 只有这几个一级页会高亮侧栏；详情/播放页保留来源页的高亮。 */
export function navOf(route: Route): NavName {
  switch (route.name) {
    case 'home':
    case 'library':
    case 'following':
    case 'search':
    case 'settings':
      return route.name
    case 'detail':
      return route.target.source === 'remote' ? 'home' : 'library'
    default:
      return 'home'
  }
}

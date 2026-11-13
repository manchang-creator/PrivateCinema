// ==================== 应用外壳：侧栏 + 顶栏 ====================
// 布局参考 B 站（左侧一级导航常驻、可折叠）与腾讯视频（顶栏搜索居中、右侧账号/设置）。
// 外壳只管「往哪儿去」和「搜什么」，页面内容全部由 App 交给具体 Screen 渲染。
//
// 关键交互：
//   - 侧栏折叠状态持久化；折叠后只剩图标，鼠标悬浮出 tooltip；
//   - 顶栏历史前进/后退（不是浏览器 history，是自己维护的栈）；
//   - 全局搜索：任何页面按 / 都能聚焦，Enter 直接跳到搜索页。

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
  type ReactNode,
} from 'react'
import { NAV_ITEMS, type NavName, type Route } from '../lib/router'
import { useRailCollapsed, useSearchHistory } from '../lib/store'
import { Icon, type IconName } from './icons'
import { DisplayMenu } from './DisplayMenu'
import { SettingsMenu } from './SettingsMenu'

const NAV_ICON: Record<NavName, IconName> = {
  home: 'home',
  library: 'folder',
  following: 'heart',
  search: 'search',
  settings: 'settings',
}

interface Props {
  route: Route
  nav: NavName
  canBack: boolean
  canForward: boolean
  onBack: () => void
  onForward: () => void
  onNavigate: (name: NavName) => void
  onSearch: (keyword: string) => void
  children: ReactNode
  /** 顶栏右侧额外动作（本地页的「选择文件夹」等） */
  actions?: ReactNode
  /** 首页/详情页：顶栏透明浮在 hero 上，内容延伸到窗口顶部 */
  hero?: boolean
  style?: CSSProperties
}

export function Shell({
  route,
  nav,
  canBack,
  canForward,
  onBack,
  onForward,
  onNavigate,
  onSearch,
  children,
  actions,
  hero,
  style,
}: Props): JSX.Element {
  const [collapsed, setCollapsed] = useRailCollapsed()
  const [keyword, setKeyword] = useState(route.name === 'search' ? route.keyword : '')
  const [focused, setFocused] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const history = useSearchHistory()

  // 路由切换时同步搜索框：搜索页显示当前关键词，其它页清空
  useEffect(() => {
    setKeyword(route.name === 'search' ? route.keyword : '')
  }, [route])

  // 按 / 聚焦搜索框（桌面端约定俗成的快捷键）
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return
      event.preventDefault()
      inputRef.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const submit = useCallback(
    (value: string) => {
      const trimmed = value.trim()
      if (trimmed === '') return
      history.push(trimmed)
      onSearch(trimmed)
      inputRef.current?.blur()
    },
    [history, onSearch],
  )

  // 搜索联想：聚焦且有历史时露出来
  const suggestions =
    focused && keyword.trim() === '' ? history.list.slice(0, 8) : []

  return (
    <div className={hero === true ? 'shell hero-shell' : 'shell'} style={style}>
      <aside className={collapsed ? 'sidebar collapsed' : 'sidebar'}>
        <div className="sidebar-brand">
          <span className="sidebar-mark" aria-hidden="true">
            <Icon name="play" size={14} />
          </span>
          {!collapsed && (
            <span className="sidebar-name">
              私人<b>影院</b>
            </span>
          )}
        </div>

        <nav className="sidebar-nav" aria-label="主导航">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.name}
              type="button"
              className={nav === item.name ? 'sidebar-item active' : 'sidebar-item'}
              aria-current={nav === item.name ? 'page' : undefined}
              title={collapsed ? item.label : undefined}
              onClick={() => onNavigate(item.name)}
            >
              <Icon name={NAV_ICON[item.name]} size={19} />
              {!collapsed && <span>{item.label}</span>}
            </button>
          ))}
        </nav>

        <button
          type="button"
          className="sidebar-collapse"
          aria-label={collapsed ? '展开侧栏' : '收起侧栏'}
          title={collapsed ? '展开侧栏' : '收起侧栏'}
          onClick={() => setCollapsed(!collapsed)}
        >
          <Icon name={collapsed ? 'chevron-right' : 'chevron-left'} size={16} />
        </button>
      </aside>

      <div className="shell-main">
        <header className={hero === true ? 'topbar floating' : 'topbar'}>
          <div className="topbar-left">
            <button
              type="button"
              className="nav-btn"
              aria-label="后退"
              title="后退"
              disabled={!canBack}
              onClick={onBack}
            >
              <Icon name="chevron-left" size={18} />
            </button>
            <button
              type="button"
              className="nav-btn"
              aria-label="前进"
              title="前进"
              disabled={!canForward}
              onClick={onForward}
            >
              <Icon name="chevron-right" size={18} />
            </button>
            <div className="search-wrap">
              <form
                className="search-bar"
                onSubmit={(event) => {
                  event.preventDefault()
                  submit(keyword)
                }}
              >
                <Icon name="search" size={16} />
                <input
                  ref={inputRef}
                  className="search-input"
                  value={keyword}
                  placeholder="搜索电影、剧集、动漫、短剧"
                  aria-label="搜索"
                  onChange={(event) => setKeyword(event.target.value)}
                  onFocus={() => setFocused(true)}
                  onBlur={() => window.setTimeout(() => setFocused(false), 120)}
                />
                {keyword !== '' && (
                  <button
                    type="button"
                    className="search-clear"
                    aria-label="清空搜索"
                    onClick={() => {
                      setKeyword('')
                      inputRef.current?.focus()
                    }}
                  >
                    <Icon name="close" size={13} />
                  </button>
                )}
                <button type="submit" className="search-submit">
                  搜索
                </button>
              </form>

              {suggestions.length > 0 && (
                <div className="search-suggest" role="listbox" aria-label="搜索历史">
                  <div className="search-suggest-head">
                    <span>搜索历史</span>
                    <button
                      type="button"
                      onMouseDown={(event) => {
                        event.preventDefault()
                        history.clear()
                      }}
                    >
                      清空
                    </button>
                  </div>
                  {suggestions.map((item) => (
                    <button
                      key={item}
                      type="button"
                      className="search-suggest-item"
                      role="option"
                      aria-selected={false}
                      onMouseDown={(event) => {
                        event.preventDefault()
                        setKeyword(item)
                        submit(item)
                      }}
                    >
                      <Icon name="history" size={14} />
                      <span>{item}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="topbar-right">
            {actions}
            <DisplayMenu />
            <SettingsMenu />
          </div>
        </header>

        <main className="viewport">{children}</main>
      </div>
    </div>
  )
}

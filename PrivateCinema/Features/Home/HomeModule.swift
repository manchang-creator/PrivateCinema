import Foundation

/// 首页模块（可由用户在设置里隐藏）。
enum HomeModule: String, CaseIterable, Identifiable {
    case continueWatching
    case recentUpdates
    case favorites
    case recentlyAdded
    case hotMovies
    case hotSeries
    case anime
    case variety

    var id: String { rawValue }

    /// Provider 首页 section id -> 模块（id 约定集中在此，HomeView 不做字符串映射）。
    private static let sectionIdMap: [String: HomeModule] = [
        "recent-updates": .recentUpdates,
        "recent-added": .recentlyAdded,
        "hot-movies": .hotMovies,
        "hot-series": .hotSeries,
        "anime": .anime,
        "variety": .variety,
    ]

    init?(sectionId: String) {
        guard let module = Self.sectionIdMap[sectionId] else { return nil }
        self = module
    }

    var displayName: String {
        switch self {
        case .continueWatching: return "继续观看"
        case .recentUpdates: return "最近更新"
        case .favorites: return "我的收藏"
        case .recentlyAdded: return "最近添加"
        case .hotMovies: return "热门电影"
        case .hotSeries: return "热门剧集"
        case .anime: return "动漫"
        case .variety: return "综艺"
        }
    }

    // MARK: - 持久化（隐藏列表）

    private static let storageKey = "home.hiddenModules"

    static func loadHidden() -> Set<HomeModule> {
        let raw = UserDefaults.standard.stringArray(forKey: storageKey) ?? []
        return Set(raw.compactMap(HomeModule.init(rawValue:)))
    }

    static func saveHidden(_ hidden: Set<HomeModule>) {
        UserDefaults.standard.set(hidden.map(\.rawValue), forKey: storageKey)
    }
}

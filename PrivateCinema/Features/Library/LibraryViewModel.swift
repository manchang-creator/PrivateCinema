import Foundation

/// 片库视图模型。
@MainActor
@Observable
final class LibraryViewModel {
    var kind: MediaKind? = nil
    var sort: LibrarySort = .recentlyAdded {
        didSet { resort() }
    }
    var watchStateFilter: WatchStateFilter = .any {
        didSet { applyWatchFilter() }
    }
    var isGridMode = UserDefaults.standard.object(forKey: "library.gridMode") as? Bool ?? true
    var state: LoadableState<[MediaItem]> = .idle

    /// mediaId ->（进度集数 / 是否看过）
    private(set) var watchInfo: [String: WatchSummary] = [:]

    struct WatchSummary {
        var currentEpisodeIndex: Int?
        var finishedCount: Int
        var hasProgress: Bool
    }

    private var allLoaded: [MediaItem] = []
    private var filtered: [MediaItem] = []
    private var page = 1

    func load(environment: AppEnvironment, reload: Bool = false) async {
        if reload {
            page = 1
            allLoaded = []
            state = .loading
        } else if case .loaded = state {
            // 保留已有内容
        } else {
            state = .loading
        }
        do {
            let items = try await environment.mediaProvider.catalog(
                kind: kind, page: 1, pageSize: 200
            )
            allLoaded = items
            loadWatchInfo(environment: environment)
            resort()
        } catch {
            state = .failed(AppError.from(error))
        }
    }

    private func loadWatchInfo(environment: AppEnvironment) {
        var info: [String: WatchSummary] = [:]
        for item in allLoaded {
            let progresses = environment.history.progresses(mediaId: item.id)
            let current = progresses
                .filter { !$0.completed }
                .sorted { $0.episodeIndex < $1.episodeIndex }
                .last?.episodeIndex
            info[item.id] = WatchSummary(
                currentEpisodeIndex: current,
                finishedCount: progresses.filter(\.completed).count,
                hasProgress: !progresses.isEmpty
            )
        }
        watchInfo = info
    }

    private func resort() {
        var items = allLoaded
        switch sort {
        case .recentlyAdded: break // catalog 默认按更新时间
        case .recentlyWatched:
            items.sort { (watchInfo[$0.id]?.hasProgress ?? false) && !(watchInfo[$1.id]?.hasProgress ?? false) }
        case .name:
            items.sort { $0.title < $1.title }
        case .year:
            items.sort { $0.year > $1.year }
        case .rating:
            items.sort { $0.rating > $1.rating }
        case .recentlyUpdated:
            items.sort { $0.updatedAt > $1.updatedAt }
        }
        filtered = items
        applyWatchFilter()
    }

    private func applyWatchFilter() {
        var items = filtered
        switch watchStateFilter {
        case .any:
            break
        case .unwatched:
            items = items.filter { !(watchInfo[$0.id]?.hasProgress ?? false) }
        case .watching:
            items = items.filter { watchInfo[$0.id]?.currentEpisodeIndex != nil }
        case .finished:
            items = items.filter { item in
                guard let summary = watchInfo[item.id], summary.hasProgress else { return false }
                return summary.currentEpisodeIndex == nil
            }
        }
        state = .loaded(items)
    }

    func setGridMode(_ grid: Bool) {
        isGridMode = grid
        UserDefaults.standard.set(grid, forKey: "library.gridMode")
    }
}

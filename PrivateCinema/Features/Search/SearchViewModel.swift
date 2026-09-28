import Foundation

/// 搜索页视图模型：防抖搜索 + 筛选。
@MainActor
@Observable
final class SearchViewModel {
    var query = "" {
        didSet { scheduleSearch() }
    }
    var filters = SearchFilters.none {
        didSet { scheduleSearch() }
    }

    var state: LoadableState<[MediaItem]> = .idle

    private let environment: AppEnvironment
    private var searchTask: Task<Void, Never>?

    init(environment: AppEnvironment) {
        self.environment = environment
    }

    private func scheduleSearch() {
        searchTask?.cancel()
        searchTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 300_000_000)
            guard let self, !Task.isCancelled else { return }
            await self.search()
        }
    }

    func search() async {
        state = .loading
        do {
            let results = try await environment.mediaProvider.search(
                keyword: query,
                filters: filters
            )
            guard !Task.isCancelled else { return }
            state = .loaded(results)
        } catch {
            guard !Task.isCancelled else { return }
            state = .failed(AppError.from(error))
        }
    }

    /// 筛选页候选：类型 / 年代等固定集合。
    static let areas = ["中国大陆", "中国台湾", "美国", "英国", "日本", "韩国"]
    static let genres = [
        "科幻", "悬疑", "爱情", "喜剧", "动作", "剧情",
        "动画", "热血", "治愈", "美食", "音乐", "真人秀",
    ]
    static let yearRanges: [(String, ClosedRange<Int>?)] = [
        ("全部年代", nil),
        ("2025 - 现在", 2025...2030),
        ("2020 - 2024", 2020...2024),
        ("2010 - 2019", 2010...2019),
        ("2010 之前", 1990...2009),
    ]
    static let ratingSteps: [(String, Double?)] = [
        ("不限评分", nil), ("8 分以上", 8.0), ("7 分以上", 7.0), ("6 分以上", 6.0),
    ]
}

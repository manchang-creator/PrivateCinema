import Foundation

/// Mock 媒体源：保证 App 开箱即可跑通全部流程。
/// 视频为公开测试流，数据全部内存构造。
public struct MockMediaProvider: MediaProvider {

    public let info = ProviderInfo(
        id: "mock",
        name: "演示媒体库",
        kind: .mock,
        description: "内置演示内容，用于体验全部功能"
    )

    /// 显式公开初始化：`AppEnvironment` 的公开默认参数会引用本类型，
    /// 合成的 `init()` 是 internal，跨包不可见。
    public init() {}

    private static let allItems: [MediaItem] = MockContent.movies + MockContent.seriesPlans.map {
        MockContent.seriesItem(from: $0)
    }

    private static func plan(for mediaId: String) -> MockContent.MockSeriesPlan? {
        MockContent.seriesPlans.first { $0.id == mediaId }
    }

    // MARK: - MediaProvider

    public func home() async throws -> HomeData {
        let items = Self.allItems
        let sections: [HomeSection] = [
            HomeSection(id: "recent-updates", title: "最近更新",
                        items: items.sorted { $0.updatedAt > $1.updatedAt }),
            HomeSection(id: "recent-added", title: "最近添加",
                        items: items.reversed()),
            HomeSection(id: "hot-movies", title: "热门电影",
                        items: items.filter { $0.kind == .movie }.sorted { $0.rating > $1.rating }),
            HomeSection(id: "hot-series", title: "热门剧集",
                        items: items.filter { $0.kind == .series }.sorted { $0.rating > $1.rating }),
            HomeSection(id: "anime", title: "动漫",
                        items: items.filter { $0.kind == .anime }),
            HomeSection(id: "variety", title: "综艺",
                        items: items.filter { $0.kind == .variety }),
        ]
        return HomeData(sections: sections)
    }

    public func search(keyword: String, filters: SearchFilters) async throws -> [MediaItem] {
        try await Task.sleep(nanoseconds: 250_000_000) // 模拟网络延迟
        let key = keyword.trimmingCharacters(in: .whitespacesAndNewlines)
        var items = Self.allItems

        if !key.isEmpty {
            items = items.filter { item in
                item.title.localizedCaseInsensitiveContains(key)
                    || item.overview.localizedCaseInsensitiveContains(key)
                    || item.cast.contains { $0.name.localizedCaseInsensitiveContains(key) }
                    || item.directors.contains { $0.name.localizedCaseInsensitiveContains(key) }
                    || item.genres.contains { $0.localizedCaseInsensitiveContains(key) }
            }
        }
        return applyFilters(filters, to: items)
    }

    public func catalog(kind: MediaKind?, page: Int, pageSize: Int) async throws -> [MediaItem] {
        try await Task.sleep(nanoseconds: 150_000_000)
        var items = Self.allItems
        if let kind {
            items = items.filter { $0.kind == kind }
        }
        let start = (page - 1) * pageSize
        guard start < items.count else { return [] }
        let end = min(start + pageSize, items.count)
        return Array(items.sorted { $0.updatedAt > $1.updatedAt }[start..<end])
    }

    public func detail(id: String) async throws -> MediaDetail {
        if let plan = Self.plan(for: id) {
            let item = MockContent.seriesItem(from: plan)
            return MediaDetail(
                item: item,
                seasons: MockContent.seasons(for: plan),
                episodesBySeason: [1: MockContent.episodes(for: plan)],
                related: relatedFor(item)
            )
        }
        guard let movie = Self.movie(for: id) else {
            throw AppError.notFound
        }
        // 电影同样需要季集结构：详情页的选集区与"播放"按钮都由 allEpisodes 驱动，
        // 返回空数组会让电影既无法播放也无法显示进度。
        return MediaDetail(
            item: movie,
            seasons: MockContent.movieSeasons(for: movie),
            episodesBySeason: [1: [MockContent.movieEpisode(for: movie)]],
            related: relatedFor(movie)
        )
    }

    public func episodes(id: String) async throws -> [Episode] {
        if let plan = Self.plan(for: id) {
            return MockContent.episodes(for: plan)
        }
        guard let movie = Self.movie(for: id) else {
            throw AppError.notFound
        }
        return [MockContent.movieEpisode(for: movie)]
    }

    public func playInfo(episodeId: String) async throws -> PlayInfo {
        let playable = try Self.parseEpisodeId(episodeId)

        var externals: [SubtitleTrackInfo] = []
        if playable.episodeIndex == 1 {
            externals = [
                SubtitleTrackInfo(
                    id: "external-demo-srt",
                    name: "简体中文（外挂示例）",
                    languageCode: "zh-Hans",
                    isExternal: true,
                    url: Bundle.main.url(forResource: "demo", withExtension: "srt")
                )
            ]
        }
        return PlayInfo(
            episodeId: episodeId,
            lines: [PlayLine(id: "default", name: "默认线路")],
            externalSubtitles: externals,
            audioTracks: [AudioTrackInfo(id: "default", name: "默认音轨", languageCode: "und")]
        )
    }

    public func resolvePlayback(line: PlayLine, episodeId: String) async throws -> ResolvedPlayback {
        switch try Self.parseEpisodeId(episodeId) {
        case .series(let plan, let index):
            let url = MockContent.playURL(plan: plan, episodeIndex: index)
            return ResolvedPlayback(url: url, urlKind: url.pathExtension == "m3u8" ? .hls : .mp4)
        case .movie(let movieIndex, let episodeIndex):
            let url = MockContent.playURL(movieIndex: movieIndex, episodeIndex: episodeIndex)
            return ResolvedPlayback(url: url, urlKind: .mp4)
        }
    }

    // MARK: - Private

    /// 可播放单元：剧集按「剧 + 集号」寻址，电影按「电影下标 + 正片序号」寻址。
    private enum MockPlayable {
        case series(MockContent.MockSeriesPlan, index: Int)
        case movie(index: Int, episodeIndex: Int)

        var episodeIndex: Int {
            switch self {
            case .series(_, let index): index
            case .movie(_, let episodeIndex): episodeIndex
            }
        }
    }

    private static func movie(for mediaId: String) -> MediaItem? {
        MockContent.movies.first { $0.id == mediaId }
    }

    /// 解析 episodeId（剧集形如 "mock-series-01-ep-07"，电影形如 "mock-movie-01-ep-01"）。
    private static func parseEpisodeId(_ episodeId: String) throws -> MockPlayable {
        guard let separatorRange = episodeId.range(of: "-ep-") else {
            throw AppError.notFound
        }
        let mediaId = String(episodeId[..<separatorRange.lowerBound])
        let indexText = String(episodeId[separatorRange.upperBound...])
        guard let index = Int(indexText), index >= 1 else {
            throw AppError.notFound
        }
        if let plan = Self.plan(for: mediaId) {
            guard index <= plan.episodeCount else { throw AppError.notFound }
            return .series(plan, index: index)
        }
        if let movieIndex = MockContent.movies.firstIndex(where: { $0.id == mediaId }) {
            // 电影只有一条正片
            guard index == 1 else { throw AppError.notFound }
            return .movie(index: movieIndex, episodeIndex: index)
        }
        throw AppError.notFound
    }

    private func applyFilters(_ filters: SearchFilters, to items: [MediaItem]) -> [MediaItem] {
        var result = items
        if !filters.kinds.isEmpty {
            result = result.filter { filters.kinds.contains($0.kind) }
        }
        if let range = filters.yearRange {
            result = result.filter { range.contains($0.year) }
        }
        if !filters.areas.isEmpty {
            result = result.filter { filters.areas.contains($0.area) }
        }
        if !filters.genres.isEmpty {
            result = result.filter { item in
                filters.genres.contains { item.genres.contains($0) }
            }
        }
        if filters.finishedOnly {
            result = result.filter(\.isFinished)
        }
        if !filters.requiredSpecs.isEmpty {
            result = result.filter { item in
                filters.requiredSpecs.allSatisfy { $0.matches(item.specs) }
            }
        }
        if let ratingMin = filters.ratingMin {
            result = result.filter { $0.rating >= ratingMin }
        }
        return result
    }

    private func relatedFor(_ item: MediaItem) -> [MediaItem] {
        Self.allItems
            .filter { $0.id != item.id }
            .sorted { lhs, rhs in
                let lhsScore = lhs.genres.filter { item.genres.contains($0) }.count
                let rhsScore = rhs.genres.filter { item.genres.contains($0) }.count
                if lhsScore != rhsScore { return lhsScore > rhsScore }
                return lhs.rating > rhs.rating
            }
            .prefix(6)
            .map { $0 }
    }
}

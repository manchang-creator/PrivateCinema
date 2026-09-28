import Foundation

/// Mock 媒体源：保证 App 开箱即可跑通全部流程。
/// 视频为公开测试流，数据全部内存构造。
struct MockMediaProvider: MediaProvider {

    let info = ProviderInfo(
        id: "mock",
        name: "演示媒体库",
        kind: .mock,
        description: "内置演示内容，用于体验全部功能"
    )

    private static let allItems: [MediaItem] = MockContent.movies + MockContent.seriesPlans.map {
        MockContent.seriesItem(from: $0)
    }

    private static func plan(for mediaId: String) -> MockContent.MockSeriesPlan? {
        MockContent.seriesPlans.first { $0.id == mediaId }
    }

    // MARK: - MediaProvider

    func home() async throws -> HomeData {
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

    func search(keyword: String, filters: SearchFilters) async throws -> [MediaItem] {
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

    func catalog(kind: MediaKind?, page: Int, pageSize: Int) async throws -> [MediaItem] {
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

    func detail(id: String) async throws -> MediaDetail {
        if let plan = Self.plan(for: id) {
            let item = MockContent.seriesItem(from: plan)
            return MediaDetail(
                item: item,
                seasons: MockContent.seasons(for: plan),
                episodesBySeason: [1: MockContent.episodes(for: plan)],
                related: relatedFor(item)
            )
        }
        guard let movie = Self.allItems.first(where: { $0.id == id }) else {
            throw AppError.notFound
        }
        return MediaDetail(item: movie, seasons: [], episodesBySeason: [:], related: relatedFor(movie))
    }

    func episodes(id: String) async throws -> [Episode] {
        guard let plan = Self.plan(for: id) else {
            throw AppError.notFound
        }
        return MockContent.episodes(for: plan)
    }

    func playInfo(episodeId: String) async throws -> PlayInfo {
        // episodeId 形如 "mock-series-01-ep-07"
        guard let separatorRange = episodeId.range(of: "-ep-") else {
            throw AppError.notFound
        }
        let mediaId = String(episodeId[..<separatorRange.lowerBound])
        let indexText = String(episodeId[separatorRange.upperBound...])
        guard let plan = Self.plan(for: mediaId),
              let index = Int(indexText), index >= 1 else {
            throw AppError.notFound
        }

        let url = MockContent.playURL(plan: plan, episodeIndex: index)
        let isHLS = url.pathExtension == "m3u8"
        var externals: [SubtitleTrackInfo] = []
        if index == 1 {
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
            url: url,
            urlKind: isHLS ? .hls : .mp4,
            externalSubtitles: externals,
            audioTracks: [AudioTrackInfo(id: "default", name: "默认音轨", languageCode: "und")]
        )
    }

    // MARK: - Private

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

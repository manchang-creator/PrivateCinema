import Foundation

/// 看剧AI (kanju) 媒体源。
/// 仅个人观看用途；解析出的直链有时效，因此每次播放前实时解析。
///
/// 集标识格式：`kanju|{variantId}|{episodeToken}`（token 字符集为 base64url，不含分隔符）。
struct KanjuMediaProvider: MediaProvider {

    let info = ProviderInfo(
        id: "kanju",
        name: "看剧AI (kanju)",
        kind: .remote,
        description: "聚合影视源 · 仅供个人观看"
    )

    private let client = KanjuAPIClient()

    // MARK: - 类型映射

    private func kanjuKind(for kind: MediaKind) -> String {
        switch kind {
        case .movie: return "movie"
        case .series: return "series"
        case .anime: return "anime"
        case .variety: return "variety"
        }
    }

    private func mapKind(_ raw: String?) -> MediaKind {
        switch raw {
        case "movie": return .movie
        case "series": return .series
        case "anime": return .anime
        case "variety": return .variety
        case "short_drama": return .series
        case "documentary": return .series
        case "sports": return .variety
        default: return .movie
        }
    }

    private func parseDate(_ raw: String?) -> Date {
        guard let raw else { return .distantPast }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: raw) { return date }
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: raw) ?? .distantPast
    }

    // MARK: - DTO → 领域模型

    private func mediaItem(
        id: String,
        title: String,
        kindRaw: String?,
        year: Int?,
        area: String?,
        language: String?,
        genres: [String]?,
        actors: [String]?,
        directors: [String]?,
        poster: String?,
        remarks: String?,
        episodeCount: Int?,
        overview: String?,
        updatedAt: String?
    ) -> MediaItem {
        let kind = mapKind(kindRaw)
        var remark = remarks ?? ""
        if kind != .movie, remark.isEmpty, let count = episodeCount, count > 0 {
            remark = "共\(count)集"
        }
        return MediaItem(
            id: id,
            title: title,
            kind: kind,
            year: year ?? 0,
            area: area ?? "",
            language: language ?? "",
            genres: genres ?? [],
            rating: 0,
            durationMinutes: 0,
            overview: overview ?? "",
            posterURL: poster.flatMap(URL.init(string:)),
            backdropURL: poster.flatMap(URL.init(string:)),
            remark: remark,
            isFinished: remark.contains("完结"),
            specs: MediaSpecs(),
            cast: (actors ?? []).map { Person(name: $0, role: "主演") },
            directors: (directors ?? []).map { Person(name: $0, role: "导演") },
            stillImageURLs: [],
            updatedAt: parseDate(updatedAt)
        )
    }

    private func mediaItem(from card: KanjuCard) -> MediaItem {
        mediaItem(
            id: card.id,
            title: card.title,
            kindRaw: card.contentKind,
            year: card.year,
            area: card.area,
            language: card.language,
            genres: card.genres,
            actors: card.actors,
            directors: card.directors,
            poster: card.posterUrl,
            remarks: card.remarks,
            episodeCount: card.episodeCount,
            overview: nil,
            updatedAt: card.updatedAt
        )
    }

    private func mediaItem(from detail: KanjuDetailResponse) -> MediaItem {
        mediaItem(
            id: detail.id,
            title: detail.title,
            kindRaw: detail.contentKind,
            year: detail.year,
            area: detail.area,
            language: detail.language,
            genres: detail.genres,
            actors: detail.actors,
            directors: detail.directors,
            poster: detail.posterUrl,
            remarks: detail.remarks,
            episodeCount: detail.episodeCount,
            overview: detail.overview,
            updatedAt: nil
        )
    }

    // MARK: - MediaProvider

    func home() async throws -> HomeData {
        async let movies = client.get(
            "/v1/browse/catalog?kind=movie&intent=latest_catalog&page=1&limit=24",
            as: KanjuCatalogResponse.self
        )
        async let series = client.get(
            "/v1/browse/catalog?kind=series&intent=latest_catalog&page=1&limit=24",
            as: KanjuCatalogResponse.self
        )
        async let anime = client.get(
            "/v1/browse/catalog?kind=anime&intent=latest_catalog&page=1&limit=24",
            as: KanjuCatalogResponse.self
        )
        async let variety = client.get(
            "/v1/browse/catalog?kind=variety&intent=latest_catalog&page=1&limit=24",
            as: KanjuCatalogResponse.self
        )
        let (m, s, a, v) = try await (movies, series, anime, variety)
        return HomeData(sections: [
            HomeSection(id: "hot-movies", title: "最新电影", items: (m.cards ?? []).map(mediaItem(from:))),
            HomeSection(id: "hot-series", title: "最新剧集", items: (s.cards ?? []).map(mediaItem(from:))),
            HomeSection(id: "anime", title: "动漫", items: (a.cards ?? []).map(mediaItem(from:))),
            HomeSection(id: "variety", title: "综艺", items: (v.cards ?? []).map(mediaItem(from:))),
        ])
    }

    func search(keyword: String, filters: SearchFilters) async throws -> [MediaItem] {
        let key = keyword.trimmingCharacters(in: .whitespacesAndNewlines)
        let kind = filters.kinds.count == 1 ? filters.kinds.first : nil
        let items = try await catalogPage(query: key.isEmpty ? nil : key, kind: kind, page: 1)
        // 上游不支持年份/地区/题材筛选，这里客户端过滤；
        // 评分 / 规格 / 完结筛选对 kanju 源不生效（元数据缺少这些字段）。
        return items.filter { item in
            if let range = filters.yearRange, !range.contains(item.year) { return false }
            if !filters.areas.isEmpty, !filters.areas.contains(item.area) { return false }
            if !filters.genres.isEmpty,
               !filters.genres.contains(where: { item.genres.contains($0) }) {
                return false
            }
            return true
        }
    }

    func catalog(kind: MediaKind?, page: Int, pageSize: Int) async throws -> [MediaItem] {
        try await catalogPage(
            query: nil,
            kind: kind,
            page: page,
            pageSize: pageSize
        )
    }

    func detail(id: String) async throws -> MediaDetail {
        let detail = try await client.get(
            "/v1/catalog/\(id)/detail",
            as: KanjuDetailResponse.self
        )
        let rawEpisodes = try await fetchAllEpisodes(variantId: id)
        let item = mediaItem(from: detail)

        let episodes = rawEpisodes.enumerated().compactMap { index, dto -> Episode? in
            guard let token = dto.token, !token.isEmpty else { return nil }
            return Episode(
                id: "kanju|\(id)|\(token)",
                mediaId: id,
                seasonIndex: 1,
                index: dto.number ?? index + 1,
                title: dto.title ?? "第\(dto.number ?? index + 1)集",
                duration: 0,
                stillURL: nil,
                remark: nil
            )
        }
        .sorted { $0.index < $1.index }

        // 相关推荐：同类型最新一页里排除自己
        var related: [MediaItem] = []
        if let page = try? await catalogPage(query: nil, kind: item.kind, page: 1) {
            related = Array(page.filter { $0.id != id }.prefix(6))
        }

        return MediaDetail(
            item: item,
            seasons: episodes.isEmpty
                ? []
                : [Season(id: "\(id)-s1", mediaId: id, index: 1, name: "第1季")],
            episodesBySeason: episodes.isEmpty ? [:] : [1: episodes],
            related: related
        )
    }

    func episodes(id: String) async throws -> [Episode] {
        let raw = try await fetchAllEpisodes(variantId: id)
        return raw.enumerated().compactMap { index, dto -> Episode? in
            guard let token = dto.token, !token.isEmpty else { return nil }
            return Episode(
                id: "kanju|\(id)|\(token)",
                mediaId: id,
                seasonIndex: 1,
                index: dto.number ?? index + 1,
                title: dto.title ?? "第\(dto.number ?? index + 1)集",
                duration: 0,
                stillURL: nil,
                remark: nil
            )
        }
        .sorted { $0.index < $1.index }
    }

    func playInfo(episodeId: String) async throws -> PlayInfo {
        // 解析集标识：kanju|{variantId}|{token}
        let parts = episodeId.split(separator: "|", omittingEmptySubsequences: false)
        guard parts.count == 3, parts[0] == "kanju" else {
            throw AppError.notFound
        }
        let token = String(parts[2])

        let resolve = try await client.get(
            "/v1/playback/resolve/\(token)?view=compact",
            as: KanjuResolveResponse.self
        )

        // 逐条换票：上游部分采集源已失效（换票返回 400），跳过后继续；
        // 策略：优先 m3u8（实测为完整正片），否则取第一个可解析的 mp4。
        var firstMP4: URL?
        for option in (resolve.lineOptions ?? []).prefix(10) {
            let kind = option.urlKind ?? ""
            let resolved: (url: URL, kind: String)?

            if option.resolveMode == "parse",
               let raw = option.url, raw.hasPrefix("resolve://") {
                resolved = await resolveLine(String(raw.dropFirst("resolve://".count)))
            } else if let raw = option.url,
                      raw.hasPrefix("http"),
                      kind == "m3u8" || kind == "mp4",
                      let direct = URL(string: raw) {
                resolved = (url: direct, kind: kind)
            } else {
                resolved = nil
            }

            guard let line = resolved else { continue }
            if line.kind == "m3u8" {
                return PlayInfo(episodeId: episodeId, url: line.url, urlKind: .hls)
            }
            if line.kind == "mp4", firstMP4 == nil {
                firstMP4 = line.url
            }
        }

        if let mp4 = firstMP4 {
            return PlayInfo(episodeId: episodeId, url: mp4, urlKind: .mp4)
        }
        throw AppError.playback("所有线路均不可用，请稍后重试")
    }

    // MARK: - Private

    private func catalogPage(
        query: String?,
        kind: MediaKind?,
        page: Int,
        pageSize: Int = 24
    ) async throws -> [MediaItem] {
        var params: [String] = ["page=\(page)", "limit=\(pageSize)"]
        if let query, !query.isEmpty {
            params.append("q=\(query.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? query)")
        }
        if let kind {
            params.append("kind=\(kanjuKind(for: kind))")
            params.append("intent=latest_catalog")
        }
        let response = try await client.get(
            "/v1/browse/catalog?" + params.joined(separator: "&"),
            as: KanjuCatalogResponse.self
        )
        return (response.cards ?? []).map(mediaItem(from:))
    }

    /// 分页拉取全部剧集（上游单页上限约 48，长剧需要循环）。
    private func fetchAllEpisodes(variantId: String) async throws -> [KanjuEpisodeDTO] {
        var all: [KanjuEpisodeDTO] = []
        var offset = 0
        let pageSize = 48
        while offset < 2400 { // 安全上限
            let response = try await client.get(
                "/v1/catalog/\(variantId)/episodes?limit=\(pageSize)&offset=\(offset)",
                as: KanjuEpisodesResponse.self
            )
            all.append(contentsOf: response.episodes ?? [])
            guard response.episodePagination?.hasMore == true else { break }
            offset += pageSize
        }
        return all
    }

    /// 用票据换取真实播放地址；失效票据返回 nil。
    private func resolveLine(_ ticket: String) async -> (url: URL, kind: String)? {
        guard let response = try? await client.post(
            "/v1/playback/resolve-line?view=compact",
            json: KanjuTicketRequest(ticket: ticket),
            as: KanjuLineResolveResponse.self
        ), let urlString = response.line?.url, let url = URL(string: urlString) else {
            return nil
        }
        let kind = response.line?.urlKind ?? ""
        guard kind == "m3u8" || kind == "mp4" else { return nil }
        return (url, kind)
    }
}

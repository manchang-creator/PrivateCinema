import Foundation

/// kanju 上游接口 DTO。
/// 字段名与上游 snake_case 一一对应（解码时使用 convertFromSnakeCase）。
/// 注意 convertFromSnakeCase 的命名规则：poster_url → posterUrl。

// MARK: - 片库 / 搜索

struct KanjuCatalogResponse: Decodable {
    var cards: [KanjuCard]?
    var pagination: KanjuPagination?
}

struct KanjuPagination: Decodable {
    var page: Int?
    var limit: Int?
    var hasMore: Bool?
    var nextPage: Int?
}

struct KanjuCard: Decodable {
    var id: String
    var title: String
    var contentKind: String?
    var year: Int?
    var area: String?
    var language: String?
    var genres: [String]?
    var actors: [String]?
    var directors: [String]?
    var posterUrl: String?
    var remarks: String?
    var episodeCount: Int?
    var updatedAt: String?
}

// MARK: - 详情

struct KanjuDetailResponse: Decodable {
    var id: String
    var title: String
    var contentKind: String?
    var year: Int?
    var area: String?
    var language: String?
    var genres: [String]?
    var actors: [String]?
    var directors: [String]?
    var posterUrl: String?
    var remarks: String?
    var episodeCount: Int?
    var variants: [KanjuVariant]?
    /// 上游字段名 description 与 Swift 保留名冲突，映射为 overview
    var overview: String?

    enum CodingKeys: String, CodingKey {
        case id, title, contentKind, year, area, language, genres
        case actors, directors, posterUrl, remarks, episodeCount
        case variants
        case overview = "description"
    }
}

struct KanjuVariant: Decodable {
    var variantId: String
    var title: String?
    var year: Int?
    var seasonLabel: String?
    var episodeCount: Int?
    var hasPlayback: Bool?
}

// MARK: - 剧集

struct KanjuEpisodesResponse: Decodable {
    var title: String?
    var episodeCount: Int?
    var episodes: [KanjuEpisodeDTO]?
    var episodePagination: KanjuEpisodePagination?
}

struct KanjuEpisodePagination: Decodable {
    var hasMore: Bool?
    var totalCount: Int?
}

struct KanjuEpisodeDTO: Decodable {
    var id: String
    var number: Int?
    var title: String?
    var token: String?
}

// MARK: - 播放解析

struct KanjuResolveResponse: Decodable {
    var lineOptions: [KanjuLineOption]?
    var currentEpisode: KanjuEpisodeDTO?
}

struct KanjuLineOption: Decodable {
    var id: String?
    var label: String?
    var url: String?
    var urlKind: String?
    var resolveMode: String?
    var resolveRequired: Bool?
    var defaultPriority: Bool?
}

struct KanjuTicketRequest: Encodable {
    var ticket: String
}

struct KanjuLineResolveResponse: Decodable {
    var line: KanjuResolvedLine?
}

struct KanjuResolvedLine: Decodable {
    var url: String?
    var urlKind: String?
}

import Foundation

/// 视频规格标签（详情页与筛选使用）。
public struct MediaSpecs: Hashable, Codable {
    public var is4K = false
    public var isHDR = false
    public var isDolbyVision = false
    public var isDolbyAtmos = false
    public var isHEVC = false
    public var fps: Double = 23.976
}

public struct Person: Hashable, Codable, Identifiable {
    public var name: String
    public var role: String = "主演"

    public var id: String { name + "/" + role }
}

/// 统一的媒体条目领域模型：Provider 返回它，UI 只消费它。
/// 电影与剧集共用一个模型，用 `kind` 区分。
public struct MediaItem: Identifiable, Hashable, Codable {
    public let id: String
    public var title: String
    public var kind: MediaKind
    public var year: Int
    public var area: String
    public var language: String
    public var genres: [String]
    public var rating: Double
    public var durationMinutes: Int
    public var overview: String
    public var posterURL: URL?
    public var backdropURL: URL?
    /// 例如"更新至第24集"、"已完结"、"高清"
    public var remark: String
    public var isFinished: Bool
    public var specs: MediaSpecs
    public var cast: [Person]
    public var directors: [Person]
    public var stillImageURLs: [URL]
    public var updatedAt: Date

    public init(
        id: String,
        title: String,
        kind: MediaKind,
        year: Int,
        area: String = "中国大陆",
        language: String = "国语",
        genres: [String] = [],
        rating: Double = 0,
        durationMinutes: Int = 45,
        overview: String = "",
        posterURL: URL? = nil,
        backdropURL: URL? = nil,
        remark: String = "",
        isFinished: Bool = false,
        specs: MediaSpecs = MediaSpecs(),
        cast: [Person] = [],
        directors: [Person] = [],
        stillImageURLs: [URL] = [],
        updatedAt: Date = .now
    ) {
        self.id = id
        self.title = title
        self.kind = kind
        self.year = year
        self.area = area
        self.language = language
        self.genres = genres
        self.rating = rating
        self.durationMinutes = durationMinutes
        self.overview = overview
        self.posterURL = posterURL
        self.backdropURL = backdropURL
        self.remark = remark
        self.isFinished = isFinished
        self.specs = specs
        self.cast = cast
        self.directors = directors
        self.stillImageURLs = stillImageURLs
        self.updatedAt = updatedAt
    }

    public var ratingText: String {
        rating > 0 ? String(format: "%.1f", rating) : "暂无评分"
    }

    public var metaLine: String {
        var parts = [String(year)]
        parts.append(contentsOf: genres.prefix(3))
        return parts.joined(separator: " · ")
    }
}

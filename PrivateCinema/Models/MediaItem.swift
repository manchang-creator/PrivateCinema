import Foundation

/// 视频规格标签（详情页与筛选使用）。
struct MediaSpecs: Hashable, Codable {
    var is4K = false
    var isHDR = false
    var isDolbyVision = false
    var isDolbyAtmos = false
    var isHEVC = false
    var fps: Double = 23.976
}

struct Person: Hashable, Codable, Identifiable {
    var name: String
    var role: String = "主演"

    var id: String { name + "/" + role }
}

/// 统一的媒体条目领域模型：Provider 返回它，UI 只消费它。
/// 电影与剧集共用一个模型，用 `kind` 区分。
struct MediaItem: Identifiable, Hashable, Codable {
    let id: String
    var title: String
    var kind: MediaKind
    var year: Int
    var area: String
    var language: String
    var genres: [String]
    var rating: Double
    var durationMinutes: Int
    var overview: String
    var posterURL: URL?
    var backdropURL: URL?
    /// 例如"更新至第24集"、"已完结"、"高清"
    var remark: String
    var isFinished: Bool
    var specs: MediaSpecs
    var cast: [Person]
    var directors: [Person]
    var stillImageURLs: [URL]
    var updatedAt: Date

    init(
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

    var ratingText: String {
        rating > 0 ? String(format: "%.1f", rating) : "暂无评分"
    }

    var metaLine: String {
        var parts = [String(year)]
        parts.append(contentsOf: genres.prefix(3))
        return parts.joined(separator: " · ")
    }
}

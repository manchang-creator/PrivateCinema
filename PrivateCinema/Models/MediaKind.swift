import Foundation

/// 内容类型。`rawValue` 同时用于 SwiftData 存储与 Provider 传输。
enum MediaKind: String, Codable, CaseIterable, Identifiable, Hashable {
    case movie
    case series
    case anime
    case variety

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .movie: return "电影"
        case .series: return "剧集"
        case .anime: return "动漫"
        case .variety: return "综艺"
        }
    }

    var systemImage: String {
        switch self {
        case .movie: return "film"
        case .series: return "tv"
        case .anime: return "sparkles.tv"
        case .variety: return "party.popper"
        }
    }
}

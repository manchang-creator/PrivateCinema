import Foundation

/// 收藏状态：想看 / 收藏 / 看过。
enum FavoriteState: String, Codable, CaseIterable, Identifiable {
    case wantToWatch
    case favorite
    case watched

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .wantToWatch: return "想看"
        case .favorite: return "收藏"
        case .watched: return "看过"
        }
    }

    var systemImage: String {
        switch self {
        case .wantToWatch: return "clock"
        case .favorite: return "heart"
        case .watched: return "eye"
        }
    }
}

/// 收藏领域模型。
struct FavoriteEntry: Identifiable, Hashable {
    var mediaId: String
    var state: FavoriteState
    var media: MediaItem
    var addedAt: Date

    var id: String { mediaId }
}

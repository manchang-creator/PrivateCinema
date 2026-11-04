import Foundation

/// 收藏状态：想看 / 收藏 / 看过。
public enum FavoriteState: String, Codable, CaseIterable, Identifiable {
    case wantToWatch
    case favorite
    case watched

    public var id: String { rawValue }

    public var displayName: String {
        switch self {
        case .wantToWatch: return "想看"
        case .favorite: return "收藏"
        case .watched: return "看过"
        }
    }

    public var systemImage: String {
        switch self {
        case .wantToWatch: return "clock"
        case .favorite: return "heart"
        case .watched: return "eye"
        }
    }
}

/// 收藏领域模型。
public struct FavoriteEntry: Identifiable, Hashable {
    public var mediaId: String
    public var state: FavoriteState
    public var media: MediaItem
    public var addedAt: Date

    public var id: String { mediaId }
}

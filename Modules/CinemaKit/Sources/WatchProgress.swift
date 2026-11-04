import Foundation

/// 播放进度领域模型（Provider 无关，由本地服务层持久化）。
public struct WatchProgress: Identifiable, Hashable, Codable {
    public var mediaId: String
    public var episodeId: String
    public var mediaTitle: String
    public var episodeTitle: String
    public var episodeIndex: Int
    public var kind: MediaKind
    public var posterURL: URL?
    public var backdropURL: URL?
    /// 秒
    public var position: Double
    /// 秒
    public var duration: Double
    public var lastPlayedAt: Date
    public var completed: Bool

    public var id: String { mediaId + "#" + episodeId }

    public var percent: Double {
        guard duration > 0 else { return 0 }
        return min(1, max(0, position / duration))
    }

    public var percentText: String {
        "\(Int((percent * 100).rounded()))%"
    }

    /// 播放超过 90% 视为看完。
    public static func isCompleted(position: Double, duration: Double) -> Bool {
        guard duration > 0 else { return false }
        return position / duration >= 0.9
    }
}

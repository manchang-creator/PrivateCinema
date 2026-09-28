import Foundation

/// 播放进度领域模型（Provider 无关，由本地服务层持久化）。
struct WatchProgress: Identifiable, Hashable, Codable {
    var mediaId: String
    var episodeId: String
    var mediaTitle: String
    var episodeTitle: String
    var episodeIndex: Int
    var kind: MediaKind
    var posterURL: URL?
    var backdropURL: URL?
    /// 秒
    var position: Double
    /// 秒
    var duration: Double
    var lastPlayedAt: Date
    var completed: Bool

    var id: String { mediaId + "#" + episodeId }

    var percent: Double {
        guard duration > 0 else { return 0 }
        return min(1, max(0, position / duration))
    }

    var percentText: String {
        "\(Int((percent * 100).rounded()))%"
    }

    /// 播放超过 90% 视为看完。
    static func isCompleted(position: Double, duration: Double) -> Bool {
        guard duration > 0 else { return false }
        return position / duration >= 0.9
    }
}

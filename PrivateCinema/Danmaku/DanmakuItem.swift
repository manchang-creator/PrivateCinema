import Foundation

/// 弹幕类型。
enum DanmakuType: String, Codable, CaseIterable {
    case scroll
    case top
    case bottom

    var displayName: String {
        switch self {
        case .scroll: return "滚动"
        case .top: return "顶部"
        case .bottom: return "底部"
        }
    }
}

/// 弹幕领域模型（Provider 无关）。
///
///     { episodeId: "ep18", time: 312.6, content: "这里真的笑死我了", type: "scroll" }
///
/// 表示视频播放到 05:12.6 时显示。
struct DanmakuItem: Identifiable, Hashable, Codable {
    var id: String
    var mediaId: String
    var episodeId: String
    /// 视频时间点（秒）
    var time: Double
    var content: String
    var type: DanmakuType
    /// "#FFFFFF" 十六进制颜色
    var color: String
    var userId: String
    var createdAt: Date

    init(
        id: String = UUID().uuidString,
        mediaId: String,
        episodeId: String,
        time: Double,
        content: String,
        type: DanmakuType = .scroll,
        color: String = "#FFFFFF",
        userId: String,
        createdAt: Date = .now
    ) {
        self.id = id
        self.mediaId = mediaId
        self.episodeId = episodeId
        self.time = time
        self.content = content
        self.type = type
        self.color = color
        self.userId = userId
        self.createdAt = createdAt
    }
}

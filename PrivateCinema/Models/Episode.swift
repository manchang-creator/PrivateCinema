import Foundation

/// 季（为多季剧集预留，Mock 数据默认单季）。
struct Season: Identifiable, Hashable, Codable {
    let id: String
    var mediaId: String
    var index: Int
    var name: String
}

/// 单集。
struct Episode: Identifiable, Hashable, Codable {
    let id: String
    var mediaId: String
    var seasonIndex: Int
    /// 1-based 集序号
    var index: Int
    var title: String
    /// 秒
    var duration: Double
    var stillURL: URL?
    var remark: String?

    var displayTitle: String {
        title.isEmpty ? "第\(index)集" : title
    }

    /// S01E02 风格编号
    var codedLabel: String {
        "S\(String(format: "%02d", seasonIndex))E\(String(format: "%02d", index))"
    }
}

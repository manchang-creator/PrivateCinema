import Foundation

/// 季（为多季剧集预留，Mock 数据默认单季）。
public struct Season: Identifiable, Hashable, Codable {
    public let id: String
    public var mediaId: String
    public var index: Int
    public var name: String
}

/// 单集。
public struct Episode: Identifiable, Hashable, Codable {
    public let id: String
    public var mediaId: String
    public var seasonIndex: Int
    /// 1-based 集序号
    public var index: Int
    public var title: String
    /// 秒
    public var duration: Double
    public var stillURL: URL?
    public var remark: String?

    public var displayTitle: String {
        title.isEmpty ? "第\(index)集" : title
    }

    /// S01E02 风格编号
    public var codedLabel: String {
        "S\(String(format: "%02d", seasonIndex))E\(String(format: "%02d", index))"
    }
}

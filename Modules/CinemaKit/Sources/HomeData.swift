import Foundation

/// 首页/发现的一个横向模块。
public struct HomeSection: Identifiable, Hashable {
    public let id: String
    public var title: String
    public var items: [MediaItem]
}

/// Provider 的首页聚合数据。
public struct HomeData {
    public var sections: [HomeSection]

    public static let empty = HomeData(sections: [])
}

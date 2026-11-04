import Foundation

/// 导航路由：详情页。
public struct MediaRoute: Hashable {
    /// 跨模块构造入口。
    public init(mediaID: String) {
        self.mediaID = mediaID
    }

    public let mediaID: String
}

/// 首页内推送的搜索页路由。
public struct HomeSearchRoute: Hashable {
    /// 跨模块构造入口。
    public init() {}
}

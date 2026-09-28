import Foundation

/// 首页/发现的一个横向模块。
struct HomeSection: Identifiable, Hashable {
    let id: String
    var title: String
    var items: [MediaItem]
}

/// Provider 的首页聚合数据。
struct HomeData {
    var sections: [HomeSection]

    static let empty = HomeData(sections: [])
}

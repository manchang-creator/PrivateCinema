import Foundation

/// 详情页聚合模型。
struct MediaDetail {
    var item: MediaItem
    var seasons: [Season]
    /// 按季分组的剧集；单季内容 key 为 1
    var episodesBySeason: [Int: [Episode]]
    var related: [MediaItem]

    /// 扁平化剧集列表（按季、集号排序）。
    var allEpisodes: [Episode] {
        seasons
            .sorted { $0.index < $1.index }
            .flatMap { season in
                (episodesBySeason[season.index] ?? []).sorted { $0.index < $1.index }
            }
    }

    var defaultSeasonIndex: Int {
        seasons.map(\.index).min() ?? 1
    }
}

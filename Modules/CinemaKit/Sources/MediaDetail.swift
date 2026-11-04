import Foundation

/// 详情页聚合模型。
public struct MediaDetail {
    public var item: MediaItem
    public var seasons: [Season]
    /// 按季分组的剧集；单季内容 key 为 1
    public var episodesBySeason: [Int: [Episode]]
    public var related: [MediaItem]

    /// 扁平化剧集列表（按季、集号排序）。
    public var allEpisodes: [Episode] {
        seasons
            .sorted { $0.index < $1.index }
            .flatMap { season in
                (episodesBySeason[season.index] ?? []).sorted { $0.index < $1.index }
            }
    }

    public var defaultSeasonIndex: Int {
        seasons.map(\.index).min() ?? 1
    }
}

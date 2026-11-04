import Foundation

/// 一次播放会话的请求描述：要播哪部作品、哪一集、播放列表上下文。
public struct PlaybackRequest: Identifiable, Equatable {
    public let id: String
    public let media: MediaItem
    public let episode: Episode
    /// 同一部作品的完整播放列表（供上一集 / 下一集 / 自动连播使用）
    public let playlist: [Episode]
    /// 起始位置（秒）；nil 表示自动读取历史进度
    public var startPosition: Double?

    public init(media: MediaItem, episode: Episode, playlist: [Episode], startPosition: Double? = nil) {
        self.id = media.id + "#" + episode.id
        self.media = media
        self.episode = episode
        self.playlist = playlist
        self.startPosition = startPosition
    }

    public var episodeLabel: String {
        media.kind == .movie ? episode.displayTitle : "\(episode.codedLabel) · \(episode.displayTitle)"
    }

    public var nextEpisode: Episode? {
        guard let index = playlist.firstIndex(where: { $0.id == episode.id }),
              playlist.indices.contains(index + 1) else { return nil }
        return playlist[index + 1]
    }

    public var previousEpisode: Episode? {
        guard let index = playlist.firstIndex(where: { $0.id == episode.id }),
              index > 0 else { return nil }
        return playlist[index - 1]
    }
}

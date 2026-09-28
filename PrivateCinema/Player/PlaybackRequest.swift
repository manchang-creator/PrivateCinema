import Foundation

/// 一次播放会话的请求描述：要播哪部作品、哪一集、播放列表上下文。
struct PlaybackRequest: Identifiable, Equatable {
    let id: String
    let media: MediaItem
    let episode: Episode
    /// 同一部作品的完整播放列表（供上一集 / 下一集 / 自动连播使用）
    let playlist: [Episode]
    /// 起始位置（秒）；nil 表示自动读取历史进度
    var startPosition: Double?

    init(media: MediaItem, episode: Episode, playlist: [Episode], startPosition: Double? = nil) {
        self.id = media.id + "#" + episode.id
        self.media = media
        self.episode = episode
        self.playlist = playlist
        self.startPosition = startPosition
    }

    var episodeLabel: String {
        media.kind == .movie ? episode.displayTitle : "\(episode.codedLabel) · \(episode.displayTitle)"
    }

    var nextEpisode: Episode? {
        guard let index = playlist.firstIndex(where: { $0.id == episode.id }),
              playlist.indices.contains(index + 1) else { return nil }
        return playlist[index + 1]
    }

    var previousEpisode: Episode? {
        guard let index = playlist.firstIndex(where: { $0.id == episode.id }),
              index > 0 else { return nil }
        return playlist[index - 1]
    }
}

import Foundation

enum PlayURLKind: String, Codable {
    case mp4
    case hls
    case file
}

/// 外挂字幕声明（由 Provider 提供）。
struct SubtitleTrackInfo: Identifiable, Hashable, Codable {
    let id: String
    var name: String
    var languageCode: String
    var isExternal: Bool
    var url: URL?
}

/// 音轨声明（由 Provider 提供，用于规格展示；实际可选轨道由 AVPlayer 决定）。
struct AudioTrackInfo: Identifiable, Hashable, Codable {
    let id: String
    var name: String
    var languageCode: String
}

/// 播放器拉起所需的最小信息集。
struct PlayInfo {
    let episodeId: String
    let url: URL
    let urlKind: PlayURLKind
    /// Provider 侧声明的外挂字幕（SRT / VTT）
    var externalSubtitles: [SubtitleTrackInfo]
    /// Provider 侧声明的音轨（用于详情页规格展示）
    var audioTracks: [AudioTrackInfo]

    init(
        episodeId: String,
        url: URL,
        urlKind: PlayURLKind,
        externalSubtitles: [SubtitleTrackInfo] = [],
        audioTracks: [AudioTrackInfo] = []
    ) {
        self.episodeId = episodeId
        self.url = url
        self.urlKind = urlKind
        self.externalSubtitles = externalSubtitles
        self.audioTracks = audioTracks
    }
}

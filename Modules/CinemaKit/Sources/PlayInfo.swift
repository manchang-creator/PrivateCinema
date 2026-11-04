import Foundation

public enum PlayURLKind: String, Codable {
    case mp4
    case hls
    case file
}

/// 外挂字幕声明（由 Provider 提供）。
public struct SubtitleTrackInfo: Identifiable, Hashable, Codable {
    public let id: String
    public var name: String
    public var languageCode: String
    public var isExternal: Bool
    public var url: URL?
}

/// 音轨声明（由 Provider 提供，用于规格展示；实际可选轨道由 AVPlayer 决定）。
public struct AudioTrackInfo: Identifiable, Hashable, Codable {
    public let id: String
    public var name: String
    public var languageCode: String
}

/// 播放器拉起所需的最小信息集。
public struct PlayInfo {
    public let episodeId: String
    public let url: URL
    public let urlKind: PlayURLKind
    /// Provider 侧声明的外挂字幕（SRT / VTT）
    public var externalSubtitles: [SubtitleTrackInfo]
    /// Provider 侧声明的音轨（用于详情页规格展示）
    public var audioTracks: [AudioTrackInfo]

    public init(
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

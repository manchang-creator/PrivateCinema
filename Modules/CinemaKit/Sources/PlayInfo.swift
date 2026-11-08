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

/// 播放线路描述：只说明「有哪些线路」，不含地址。
/// 真正的播放地址由 `MediaProvider.resolvePlayback(line:episodeId:)` 按需解析，
/// 因此解析可以是异步的、可失败的、可短时有效的（临时签名 / 二次跳转）。
public struct PlayLine: Identifiable, Hashable {
    public let id: String
    public var name: String

    public init(id: String, name: String) {
        self.id = id
        self.name = name
    }
}

/// 单集可用的播放线路与字幕 / 音轨声明（不含具体播放地址）。
public struct PlayInfo {
    public let episodeId: String
    /// 线路列表，顺序即默认优先级
    public var lines: [PlayLine]
    /// Provider 侧声明的外挂字幕（SRT / VTT）
    public var externalSubtitles: [SubtitleTrackInfo]
    /// Provider 侧声明的音轨（用于详情页规格展示）
    public var audioTracks: [AudioTrackInfo]

    public init(
        episodeId: String,
        lines: [PlayLine],
        externalSubtitles: [SubtitleTrackInfo] = [],
        audioTracks: [AudioTrackInfo] = []
    ) {
        self.episodeId = episodeId
        self.lines = lines
        self.externalSubtitles = externalSubtitles
        self.audioTracks = audioTracks
    }
}

/// 某条线路解析出的、可直接交给播放器的地址。
public struct ResolvedPlayback {
    public let url: URL
    public let urlKind: PlayURLKind

    public init(url: URL, urlKind: PlayURLKind) {
        self.url = url
        self.urlKind = urlKind
    }
}

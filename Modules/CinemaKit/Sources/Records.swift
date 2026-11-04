import Foundation
import SwiftData

/// SwiftData 记录。
/// 注意：只存原始值类型；复杂类型以字符串/URL 字符串形式存储，便于未来同步 CloudKit。

@Model
public final class WatchProgressRecord {
    public var mediaId: String
    public var episodeId: String
    public var mediaTitle: String
    public var episodeTitle: String
    public var episodeIndex: Int
    public var kindRaw: String
    public var posterPath: String?
    public var backdropPath: String?
    public var position: Double
    public var duration: Double
    public var lastPlayedAt: Date
    public var completed: Bool

    public init(
        mediaId: String,
        episodeId: String,
        mediaTitle: String,
        episodeTitle: String,
        episodeIndex: Int,
        kindRaw: String,
        posterPath: String?,
        backdropPath: String?,
        position: Double,
        duration: Double,
        lastPlayedAt: Date,
        completed: Bool
    ) {
        self.mediaId = mediaId
        self.episodeId = episodeId
        self.mediaTitle = mediaTitle
        self.episodeTitle = episodeTitle
        self.episodeIndex = episodeIndex
        self.kindRaw = kindRaw
        self.posterPath = posterPath
        self.backdropPath = backdropPath
        self.position = position
        self.duration = duration
        self.lastPlayedAt = lastPlayedAt
        self.completed = completed
    }
}

@Model
public final class FavoriteRecord {
    public var mediaId: String
    public var stateRaw: String
    public var addedAt: Date
    /// 冗余快照，收藏页离线可用（JSON 编码的 MediaItem）
    public var itemJSON: Data

    public init(mediaId: String, stateRaw: String, addedAt: Date, itemJSON: Data) {
        self.mediaId = mediaId
        self.stateRaw = stateRaw
        self.addedAt = addedAt
        self.itemJSON = itemJSON
    }
}

@Model
public final class DanmakuRecord {
    public var danmakuId: String
    public var mediaId: String
    public var episodeId: String
    public var time: Double
    public var content: String
    public var typeRaw: String
    public var colorHex: String
    public var userId: String
    public var createdAt: Date

    public init(
        danmakuId: String,
        mediaId: String,
        episodeId: String,
        time: Double,
        content: String,
        typeRaw: String,
        colorHex: String,
        userId: String,
        createdAt: Date
    ) {
        self.danmakuId = danmakuId
        self.mediaId = mediaId
        self.episodeId = episodeId
        self.time = time
        self.content = content
        self.typeRaw = typeRaw
        self.colorHex = colorHex
        self.userId = userId
        self.createdAt = createdAt
    }
}

@Model
public final class MediaSourceRecord {
    public var sourceId: String
    public var name: String
    public var typeRaw: String
    public var baseURL: String
    public var username: String
    public var enabled: Bool
    public var priority: Int
    public var createdAt: Date

    public init(
        sourceId: String,
        name: String,
        typeRaw: String,
        baseURL: String,
        username: String,
        enabled: Bool,
        priority: Int,
        createdAt: Date
    ) {
        self.sourceId = sourceId
        self.name = name
        self.typeRaw = typeRaw
        self.baseURL = baseURL
        self.username = username
        self.enabled = enabled
        self.priority = priority
        self.createdAt = createdAt
    }
}

@Model
public final class DownloadTaskRecord {
    public var taskId: String
    public var mediaId: String
    public var mediaTitle: String
    public var episodeId: String
    public var episodeTitle: String
    public var sourceURL: String?
    public var posterPath: String?
    public var stateRaw: String
    public var receivedBytes: Int64
    public var totalBytes: Int64
    public var createdAt: Date

    public init(
        taskId: String,
        mediaId: String,
        mediaTitle: String,
        episodeId: String,
        episodeTitle: String,
        sourceURL: String?,
        posterPath: String?,
        stateRaw: String,
        receivedBytes: Int64,
        totalBytes: Int64,
        createdAt: Date
    ) {
        self.taskId = taskId
        self.mediaId = mediaId
        self.mediaTitle = mediaTitle
        self.episodeId = episodeId
        self.episodeTitle = episodeTitle
        self.sourceURL = sourceURL
        self.posterPath = posterPath
        self.stateRaw = stateRaw
        self.receivedBytes = receivedBytes
        self.totalBytes = totalBytes
        self.createdAt = createdAt
    }
}

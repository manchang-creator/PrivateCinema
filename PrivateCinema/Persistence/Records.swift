import Foundation
import SwiftData

/// SwiftData 记录。
/// 注意：只存原始值类型；复杂类型以字符串/URL 字符串形式存储，便于未来同步 CloudKit。

@Model
final class WatchProgressRecord {
    var mediaId: String
    var episodeId: String
    var mediaTitle: String
    var episodeTitle: String
    var episodeIndex: Int
    var kindRaw: String
    var posterPath: String?
    var backdropPath: String?
    var position: Double
    var duration: Double
    var lastPlayedAt: Date
    var completed: Bool

    init(
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
final class FavoriteRecord {
    var mediaId: String
    var stateRaw: String
    var addedAt: Date
    /// 冗余快照，收藏页离线可用（JSON 编码的 MediaItem）
    var itemJSON: Data

    init(mediaId: String, stateRaw: String, addedAt: Date, itemJSON: Data) {
        self.mediaId = mediaId
        self.stateRaw = stateRaw
        self.addedAt = addedAt
        self.itemJSON = itemJSON
    }
}

@Model
final class DanmakuRecord {
    var danmakuId: String
    var mediaId: String
    var episodeId: String
    var time: Double
    var content: String
    var typeRaw: String
    var colorHex: String
    var userId: String
    var createdAt: Date

    init(
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
final class MediaSourceRecord {
    var sourceId: String
    var name: String
    var typeRaw: String
    var baseURL: String
    var username: String
    var enabled: Bool
    var priority: Int
    var createdAt: Date

    init(
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
final class DownloadTaskRecord {
    var taskId: String
    var mediaId: String
    var mediaTitle: String
    var episodeId: String
    var episodeTitle: String
    var sourceURL: String?
    var posterPath: String?
    var stateRaw: String
    var receivedBytes: Int64
    var totalBytes: Int64
    var createdAt: Date

    init(
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

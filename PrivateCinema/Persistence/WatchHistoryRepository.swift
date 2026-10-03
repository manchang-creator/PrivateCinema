import Foundation
import SwiftData

/// 观看进度仓储：SwiftData CRUD，返回领域模型。
struct WatchHistoryRepository {
    let context: ModelContext

    func upsert(_ progress: WatchProgress) {
        let mediaId = progress.mediaId
        let episodeId = progress.episodeId
        let descriptor = FetchDescriptor<WatchProgressRecord>(
            predicate: #Predicate { record in
                record.mediaId == mediaId && record.episodeId == episodeId
            }
        )
        if let existing = try? context.fetch(descriptor).first {
            existing.mediaTitle = progress.mediaTitle
            existing.episodeTitle = progress.episodeTitle
            existing.episodeIndex = progress.episodeIndex
            existing.kindRaw = progress.kind.rawValue
            existing.posterPath = progress.posterURL?.absoluteString
            existing.backdropPath = progress.backdropURL?.absoluteString
            existing.position = progress.position
            existing.duration = progress.duration
            existing.lastPlayedAt = progress.lastPlayedAt
            existing.completed = progress.completed
        } else {
            let record = WatchProgressRecord(
                mediaId: progress.mediaId,
                episodeId: progress.episodeId,
                mediaTitle: progress.mediaTitle,
                episodeTitle: progress.episodeTitle,
                episodeIndex: progress.episodeIndex,
                kindRaw: progress.kind.rawValue,
                posterPath: progress.posterURL?.absoluteString,
                backdropPath: progress.backdropURL?.absoluteString,
                position: progress.position,
                duration: progress.duration,
                lastPlayedAt: progress.lastPlayedAt,
                completed: progress.completed
            )
            context.insert(record)
        }
        context.saveOrLog()
    }

    func progress(for mediaId: String, episodeId: String) -> WatchProgress? {
        let descriptor = FetchDescriptor<WatchProgressRecord>(
            predicate: #Predicate { record in
                record.mediaId == mediaId && record.episodeId == episodeId
            }
        )
        return (try? context.fetch(descriptor).first)?.map { $0.domain }
    }

    /// 某部作品下所有集的进度。
    func progresses(forMedia mediaId: String) -> [WatchProgress] {
        let descriptor = FetchDescriptor<WatchProgressRecord>(
            predicate: #Predicate { record in
                record.mediaId == mediaId
            }
        )
        return (try? context.fetch(descriptor).map { $0.domain }) ?? []
    }

    /// 最近观看（含已看完，历史页用）。
    func recent(limit: Int = 200) -> [WatchProgress] {
        var descriptor = FetchDescriptor<WatchProgressRecord>(
            sortBy: [SortDescriptor(\.lastPlayedAt, order: .reverse)]
        )
        descriptor.fetchLimit = limit
        return (try? context.fetch(descriptor).map { $0.domain }) ?? []
    }

    /// 继续观看：未看完、且时间靠前。
    func continueWatching(limit: Int = 20) -> [WatchProgress] {
        recent()
            .filter { !$0.completed && $0.position > 5 }
            .prefix(limit).map { $0 }
    }

    func remove(mediaId: String, episodeId: String) {
        let descriptor = FetchDescriptor<WatchProgressRecord>(
            predicate: #Predicate { record in
                record.mediaId == mediaId && record.episodeId == episodeId
            }
        )
        for record in (try? context.fetch(descriptor)) ?? [] {
            context.delete(record)
        }
        context.saveOrLog()
    }

    func clearAll() {
        for record in (try? context.fetch(FetchDescriptor<WatchProgressRecord>())) ?? [] {
            context.delete(record)
        }
        context.saveOrLog()
    }
}

extension WatchProgressRecord {
    var domain: WatchProgress {
        WatchProgress(
            mediaId: mediaId,
            episodeId: episodeId,
            mediaTitle: mediaTitle,
            episodeTitle: episodeTitle,
            episodeIndex: episodeIndex,
            kind: MediaKind(rawValue: kindRaw) ?? .movie,
            posterURL: posterPath.flatMap(URL.init(string:)),
            backdropURL: backdropPath.flatMap(URL.init(string:)),
            position: position,
            duration: duration,
            lastPlayedAt: lastPlayedAt,
            completed: completed
        )
    }
}

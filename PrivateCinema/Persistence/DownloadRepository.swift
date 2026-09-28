import Foundation
import SwiftData

/// 下载任务仓储。
struct DownloadRepository {
    let context: ModelContext

    func all() -> [DownloadTaskRecord] {
        (try? context.fetch(FetchDescriptor<DownloadTaskRecord>(
            sortBy: [SortDescriptor(\.createdAt, order: .reverse)]
        ))) ?? []
    }

    func upsert(_ task: DownloadTask) {
        let taskId = task.id
        let descriptor = FetchDescriptor<DownloadTaskRecord>(
            predicate: #Predicate { record in
                record.taskId == taskId
            }
        )
        if let existing = try? context.fetch(descriptor).first {
            existing.stateRaw = task.state.rawValue
            existing.progress = task.progress
        } else {
            context.insert(DownloadTaskRecord(
                taskId: task.id,
                mediaId: task.mediaId,
                mediaTitle: task.mediaTitle,
                episodeId: task.episodeId,
                episodeTitle: task.episodeTitle,
                posterPath: task.posterURL?.absoluteString,
                stateRaw: task.state.rawValue,
                progress: task.progress,
                totalBytes: task.totalBytes,
                createdAt: task.createdAt
            ))
        }
        try? context.save()
    }

    func delete(taskId: String) {
        let descriptor = FetchDescriptor<DownloadTaskRecord>(
            predicate: #Predicate { record in
                record.taskId == taskId
            }
        )
        for record in (try? context.fetch(descriptor)) ?? [] {
            context.delete(record)
        }
        try? context.save()
    }

    func clearCompleted() {
        let all = (try? context.fetch(FetchDescriptor<DownloadTaskRecord>())) ?? []
        for record in all where record.stateRaw == DownloadState.completed.rawValue {
            context.delete(record)
        }
        try? context.save()
    }
}

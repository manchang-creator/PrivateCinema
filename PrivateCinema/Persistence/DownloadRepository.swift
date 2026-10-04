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
            existing.receivedBytes = task.receivedBytes
            existing.totalBytes = task.totalBytes
            existing.sourceURL = task.sourceURL?.absoluteString
        } else {
            context.insert(DownloadTaskRecord(
                taskId: task.id,
                mediaId: task.mediaId,
                mediaTitle: task.mediaTitle,
                episodeId: task.episodeId,
                episodeTitle: task.episodeTitle,
                sourceURL: task.sourceURL?.absoluteString,
                posterPath: task.posterURL?.absoluteString,
                stateRaw: task.state.rawValue,
                receivedBytes: task.receivedBytes,
                totalBytes: task.totalBytes,
                createdAt: task.createdAt
            ))
        }
        context.saveOrLog()
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
        context.saveOrLog()
    }

    func clearCompleted() {
        let all = (try? context.fetch(FetchDescriptor<DownloadTaskRecord>())) ?? []
        for record in all where record.stateRaw == DownloadState.completed.rawValue {
            context.delete(record)
        }
        context.saveOrLog()
    }
}

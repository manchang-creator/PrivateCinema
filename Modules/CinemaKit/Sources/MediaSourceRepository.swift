import Foundation
import SwiftData

/// 媒体源配置仓储。
public struct MediaSourceRepository {
    public let context: ModelContext

    public func all() -> [MediaSourceRecord] {
        (try? context.fetch(FetchDescriptor<MediaSourceRecord>(
            sortBy: [SortDescriptor(\.priority)]
        ))) ?? []
    }

    public func upsert(_ info: MediaSourceInfo) {
        let sourceId = info.id
        let descriptor = FetchDescriptor<MediaSourceRecord>(
            predicate: #Predicate { record in
                record.sourceId == sourceId
            }
        )
        if let existing = try? context.fetch(descriptor).first {
            existing.name = info.name
            existing.typeRaw = info.type.rawValue
            existing.baseURL = info.baseURL
            existing.username = info.username
            existing.enabled = info.enabled
            existing.priority = info.priority
        } else {
            context.insert(MediaSourceRecord(
                sourceId: info.id,
                name: info.name,
                typeRaw: info.type.rawValue,
                baseURL: info.baseURL,
                username: info.username,
                enabled: info.enabled,
                priority: info.priority,
                createdAt: .now
            ))
        }
        context.saveOrLog()
    }

    public func delete(sourceId: String) {
        let descriptor = FetchDescriptor<MediaSourceRecord>(
            predicate: #Predicate { record in
                record.sourceId == sourceId
            }
        )
        for record in (try? context.fetch(descriptor)) ?? [] {
            context.delete(record)
        }
        context.saveOrLog()
    }
}

extension MediaSourceRecord {
    public var domain: MediaSourceInfo {
        MediaSourceInfo(
            id: sourceId,
            name: name,
            type: MediaSourceType(rawValue: typeRaw) ?? .customAPI,
            baseURL: baseURL,
            username: username,
            enabled: enabled,
            priority: priority
        )
    }
}

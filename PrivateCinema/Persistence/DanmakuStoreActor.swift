import Foundation
import SwiftData

/// 弹幕本地存储（后台 ModelActor，避免阻塞主线程）。
@ModelActor
actor DanmakuStoreActor {
    func fetch(episodeId: String) -> [DanmakuItem] {
        let descriptor = FetchDescriptor<DanmakuRecord>(
            predicate: #Predicate { record in
                record.episodeId == episodeId
            },
            sortBy: [SortDescriptor(\.time)]
        )
        let records = (try? modelContext.fetch(descriptor)) ?? []
        return records.map { $0.domain }
    }

    func search(_ keyword: String) -> [DanmakuItem] {
        let all = (try? modelContext.fetch(FetchDescriptor<DanmakuRecord>(
            sortBy: [SortDescriptor(\.time)]
        ))) ?? []
        let records = keyword.isEmpty ? all : all.filter {
            $0.content.localizedCaseInsensitiveContains(keyword)
        }
        return records.map { $0.domain }
    }

    func insert(_ item: DanmakuItem) {
        let episodeId = item.episodeId
        let descriptor = FetchDescriptor<DanmakuRecord>(
            predicate: #Predicate { record in
                record.episodeId == episodeId
            }
        )
        let existing = (try? modelContext.fetch(descriptor)) ?? []
        guard !existing.contains(where: { $0.danmakuId == item.id }) else { return }
        modelContext.insert(DanmakuRecord(
            danmakuId: item.id,
            mediaId: item.mediaId,
            episodeId: item.episodeId,
            time: item.time,
            content: item.content,
            typeRaw: item.type.rawValue,
            colorHex: item.color,
            userId: item.userId,
            createdAt: item.createdAt
        ))
        modelContext.saveOrLog()
    }
}

extension DanmakuRecord {
    var domain: DanmakuItem {
        DanmakuItem(
            id: danmakuId,
            mediaId: mediaId,
            episodeId: episodeId,
            time: time,
            content: content,
            type: DanmakuType(rawValue: typeRaw) ?? .scroll,
            color: colorHex,
            userId: userId,
            createdAt: createdAt
        )
    }
}

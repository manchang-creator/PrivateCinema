import Foundation
import SwiftData

/// 弹幕仓储（本地弹幕持久化）。
struct DanmakuRepository {
    let context: ModelContext

    func fetch(episodeId: String) -> [DanmakuRecord] {
        let descriptor = FetchDescriptor<DanmakuRecord>(
            predicate: #Predicate { record in
                record.episodeId == episodeId
            },
            sortBy: [SortDescriptor(\.time)]
        )
        return (try? context.fetch(descriptor)) ?? []
    }

    func search(keyword: String) -> [DanmakuRecord] {
        let all = (try? context.fetch(FetchDescriptor<DanmakuRecord>(
            sortBy: [SortDescriptor(\.time)]
        ))) ?? []
        guard !keyword.isEmpty else { return all }
        return all.filter { $0.content.localizedCaseInsensitiveContains(keyword) }
    }

    func insert(_ item: DanmakuItem) {
        // 防重复：同 id 或同 用户+内容+时间点 视为重复发送
        let episodeId = item.episodeId
        let existing = fetch(episodeId: episodeId)
        if existing.contains(where: { $0.danmakuId == item.id }) { return }
        context.insert(DanmakuRecord(
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
        context.saveOrLog()
    }

    func deleteMine(danmakuId: String) {
        let all = (try? context.fetch(FetchDescriptor<DanmakuRecord>())) ?? []
        for record in all where record.danmakuId == danmakuId {
            context.delete(record)
        }
        context.saveOrLog()
    }
}

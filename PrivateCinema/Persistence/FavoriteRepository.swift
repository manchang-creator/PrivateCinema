import Foundation
import SwiftData

/// 收藏仓储。
struct FavoriteRepository {
    let context: ModelContext

    private static let encoder = JSONEncoder()
    private static let decoder = JSONDecoder()

    func setState(_ state: FavoriteState, media: MediaItem) {
        let mediaId = media.id
        let descriptor = FetchDescriptor<FavoriteRecord>(
            predicate: #Predicate { record in
                record.mediaId == mediaId
            }
        )
        let json = (try? Self.encoder.encode(media)) ?? Data()
        if let existing = try? context.fetch(descriptor).first {
            existing.stateRaw = state.rawValue
            existing.addedAt = .now
            existing.itemJSON = json
        } else {
            context.insert(FavoriteRecord(
                mediaId: mediaId,
                stateRaw: state.rawValue,
                addedAt: .now,
                itemJSON: json
            ))
        }
        context.saveOrLog()
    }

    func removeState(mediaId: String) {
        let descriptor = FetchDescriptor<FavoriteRecord>(
            predicate: #Predicate { record in
                record.mediaId == mediaId
            }
        )
        for record in (try? context.fetch(descriptor)) ?? [] {
            context.delete(record)
        }
        context.saveOrLog()
    }

    func state(of mediaId: String) -> FavoriteState? {
        FavoriteState(rawValue: record(for: mediaId)?.stateRaw ?? "")
    }

    func entries(state: FavoriteState) -> [FavoriteEntry] {
        let records = (try? context.fetch(FetchDescriptor<FavoriteRecord>(
            sortBy: [SortDescriptor(\.addedAt, order: .reverse)]
        ))) ?? []
        return records.compactMap { record in
            guard let state = FavoriteState(rawValue: record.stateRaw),
                  let media = try? Self.decoder.decode(MediaItem.self, from: record.itemJSON) else {
                return nil
            }
            return FavoriteEntry(mediaId: record.mediaId, state: state, media: media, addedAt: record.addedAt)
        }
        .filter { $0.state == state }
    }

    private func record(for mediaId: String) -> FavoriteRecord? {
        let descriptor = FetchDescriptor<FavoriteRecord>(
            predicate: #Predicate { record in
                record.mediaId == mediaId
            }
        )
        return try? context.fetch(descriptor).first
    }
}

import Foundation
import SwiftData

/// 播放进度与历史服务：View / Player 不直接访问数据库，一律经由本服务。
@MainActor
final class PlaybackHistoryService {
    private let repository: WatchHistoryRepository

    init(context: ModelContext) {
        self.repository = WatchHistoryRepository(context: context)
    }

    /// 保存一次进度（由播放器定时调用，约每 5 秒一次）。
    func save(
        media: MediaItem,
        episode: Episode,
        position: Double,
        duration: Double
    ) {
        let progress = WatchProgress(
            mediaId: media.id,
            episodeId: episode.id,
            mediaTitle: media.title,
            episodeTitle: episode.displayTitle,
            episodeIndex: episode.index,
            kind: media.kind,
            posterURL: media.posterURL,
            backdropURL: media.backdropURL,
            position: position,
            duration: duration,
            lastPlayedAt: .now,
            completed: WatchProgress.isCompleted(position: position, duration: duration)
        )
        repository.upsert(progress)
    }

    func progress(mediaId: String, episodeId: String) -> WatchProgress? {
        repository.progress(for: mediaId, episodeId: episodeId)
    }

    func progresses(mediaId: String) -> [WatchProgress] {
        repository.progresses(forMedia: mediaId)
    }

    /// 首页"继续观看"。
    func continueWatching() -> [WatchProgress] {
        repository.continueWatching()
    }

    /// 历史页数据。
    func recentHistory() -> [WatchProgress] {
        repository.recent()
    }

    func remove(mediaId: String, episodeId: String) {
        repository.remove(mediaId: mediaId, episodeId: episodeId)
    }

    func clearAll() {
        repository.clearAll()
    }

    /// 某媒体某集的起始位置（没有记录返回 nil）。
    func resumePosition(mediaId: String, episodeId: String) -> Double? {
        guard let progress = repository.progress(for: mediaId, episodeId: episodeId),
              !progress.completed,
              progress.position > 10 else { return nil }
        return progress.position
    }
}

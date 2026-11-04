import Foundation
import SwiftData

/// 播放进度与历史服务：View / Player 不直接访问数据库，一律经由本服务。
@MainActor
public final class PlaybackHistoryService {
    private let repository: WatchHistoryRepository

    public init(context: ModelContext) {
        self.repository = WatchHistoryRepository(context: context)
    }

    /// 保存一次进度（由播放器定时调用，约每 5 秒一次）。
    public func save(
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

    public func progress(mediaId: String, episodeId: String) -> WatchProgress? {
        repository.progress(for: mediaId, episodeId: episodeId)
    }

    public func progresses(mediaId: String) -> [WatchProgress] {
        repository.progresses(forMedia: mediaId)
    }

    /// 首页"继续观看"。
    public func continueWatching() -> [WatchProgress] {
        repository.continueWatching()
    }

    /// 历史页数据。
    public func recentHistory() -> [WatchProgress] {
        repository.recent()
    }

    public func remove(mediaId: String, episodeId: String) {
        repository.remove(mediaId: mediaId, episodeId: episodeId)
    }

    public func clearAll() {
        repository.clearAll()
    }

    /// 某媒体某集的起始位置（没有记录返回 nil）。
    public func resumePosition(mediaId: String, episodeId: String) -> Double? {
        guard let progress = repository.progress(for: mediaId, episodeId: episodeId),
              !progress.completed,
              progress.position > 10 else { return nil }
        return progress.position
    }
}

import Foundation
import SwiftData

/// 全局依赖容器：服务与 Provider 在此装配，通过 SwiftUI Environment 注入。
/// 页面不自行构造服务，避免 Singleton 泛滥。
@MainActor
@Observable
public final class AppEnvironment {

    // MARK: - 基础设施

    public let container: ModelContainer
    public let playbackSettings = PlaybackSettings()

    // MARK: - 服务

    public let history: PlaybackHistoryService
    public let favorites: FavoriteService
    public let danmaku: DanmakuManager
    public let sources: MediaSourceStore
    public let downloads: DownloadManager
    public let identity: DeviceIdentity
    public let player: PlayerManager

    // MARK: - 媒体源

    public let providers: [MediaProvider]
    /// 当前内容源（持久化；做成存储属性以获得 @Observable 通知）
    public var activeProviderID: String =
        UserDefaults.standard.string(forKey: "provider.active") ?? "mock" {
        didSet {
            UserDefaults.standard.set(activeProviderID, forKey: "provider.active")
        }
    }

    public var mediaProvider: MediaProvider {
        providers.first { $0.info.id == activeProviderID } ?? providers[0]
    }

    public func setActiveProvider(_ id: String) {
        guard providers.contains(where: { $0.info.id == id }) else { return }
        activeProviderID = id
    }

    // MARK: - Init

    public init(container: ModelContainer) {
        self.container = container
        let context = container.mainContext

        self.history = PlaybackHistoryService(context: context)
        self.favorites = FavoriteService(context: context)
        self.identity = DeviceIdentity(
            keychain: KeychainStore(service: "com.private.cinema.identity")
        )
        self.sources = MediaSourceStore(
            context: context,
            keychain: KeychainStore(service: "com.private.cinema.sources")
        )
        self.downloads = DownloadManager(context: context, engine: HTTPDownloadEngine())

        let danmakuStore = DanmakuStoreActor(modelContainer: container)
        let provider = LocalDanmakuProvider(
            fetchFromStore: { episodeId in
                await danmakuStore.fetch(episodeId: episodeId)
            },
            persist: { item in
                await danmakuStore.insert(item)
            },
            searchInStore: { keyword in
                await danmakuStore.search(keyword)
            }
        )
        self.danmaku = DanmakuManager(provider: provider)

        self.player = PlayerManager()
        self.providers = [
            MockMediaProvider(),
            LocalMediaProvider(),
        ]
    }

    // MARK: - 播放入口

    /// 从任意页面打开播放器。
    public func openPlayer(
        media: MediaItem,
        episode: Episode,
        episodes: [Episode],
        startPosition: Double? = nil
    ) {
        let request = PlaybackRequest(
            media: media,
            episode: episode,
            playlist: episodes,
            startPosition: startPosition
        )
        player.fullscreenRequest = request
    }

    /// 继续观看入口：直接定位到上次进度。
    public func resumePlayback(progress: WatchProgress) {
        Task {
            do {
                let detail = try await mediaProvider.detail(id: progress.mediaId)
                guard let episode = detail.allEpisodes.first(where: { $0.id == progress.episodeId })
                    ?? detail.allEpisodes.first else {
                    return
                }
                openPlayer(
                    media: detail.item,
                    episode: episode,
                    episodes: detail.allEpisodes,
                    startPosition: progress.position
                )
            } catch {
                // 条目可能已被媒体源移除，忽略
            }
        }
    }
}

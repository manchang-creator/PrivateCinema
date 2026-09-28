import Foundation

/// 详情页视图模型。
@MainActor
@Observable
final class DetailViewModel {
    var state: LoadableState<MediaDetail> = .idle
    var selectedSeasonIndex = 1
    var favoriteState: FavoriteState?
    /// 已看完的集（completed）
    private(set) var watchedEpisodeIDs: Set<String> = []
    /// 当前正在看的集（有进度但未看完）
    private(set) var currentEpisodeID: String?
    /// 每集的续播位置
    private(set) var resumePositions: [String: Double] = [:]
    private(set) var downloadStates: [String: DownloadState] = [:]

    private var mediaID = ""

    func load(mediaID: String, environment: AppEnvironment) async {
        self.mediaID = mediaID
        if case .loaded = state {
            // 刷新进度信息但不闪加载态
        } else {
            state = .loading
        }
        do {
            let detail = try await environment.mediaProvider.detail(id: mediaID)
            refreshLocalState(detail: detail, environment: environment)
            state = .loaded(detail)
        } catch {
            state = .failed(AppError.from(error))
        }
    }

    func refreshLocalState(detail: MediaDetail, environment: AppEnvironment) {
        favoriteState = environment.favorites.state(of: mediaID)
        let progresses = environment.history.progresses(mediaId: mediaID)
        var watched: Set<String> = []
        var current: String?
        var resumes: [String: Double] = [:]
        for progress in progresses {
            if progress.completed {
                watched.insert(progress.episodeId)
            } else if progress.position > 10 {
                resumes[progress.episodeId] = progress.position
                if current == nil {
                    current = progress.episodeId
                }
            }
        }
        watchedEpisodeIDs = watched
        currentEpisodeID = current
        resumePositions = resumes

        var states: [String: DownloadState] = [:]
        for episode in detail.allEpisodes {
            if let state = environment.downloads.state(ofEpisode: episode.id) {
                states[episode.id] = state
            }
        }
        downloadStates = states
    }

    // MARK: - 播放

    func play(episode: Episode, environment: AppEnvironment) {
        guard case .loaded(let detail) = state else { return }
        let start = resumePositions[episode.id]
        environment.openPlayer(
            media: detail.item,
            episode: episode,
            episodes: detail.allEpisodes,
            startPosition: start
        )
    }

    /// "继续播放 / 播放"主按钮。
    var resumeTarget: Episode? {
        guard case .loaded(let detail) = state else { return nil }
        let episodes = detail.allEpisodes
        if let currentID = currentEpisodeID,
           let episode = episodes.first(where: { $0.id == currentID }) {
            return episode
        }
        return episodes.first
    }

    // MARK: - 收藏

    func toggleFavoriteState(_ targetState: FavoriteState, environment: AppEnvironment) {
        guard case .loaded(let detail) = state else { return }
        environment.favorites.toggle(targetState, media: detail.item)
        favoriteState = environment.favorites.state(of: mediaID)
        Haptics.success()
    }

    // MARK: - 下载

    func download(episode: Episode, environment: AppEnvironment) {
        guard case .loaded(let detail) = state else { return }
        environment.downloads.add(media: detail.item, episode: episode)
        downloadStates[episode.id] = .waiting
        Haptics.light()
    }

    func downloadAll(environment: AppEnvironment) {
        guard case .loaded(let detail) = state else { return }
        environment.downloads.add(media: detail.item, episodes: detail.allEpisodes)
        for episode in detail.allEpisodes {
            downloadStates[episode.id] = .waiting
        }
        Haptics.light()
    }
}

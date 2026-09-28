import Foundation

/// 首页视图模型。
@MainActor
@Observable
final class HomeViewModel {

    struct Payload {
        var continueWatching: [WatchProgress]
        var favoriteItems: [MediaItem]
        var sections: [HomeSection]
        /// mediaId -> 角标文案（如"看到第8集"）
        var badges: [String: String]
    }

    var state: LoadableState<Payload> = .idle

    func load(environment: AppEnvironment) async {
        if case .loaded = state { /* 下拉刷新时不闪加载态 */ } else {
            state = .loading
        }
        do {
            let data = try await environment.mediaProvider.home()

            let continueWatching = environment.history.continueWatching()
            let favorites = environment.favorites.entries(state: .favorite)

            var badges: [String: String] = [:]
            for progress in continueWatching {
                badges[progress.mediaId] = "看到第\(progress.episodeIndex)集"
            }

            let favoriteItems = favorites
                .sorted { $0.addedAt > $1.addedAt }
                .map(\.media)

            state = .loaded(Payload(
                continueWatching: continueWatching,
                favoriteItems: favoriteItems,
                sections: data.sections,
                badges: badges
            ))
        } catch {
            state = .failed(AppError.from(error))
        }
    }
}

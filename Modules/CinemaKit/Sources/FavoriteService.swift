import Foundation
import SwiftData

/// 收藏服务（想看 / 收藏 / 看过）。
@MainActor
public final class FavoriteService {
    private let repository: FavoriteRepository

    public init(context: ModelContext) {
        self.repository = FavoriteRepository(context: context)
    }

    public func set(_ state: FavoriteState, media: MediaItem) {
        repository.setState(state, media: media)
    }

    /// 点按同状态按钮 = 取消。
    public func toggle(_ state: FavoriteState, media: MediaItem) {
        if repository.state(of: media.id) == state {
            repository.removeState(mediaId: media.id)
        } else {
            repository.setState(state, media: media)
        }
    }

    public func state(of mediaId: String) -> FavoriteState? {
        repository.state(of: mediaId)
    }

    public func entries(state: FavoriteState) -> [FavoriteEntry] {
        repository.entries(state: state)
    }
}

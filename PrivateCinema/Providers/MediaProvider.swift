import Foundation

/// Provider 元信息。
struct ProviderInfo: Identifiable, Hashable {
    enum Kind: String, Hashable {
        case mock
        case local
        case remote
    }

    let id: String
    var name: String
    var kind: Kind
    var description: String
}

/// 统一媒体源接口。
/// UI / Repository / Player 一律只面向该协议，
/// 具体来源（Mock / 本地 / WebDAV / Jellyfin / 自建 API）通过新实现接入。
protocol MediaProvider: Sendable {
    var info: ProviderInfo { get }

    /// 首页聚合数据。
    func home() async throws -> HomeData

    /// 搜索（Provider 自行决定标题/演员/类型匹配的深度）。
    func search(keyword: String, filters: SearchFilters) async throws -> [MediaItem]

    /// 分类浏览（片库使用，支持分页）。
    func catalog(kind: MediaKind?, page: Int, pageSize: Int) async throws -> [MediaItem]

    func detail(id: String) async throws -> MediaDetail

    func episodes(id: String) async throws -> [Episode]

    func playInfo(episodeId: String) async throws -> PlayInfo

    /// 相关推荐（默认无）。
    func related(id: String) async throws -> [MediaItem]
}

extension MediaProvider {
    func related(id: String) async throws -> [MediaItem] {
        []
    }
}

enum ProviderError: Error {
    case notSupported(String)
    case episodeNotFound(String)
}

import Foundation

/// 媒体源类型（P2：WebDAV / NAS / Jellyfin 等）。
enum MediaSourceType: String, Codable, CaseIterable, Identifiable {
    case localLibrary
    case webdav
    case jellyfin
    case emby
    case plex
    case customAPI

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .localLibrary: return "本地媒体库"
        case .webdav: return "WebDAV"
        case .jellyfin: return "Jellyfin"
        case .emby: return "Emby"
        case .plex: return "Plex"
        case .customAPI: return "自建 API"
        }
    }

    var systemImage: String {
        switch self {
        case .localLibrary: return "internaldrive"
        case .webdav: return "cloud"
        case .jellyfin, .emby, .plex: return "server.rack"
        case .customAPI: return "network"
        }
    }

    /// 当前实现状态下是否可用。
    var isImplemented: Bool {
        switch self {
        case .localLibrary: return true
        default: return false
        }
    }
}

/// 媒体源配置（不含密码等敏感信息，敏感信息在 Keychain）。
struct MediaSourceInfo: Identifiable, Hashable {
    var id: String
    var name: String
    var type: MediaSourceType
    var baseURL: String
    var username: String
    var enabled: Bool
    var priority: Int

    enum ConnectionStatus: Hashable {
        case unknown
        case testing
        case connected
        case failed(String)
    }
}

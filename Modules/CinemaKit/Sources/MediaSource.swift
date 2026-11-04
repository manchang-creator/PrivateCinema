import Foundation

/// 媒体源类型（P2：WebDAV / NAS / Jellyfin 等）。
public enum MediaSourceType: String, Codable, CaseIterable, Identifiable {
    case localLibrary
    case webdav
    case jellyfin
    case emby
    case plex
    case customAPI

    public var id: String { rawValue }

    public var displayName: String {
        switch self {
        case .localLibrary: return "本地媒体库"
        case .webdav: return "WebDAV"
        case .jellyfin: return "Jellyfin"
        case .emby: return "Emby"
        case .plex: return "Plex"
        case .customAPI: return "自建 API"
        }
    }

    public var systemImage: String {
        switch self {
        case .localLibrary: return "internaldrive"
        case .webdav: return "cloud"
        case .jellyfin, .emby, .plex: return "server.rack"
        case .customAPI: return "network"
        }
    }

    /// 当前实现状态下是否可用。
    public var isImplemented: Bool {
        switch self {
        case .localLibrary: return true
        default: return false
        }
    }
}

/// 媒体源配置（不含密码等敏感信息，敏感信息在 Keychain）。
public struct MediaSourceInfo: Identifiable, Hashable {
    /// 跨模块构造入口。
    public init(
        id: String,
        name: String,
        type: MediaSourceType,
        baseURL: String,
        username: String,
        enabled: Bool,
        priority: Int
    ) {
        self.id = id
        self.name = name
        self.type = type
        self.baseURL = baseURL
        self.username = username
        self.enabled = enabled
        self.priority = priority
    }

    public var id: String
    public var name: String
    public var type: MediaSourceType
    public var baseURL: String
    public var username: String
    public var enabled: Bool
    public var priority: Int

    public enum ConnectionStatus: Hashable {
        case unknown
        case testing
        case connected
        case failed(String)
    }
}

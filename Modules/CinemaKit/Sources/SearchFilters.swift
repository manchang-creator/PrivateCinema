import Foundation

/// 搜索/片库的规格筛选项。
public enum SpecFlag: String, Codable, CaseIterable, Identifiable {
    case uhd4K
    case hdr
    case dolbyVision
    case dolbyAtmos

    public var id: String { rawValue }

    public var displayName: String {
        switch self {
        case .uhd4K: return "4K"
        case .hdr: return "HDR"
        case .dolbyVision: return "Dolby Vision"
        case .dolbyAtmos: return "Dolby Atmos"
        }
    }

    public func matches(_ specs: MediaSpecs) -> Bool {
        switch self {
        case .uhd4K: return specs.is4K
        case .hdr: return specs.isHDR
        case .dolbyVision: return specs.isDolbyVision
        case .dolbyAtmos: return specs.isDolbyAtmos
        }
    }
}

/// 观看状态筛选（片库用）。
public enum WatchStateFilter: String, CaseIterable, Identifiable {
    case any
    case unwatched
    case watching
    case finished

    public var id: String { rawValue }
    public var displayName: String {
        switch self {
        case .any: return "全部状态"
        case .unwatched: return "未观看"
        case .watching: return "正在观看"
        case .finished: return "已看完"
        }
    }
}

public enum LibrarySort: String, CaseIterable, Identifiable {
    case recentlyAdded
    case recentlyWatched
    case name
    case year
    case rating
    case recentlyUpdated

    public var id: String { rawValue }
    public var displayName: String {
        switch self {
        case .recentlyAdded: return "最近添加"
        case .recentlyWatched: return "最近观看"
        case .name: return "名称"
        case .year: return "年份"
        case .rating: return "评分"
        case .recentlyUpdated: return "更新时间"
        }
    }
}

/// 统一搜索条件（Provider 自行决定支持程度）。
public struct SearchFilters: Hashable {
    public var kinds: Set<MediaKind> = []
    public var yearRange: ClosedRange<Int>? = nil
    public var areas: [String] = []
    public var genres: [String] = []
    public var finishedOnly: Bool = false
    public var requiredSpecs: Set<SpecFlag> = []
    public var ratingMin: Double? = nil

    public static let none = SearchFilters()

    public var isEmpty: Bool {
        self == SearchFilters.none
    }
}

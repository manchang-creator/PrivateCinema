import Foundation

/// 搜索/片库的规格筛选项。
enum SpecFlag: String, Codable, CaseIterable, Identifiable {
    case uhd4K
    case hdr
    case dolbyVision
    case dolbyAtmos

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .uhd4K: return "4K"
        case .hdr: return "HDR"
        case .dolbyVision: return "Dolby Vision"
        case .dolbyAtmos: return "Dolby Atmos"
        }
    }

    func matches(_ specs: MediaSpecs) -> Bool {
        switch self {
        case .uhd4K: return specs.is4K
        case .hdr: return specs.isHDR
        case .dolbyVision: return specs.isDolbyVision
        case .dolbyAtmos: return specs.isDolbyAtmos
        }
    }
}

/// 观看状态筛选（片库用）。
enum WatchStateFilter: String, CaseIterable, Identifiable {
    case any
    case unwatched
    case watching
    case finished

    var id: String { rawValue }
    var displayName: String {
        switch self {
        case .any: return "全部状态"
        case .unwatched: return "未观看"
        case .watching: return "正在观看"
        case .finished: return "已看完"
        }
    }
}

enum LibrarySort: String, CaseIterable, Identifiable {
    case recentlyAdded
    case recentlyWatched
    case name
    case year
    case rating
    case recentlyUpdated

    var id: String { rawValue }
    var displayName: String {
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
struct SearchFilters: Hashable {
    var kinds: Set<MediaKind> = []
    var yearRange: ClosedRange<Int>? = nil
    var areas: [String] = []
    var genres: [String] = []
    var finishedOnly: Bool = false
    var requiredSpecs: Set<SpecFlag> = []
    var ratingMin: Double? = nil

    static let none = SearchFilters()

    var isEmpty: Bool {
        self == SearchFilters.none
    }
}

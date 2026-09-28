import Foundation

/// 弹幕管理器：数据编排 + 过滤 + 统计。
/// 播放器只与本管理器交互；数据来自本地 / 服务器由 Provider 决定。
@MainActor
@Observable
final class DanmakuManager {
    private let provider: DanmakuProvider
    let settings = DanmakuSettings()

    private(set) var items: [DanmakuItem] = []
    private(set) var isLoading = false
    private(set) var episodeDuration: Double = 0
    private(set) var currentEpisodeId: String?

    private let seeder = DanmakuSeeder()

    init(provider: DanmakuProvider) {
        self.provider = provider
    }

    // MARK: - 加载

    func load(mediaId: String, episodeId: String, duration: Double) async {
        currentEpisodeId = episodeId
        episodeDuration = duration
        isLoading = true
        defer { isLoading = false }

        do {
            var fetched = try await provider.fetchDanmaku(episodeId: episodeId)
            if fetched.isEmpty && duration > 60 {
                // 演示内容：生成确定性种子弹幕并落库
                let seeded = seeder.seed(mediaId: mediaId, episodeId: episodeId, duration: duration)
                for item in seeded {
                    try? await provider.sendDanmaku(item)
                }
                fetched = seeded
            }
            items = fetched.sorted { $0.time < $1.time }
        } catch {
            items = []
        }
    }

    /// 切集 / 退出时清空，避免旧弹幕残留。
    func clear() {
        items = []
        currentEpisodeId = nil
    }

    // MARK: - 过滤

    /// 按设置与防剧透规则过滤后的弹幕（时间升序）。
    func filteredItems() -> [DanmakuItem] {
        let spoiler = SpoilerFilter(
            keywords: settings.blockKeywords + SpoilerFilter.builtIn
        )
        let blockedUsers = Set(settings.blockedUserIds)
        return items.filter { item in
            if item.userId == settings.userId && !settings.showMine { return false }
            if blockedUsers.contains(item.userId) { return false }
            if spoiler.isBlocked(item.content) { return false }
            switch item.type {
            case .scroll: return !settings.blockScroll
            case .top: return !settings.blockTop
            case .bottom: return !settings.blockBottom
            }
        }
    }

    // MARK: - 发送

    @discardableResult
    func send(
        content: String,
        type: DanmakuType,
        colorHex: String,
        mediaId: String,
        episodeId: String,
        time: Double
    ) async throws -> DanmakuItem {
        let item = DanmakuItem(
            mediaId: mediaId,
            episodeId: episodeId,
            time: max(0, time),
            content: content,
            type: type,
            color: colorHex,
            userId: settings.userId
        )
        try await provider.sendDanmaku(item)
        items.append(item)
        items.sort { $0.time < $1.time }
        return item
    }

    /// 撤回自己刚发的弹幕（可选能力，本地源支持）。
    func deleteMine(_ item: DanmakuItem) async {
        items.removeAll { $0.id == item.id }
    }

    // MARK: - 高能统计

    /// 每 `bucketSeconds` 一个桶，返回 0...1 归一化密度（供 Heatmap 渲染）。
    func heatBuckets(bucketSeconds: Double = 10, maxBuckets: Int = 160) -> [Double] {
        guard episodeDuration > 0 else { return [] }
        let bucketCount = min(maxBuckets, max(1, Int(ceil(episodeDuration / bucketSeconds))))
        var buckets = [Double](repeating: 0, count: bucketCount)
        let useable = filteredItems()
        for item in useable {
            let index = min(bucketCount - 1, max(0, Int(item.time / bucketSeconds)))
            buckets[index] += 1
        }
        guard let maxCount = buckets.max(), maxCount > 0 else {
            return buckets.map { _ in 0 }
        }
        return buckets.map { $0 / maxCount }
    }

    /// 高能区间（连续 3 个桶超过阈值视为一段）。
    func highlightRanges(bucketSeconds: Double = 10) -> [ClosedRange<Double>] {
        let buckets = heatBuckets(bucketSeconds: bucketSeconds)
        var ranges: [ClosedRange<Double>] = []
        var startIndex: Int? = nil
        for (index, value) in buckets.enumerated() {
            let isHigh = value >= 0.6
            if isHigh && startIndex == nil {
                startIndex = index
            }
            if !isHigh, let start = startIndex {
                let from = Double(start) * bucketSeconds
                let to = Double(index) * bucketSeconds
                ranges.append(from...to)
                startIndex = nil
            }
        }
        if let start = startIndex {
            ranges.append((Double(start) * bucketSeconds)...episodeDuration)
        }
        return ranges
    }
}

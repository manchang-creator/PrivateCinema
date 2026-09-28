import Foundation

/// 本地弹幕源：SwiftData 持久化。
/// 演示种子弹幕由 DanmakuManager 在首次加载时生成并经本 Provider 落库。
struct LocalDanmakuProvider: DanmakuProvider {
    /// 仓储为值类型（ModelContext 由主线程共享），这里以闭包注入避免 Sendable 纠缠。
    let fetchFromStore: @Sendable (String) async -> [DanmakuItem]
    let persist: @Sendable (DanmakuItem) async -> Void
    let searchInStore: @Sendable (String) async -> [DanmakuItem]

    func fetchDanmaku(episodeId: String) async throws -> [DanmakuItem] {
        await fetchFromStore(episodeId)
    }

    func sendDanmaku(_ item: DanmakuItem) async throws {
        await persist(item)
    }

    func searchDanmaku(keyword: String, episodeId: String?) async throws -> [DanmakuItem] {
        guard !keyword.isEmpty else {
            return await searchInStore("")
        }
        if let episodeId {
            let items = await fetchFromStore(episodeId)
            return items.filter { $0.content.localizedCaseInsensitiveContains(keyword) }
        }
        let all = await searchInStore("")
        return all.filter { $0.content.localizedCaseInsensitiveContains(keyword) }
    }
}

/// 演示弹幕种子生成器：按 episodeId 稳定哈希生成确定性弹幕分布，
/// 保证 Heatmap / 高能进度条每次一致。
struct DanmakuSeeder {
    func seed(mediaId: String, episodeId: String, duration: Double) -> [DanmakuItem] {
        guard duration > 60 else { return [] }
        var generator = SeededGenerator(seed: UInt64(abs(episodeId.hashValue)) | 1)
        let count = Int.random(in: 80...160, using: &generator)
        var items: [DanmakuItem] = []
        // 生成几个"高能区间"，让 Heatmap 有明显峰谷
        let peaks = [0.25, 0.55, 0.8].map { $0 * duration }
        for _ in 0..<count {
            let nearPeak = Bool.random(using: &generator)
            let time: Double
            if nearPeak {
                let peak = peaks.randomElement()!
                time = max(0, peak + Double.random(in: -8...8, using: &generator))
            } else {
                time = Double.random(in: 0..<duration, using: &generator)
            }
            let type: DanmakuType
            switch Int.random(in: 0..<20, using: &generator) {
            case 0: type = .top
            case 1: type = .bottom
            default: type = .scroll
            }
            items.append(DanmakuItem(
                mediaId: mediaId,
                episodeId: episodeId,
                time: time,
                content: MockContent.danmakuPool.randomElement(using: &generator)!,
                type: type,
                color: MockContent.danmakuColors.randomElement(using: &generator)!,
                userId: "seed"
            ))
        }
        return items.sorted { $0.time < $1.time }
    }
}

/// 可复现的随机数生成器。
struct SeededGenerator: RandomNumberGenerator {
    private var state: UInt64

    init(seed: UInt64) {
        state = seed == 0 ? 0x9E3779B97F4A7C15 : seed
    }

    mutating func next() -> UInt64 {
        state ^= state << 13
        state ^= state >> 7
        state ^= state << 17
        return state
    }
}

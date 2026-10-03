import XCTest
@testable import PrivateCinema

/// 弹幕管理器测试：加载、过滤、高能统计、种子门槛。
@MainActor
final class DanmakuManagerTests: XCTestCase {

    /// 内存版 Provider：可控数据，不落库。
    /// 仅在 @MainActor 测试内读写，故 @unchecked Sendable 安全。
    private final class MemoryProvider: DanmakuProvider, @unchecked Sendable {
        var stored: [DanmakuItem] = []
        var fetchResult: [DanmakuItem] = []

        func fetchDanmaku(episodeId: String) async throws -> [DanmakuItem] {
            fetchResult
        }

        func sendDanmaku(_ item: DanmakuItem) async throws {
            stored.append(item)
        }

        func searchDanmaku(keyword: String, episodeId: String?) async throws -> [DanmakuItem] {
            stored
        }
    }

    private func makeManager(provider: MemoryProvider) -> DanmakuManager {
        let manager = makeManager(provider: provider)
        // DanmakuSettings 落在 UserDefaults.standard，先重置避免用例间相互污染
        manager.settings.resetToDefault()
        return manager
    }

    private func makeItem(
        time: Double,
        content: String = "弹幕",
        type: DanmakuType = .scroll,
        userId: String = "u1"
    ) -> DanmakuItem {
        DanmakuItem(
            mediaId: "m1",
            episodeId: "ep1",
            time: time,
            content: content,
            type: type,
            userId: userId
        )
    }

    // MARK: - 加载与种子

    func testLoad_正常拉取并按时间排序() async {
        let provider = MemoryProvider()
        provider.fetchResult = [makeItem(time: 5), makeItem(time: 1), makeItem(time: 3)]
        let manager = makeManager(provider: provider)

        await manager.load(mediaId: "m1", episodeId: "ep1", duration: 100)

        XCTAssertEqual(manager.items.map(\.time), [1, 3, 5])
        XCTAssertFalse(manager.isLoading)
    }

    func testLoad_Mock源空弹幕时生成种子并落库() async {
        let provider = MemoryProvider()
        let manager = makeManager(provider: provider)

        await manager.load(mediaId: "m1", episodeId: "ep1", duration: 300, allowSeeding: true)

        XCTAssertFalse(manager.items.isEmpty)
        // 种子经 Provider 持久化，下次拉取不再为空
        XCTAssertEqual(provider.stored.count, manager.items.count)
    }

    func testLoad_非Mock源空弹幕不生成种子() async {
        let provider = MemoryProvider()
        let manager = makeManager(provider: provider)

        await manager.load(mediaId: "m1", episodeId: "ep1", duration: 300, allowSeeding: false)

        XCTAssertTrue(manager.items.isEmpty)
        XCTAssertTrue(provider.stored.isEmpty)
    }

    func testLoad_短时长不生成种子() async {
        let provider = MemoryProvider()
        let manager = makeManager(provider: provider)

        await manager.load(mediaId: "m1", episodeId: "ep1", duration: 30, allowSeeding: true)

        XCTAssertTrue(manager.items.isEmpty)
        XCTAssertTrue(provider.stored.isEmpty)
    }

    // MARK: - 过滤

    func testFilteredItems_按类型与关键词过滤() async {
        let provider = MemoryProvider()
        provider.fetchResult = [
            makeItem(time: 1),                       // 滚动：被 blockScroll 挡掉
            makeItem(time: 2, type: .top),           // 顶部：保留
            makeItem(time: 3, content: "凶手是他"),  // 剧透词：被过滤
            makeItem(time: 4, userId: "self"),       // 自己的滚动：被 showMine 挡掉
        ]
        let manager = makeManager(provider: provider)
        await manager.load(mediaId: "m1", episodeId: "ep1", duration: 100)

        manager.settings.blockScroll = true
        manager.settings.showMine = false

        let filtered = manager.filteredItems()
        XCTAssertEqual(filtered.count, 1)
        XCTAssertEqual(filtered[0].type, .top)
    }

    // MARK: - 高能统计

    func testHeatBuckets_归一化到0到1() async {
        let provider = MemoryProvider()
        // 0~9 秒 3 条（同桶），90 秒处 1 条
        provider.fetchResult = [
            makeItem(time: 1), makeItem(time: 2), makeItem(time: 3),
            makeItem(time: 90),
        ]
        let manager = makeManager(provider: provider)
        await manager.load(mediaId: "m1", episodeId: "ep1", duration: 100)

        let buckets = manager.heatBuckets(bucketSeconds: 10)
        XCTAssertEqual(buckets.first, 1.0)          // 最密桶归一化为 1
        XCTAssertEqual(buckets[9], 1.0 / 3.0, accuracy: 0.001)
        XCTAssertTrue(buckets.allSatisfy { (0...1).contains($0) })
    }

    func testHighlightRanges_连续高密度桶合并成区间() async {
        let provider = MemoryProvider()
        // 0~39 秒每秒一条（前 4 桶全满），之后为空
        provider.fetchResult = (0..<40).map { makeItem(time: Double($0)) }
        let manager = makeManager(provider: provider)
        await manager.load(mediaId: "m1", episodeId: "ep1", duration: 100)

        let ranges = manager.highlightRanges(bucketSeconds: 10)
        XCTAssertEqual(ranges.count, 1)
        XCTAssertEqual(ranges[0].lowerBound, 0)
        XCTAssertEqual(ranges[0].upperBound, 40, accuracy: 0.001)
    }

    func testHeatBuckets_无时长返回空() async {
        let manager = makeManager(provider: MemoryProvider())
        XCTAssertTrue(manager.heatBuckets().isEmpty)
    }
}

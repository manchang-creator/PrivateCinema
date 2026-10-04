import SwiftData
import XCTest
@testable import PrivateCinema

/// 下载任务状态机测试（可控引擎驱动，不依赖真实网络）。
@MainActor
final class DownloadManagerTests: XCTestCase {

    /// 手动推进度的引擎：测试逐步驱动状态迁移。
    private final class StubEngine: DownloadEngine {
        let handler: @Sendable (URL, URL, Int64, @escaping @Sendable (Int64, Int64) -> Void) async throws -> Void

        init(handler: @escaping @Sendable (URL, URL, Int64, @escaping @Sendable (Int64, Int64) -> Void) async throws -> Void) {
            self.handler = handler
        }

        func download(
            sourceURL: URL,
            destinationURL: URL,
            resumeBytes: Int64,
            reportProgress: @escaping @Sendable (Int64, Int64) -> Void
        ) async throws {
            try await handler(sourceURL, destinationURL, resumeBytes, reportProgress)
        }
    }

    /// 容器必须在测试生命周期内保活：mainContext 依赖容器的底层存储，
    /// 临时容器当行释放会让 context 悬空，fetch 时触发 EXC_BREAKPOINT。
    private var container: ModelContainer!

    override func setUp() {
        super.setUp()
        container = try! ModelContainer(
            for: Schema(PersistenceController.schemaModels),
            configurations: [ModelConfiguration(isStoredInMemoryOnly: true)]
        )
    }

    override func tearDown() {
        container = nil
        super.tearDown()
    }

    private func makeMedia() -> MediaItem {
        MediaItem(id: "m1", title: "测试影片", kind: .movie, year: 2026)
    }

    private func makeEpisode() -> Episode {
        Episode(id: "ep1", mediaId: "m1", seasonIndex: 1, index: 1, title: "第一集", duration: 1200, stillURL: nil, remark: nil)
    }

    private let sourceURL = URL(string: "https://example.com/video/ep1.mp4")!

    func testAdd_任务入列并开始下载() async throws {
        let manager = DownloadManager(
            context: container.mainContext,
            engine: StubEngine { _, _, _, report in
                report(500, 1000)
                try await Task.sleep(nanoseconds: 10_000_000)
            }
        )

        manager.add(media: makeMedia(), episode: makeEpisode(), sourceURL: sourceURL)

        XCTAssertEqual(manager.tasks.count, 1)
        XCTAssertEqual(manager.tasks[0].sourceURL, sourceURL)
        // 轮询等引擎真正跑起来再断言状态与传参（后台 Task 赋值有竞态）
        for _ in 0..<50 where manager.tasks[0].state != .downloading || manager.tasks[0].receivedBytes == 0 {
            try await Task.sleep(nanoseconds: 10_000_000)
        }
        XCTAssertEqual(manager.tasks[0].state, .downloading)
        XCTAssertEqual(manager.tasks[0].receivedBytes, 500)
    }

    func testAdd_重复集数去重() {
        let manager = DownloadManager(
            context: container.mainContext,
            engine: StubEngine { _, _, _, report in
                report(100, 1000)
                try await Task.sleep(nanoseconds: 10_000_000)
            }
        )
        manager.add(media: makeMedia(), episode: makeEpisode(), sourceURL: sourceURL)
        manager.add(media: makeMedia(), episode: makeEpisode(), sourceURL: sourceURL)

        XCTAssertEqual(manager.tasks.count, 1)
    }

    func testProgress_按字节换算进度() async throws {
        let manager = DownloadManager(
            context: container.mainContext,
            engine: StubEngine { _, _, _, report in
                report(250, 1000)
                try await Task.sleep(nanoseconds: 10_000_000)
            }
        )
        manager.add(media: makeMedia(), episode: makeEpisode(), sourceURL: sourceURL)

        for _ in 0..<50 where manager.tasks.first?.receivedBytes == 0 {
            try await Task.sleep(nanoseconds: 10_000_000)
        }
        XCTAssertEqual(manager.tasks[0].receivedBytes, 250)
        XCTAssertEqual(manager.tasks[0].totalBytes, 1000)
        XCTAssertEqual(manager.tasks[0].progress, 0.25, accuracy: 0.001)
    }

    func testPauseResume_暂停保留进度_续传从断点继续() async throws {
        // 首个引擎：上报 500 字节后长睡眠，等测试侧暂停（取消 → CancellationError → paused）
        let manager = DownloadManager(
            context: container.mainContext,
            engine: StubEngine { _, _, _, report in
                report(500, 1000)
                try await Task.sleep(nanoseconds: 10_000_000_000)
            }
        )
        manager.add(media: makeMedia(), episode: makeEpisode(), sourceURL: sourceURL)

        for _ in 0..<50 where manager.tasks.first?.receivedBytes == 0 {
            try await Task.sleep(nanoseconds: 10_000_000)
        }
        XCTAssertEqual(manager.tasks[0].receivedBytes, 500)
        XCTAssertEqual(manager.tasks[0].progress, 0.5, accuracy: 0.001)

        manager.pause(manager.tasks[0])
        XCTAssertEqual(manager.tasks[0].state, .paused)
        XCTAssertEqual(manager.tasks[0].receivedBytes, 500)

        // 换上立即完成的引擎，续传应带上断点字节数
        var resumedBytes: Int64?
        manager.engine = StubEngine { _, _, resume, report in
            resumedBytes = resume
            report(1000, 1000)
        }
        manager.resume(manager.tasks[0])
        for _ in 0..<50 where manager.tasks.first?.state != .completed {
            try await Task.sleep(nanoseconds: 10_000_000)
        }
        XCTAssertEqual(manager.tasks[0].state, .completed)
        XCTAssertEqual(manager.tasks[0].progress, 1.0, accuracy: 0.001)
        XCTAssertEqual(resumedBytes, 500)
    }

    func testEngineFailure_任务标记失败() async throws {
        let engine = StubEngine { _, _, _, _ in
            throw URLError(.badServerResponse)
        }
        let manager = DownloadManager(context: container.mainContext, engine: engine)
        manager.add(media: makeMedia(), episode: makeEpisode(), sourceURL: sourceURL)

        for _ in 0..<50 where manager.tasks.first?.state != .failed {
            try await Task.sleep(nanoseconds: 10_000_000)
        }
        XCTAssertEqual(manager.tasks.first?.state, .failed)
    }

    func testPersistence_任务跨实例恢复() {
        let first = DownloadManager(context: container.mainContext, engine: StubEngine { _, _, _, _ in
            try await Task.sleep(nanoseconds: 10_000_000)
        })
        first.add(media: makeMedia(), episode: makeEpisode(), sourceURL: sourceURL)

        // 新实例应从库中恢复任务（含源地址与已收字节）；下载中状态应重置为等待
        let second = DownloadManager(context: container.mainContext, engine: StubEngine { _, _, _, _ in })
        XCTAssertEqual(second.tasks.count, 1)
        XCTAssertEqual(second.tasks[0].sourceURL, sourceURL)
        XCTAssertTrue([DownloadState.waiting, .downloading, .paused].contains(second.tasks[0].state))
    }

    func testClearCompleted_只清已完成() async throws {
        let manager = DownloadManager(
            context: container.mainContext,
            engine: StubEngine { _, _, _, report in
                report(1000, 1000)
            }
        )
        // 第一集：立即完成
        manager.add(media: makeMedia(), episode: makeEpisode(), sourceURL: sourceURL)
        for _ in 0..<50 where manager.tasks.first?.state != .completed {
            try await Task.sleep(nanoseconds: 10_000_000)
        }

        // 第二集：引擎挂起，保持未完成
        manager.engine = StubEngine { _, _, _, _ in
            try await Task.sleep(nanoseconds: 10_000_000_000)
        }
        manager.add(media: makeMedia(), episode: Episode(
            id: "ep2", mediaId: "m1", seasonIndex: 1, index: 2, title: "第二集", duration: 1200, stillURL: nil, remark: nil
        ), sourceURL: sourceURL)
        manager.clearCompleted()

        XCTAssertEqual(manager.tasks.count, 1)
        XCTAssertEqual(manager.tasks[0].episodeId, "ep2")
    }
}

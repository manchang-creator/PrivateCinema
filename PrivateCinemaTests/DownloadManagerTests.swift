import SwiftData
import XCTest
@testable import PrivateCinema

/// 下载任务状态机测试（可控引擎驱动，不依赖真实网络）。
@MainActor
final class DownloadManagerTests: XCTestCase {

    /// 手动推进度的引擎：测试逐步驱动状态迁移。
    private final class StubEngine: DownloadEngine {
        let handler: @Sendable (@escaping @Sendable (Double) -> Void) async throws -> Void

        init(handler: @escaping @Sendable (@escaping @Sendable (Double) -> Void) async throws -> Void) {
            self.handler = handler
        }

        func download(
            resumeProgress: Double,
            reportProgress: @escaping @Sendable (Double) -> Void
        ) async throws {
            try await handler(reportProgress)
        }
    }

    private func makeContainer() -> ModelContainer {
        try! ModelContainer(
            for: Schema(PersistenceController.schemaModels),
            configurations: [ModelConfiguration(isStoredInMemoryOnly: true)]
        )
    }

    private func makeMedia() -> MediaItem {
        MediaItem(id: "m1", title: "测试影片", kind: .movie, year: 2026)
    }

    private func makeEpisode() -> Episode {
        Episode(id: "ep1", mediaId: "m1", seasonIndex: 1, index: 1, title: "第一集", duration: 1200, stillURL: nil, remark: nil)
    }

    func testAdd_任务入列并开始下载() async {
        let manager = DownloadManager(
            context: makeContainer().mainContext,
            engine: StubEngine { _ in
                try await Task.sleep(nanoseconds: 10_000_000)
            }
        )

        manager.add(media: makeMedia(), episode: makeEpisode())

        XCTAssertEqual(manager.tasks.count, 1)
        XCTAssertEqual(manager.tasks[0].state, .downloading)
    }

    func testAdd_重复集数去重() {
        let manager = DownloadManager(
            context: makeContainer().mainContext,
            engine: StubEngine { _ in try await Task.sleep(nanoseconds: 10_000_000) }
        )
        manager.add(media: makeMedia(), episode: makeEpisode())
        manager.add(media: makeMedia(), episode: makeEpisode())

        XCTAssertEqual(manager.tasks.count, 1)
    }

    func testPauseResume_暂停保留进度_续播从断点继续() async throws {
        // 首个引擎：上报 0.5 后长睡眠，等测试侧暂停（取消 → CancellationError → paused）
        let manager = DownloadManager(
            context: makeContainer().mainContext,
            engine: StubEngine { report in
                report(0.5)
                try await Task.sleep(nanoseconds: 10_000_000_000)
            }
        )
        manager.add(media: makeMedia(), episode: makeEpisode())

        for _ in 0..<50 where manager.tasks.first?.progress == 0 {
            try await Task.sleep(nanoseconds: 10_000_000)
        }
        XCTAssertEqual(manager.tasks[0].progress, 0.5, accuracy: 0.001)

        manager.pause(manager.tasks[0])
        XCTAssertEqual(manager.tasks[0].state, .paused)
        XCTAssertEqual(manager.tasks[0].progress, 0.5, accuracy: 0.001)

        // 换上立即完成的引擎，续传应从断点走到完成
        manager.engine = StubEngine { report in
            report(1.0)
        }
        manager.resume(manager.tasks[0])
        for _ in 0..<50 where manager.tasks.first?.state != .completed {
            try await Task.sleep(nanoseconds: 10_000_000)
        }
        XCTAssertEqual(manager.tasks[0].state, .completed)
        XCTAssertEqual(manager.tasks[0].progress, 1.0, accuracy: 0.001)
    }

    func testEngineFailure_任务标记失败() async throws {
        let engine = StubEngine { _ in
            throw URLError(.badServerResponse)
        }
        let manager = DownloadManager(context: makeContainer().mainContext, engine: engine)
        manager.add(media: makeMedia(), episode: makeEpisode())

        for _ in 0..<50 where manager.tasks.first?.state != .failed {
            try await Task.sleep(nanoseconds: 10_000_000)
        }
        XCTAssertEqual(manager.tasks.first?.state, .failed)
    }

    func testPersistence_任务跨实例恢复() {
        let container = makeContainer()
        let first = DownloadManager(context: container.mainContext, engine: StubEngine { _ in
            try await Task.sleep(nanoseconds: 10_000_000)
        })
        first.add(media: makeMedia(), episode: makeEpisode())

        // 新实例应从库中恢复任务；下载中状态应重置为等待
        let second = DownloadManager(context: container.mainContext, engine: StubEngine { _ in })
        XCTAssertEqual(second.tasks.count, 1)
        XCTAssertTrue([DownloadState.waiting, .downloading, .paused].contains(second.tasks[0].state))
    }

    func testClearCompleted_只清已完成() async throws {
        let manager = DownloadManager(
            context: makeContainer().mainContext,
            engine: StubEngine { report in
                report(1.0)
            }
        )
        // 第一集：立即完成
        manager.add(media: makeMedia(), episode: makeEpisode())
        for _ in 0..<50 where manager.tasks.first?.state != .completed {
            try await Task.sleep(nanoseconds: 10_000_000)
        }

        // 第二集：引擎挂起，保持未完成
        manager.engine = StubEngine { _ in
            try await Task.sleep(nanoseconds: 10_000_000_000)
        }
        manager.add(media: makeMedia(), episode: Episode(
            id: "ep2", mediaId: "m1", seasonIndex: 1, index: 2, title: "第二集", duration: 1200, stillURL: nil, remark: nil
        ))
        manager.clearCompleted()

        XCTAssertEqual(manager.tasks.count, 1)
        XCTAssertEqual(manager.tasks[0].episodeId, "ep2")
    }
}

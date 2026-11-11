import AVFoundation
import XCTest
@testable import CinemaKit

/// 真实 `AVPlayerItem` 加载失败链路测试（模拟器集成）。
///
/// 这里验证的是 **AVFoundation 的 `.status` KVO → `PlayerManager.handleItemFailed`
/// → `onItemFailed` 回调** 这条真实链路，不是 Mock 行为。
///
/// 注意：本测试**不代表真实视频播放通过**。播放成功路径（`.readyToPlay` 后
/// 时间推进、音轨 / 字幕轨道加载）仍需在模拟器或真机上人工验证。
@MainActor
final class PlayerManagerItemFailureTests: XCTestCase {

    /// 不存在的本地文件：`AVPlayerItem` 会异步进入 `.failed`，无需网络。
    private func missingFileURL() -> URL {
        FileManager.default.temporaryDirectory
            .appendingPathComponent("missing-\(UUID().uuidString).mp4")
    }

    func testLoad_不存在的文件_条目失败后回调并停在暂停态() async {
        let manager = PlayerManager()
        let failed = expectation(description: "onItemFailed 被调用")
        var receivedError: Error?

        manager.onItemFailed = { error in
            receivedError = error
            failed.fulfill()
        }

        manager.load(url: missingFileURL(), startPosition: nil, autoplay: false)

        // load 之后的同步状态：正在准备，且显式收口为不缓冲
        XCTAssertEqual(manager.state, .paused)
        XCTAssertFalse(manager.isBuffering)
        XCTAssertNotNil(manager.player.currentItem)

        await fulfillment(of: [failed], timeout: 10)

        XCTAssertEqual(manager.state, .paused)
        XCTAssertFalse(manager.isBuffering)
        XCTAssertNotNil(receivedError, "失败条目应携带 AVFoundation 错误")
        XCTAssertEqual(manager.player.currentItem?.status, .failed)
    }

    func testLoad_替换条目后旧条目失败不影响当前条目() async {
        let manager = PlayerManager()
        let staleFailed = expectation(description: "旧条目失败回调")
        var failCount = 0

        manager.onItemFailed = { _ in
            failCount += 1
            staleFailed.fulfill()
        }

        // 第一条：必然失败
        manager.load(url: missingFileURL(), startPosition: nil, autoplay: false)
        await fulfillment(of: [staleFailed], timeout: 10)
        XCTAssertEqual(failCount, 1)

        // 第二条：同样失败，但回调必须只针对「当前条目」
        let currentFailed = expectation(description: "新条目失败回调")
        manager.onItemFailed = { _ in
            failCount += 1
            currentFailed.fulfill()
        }
        manager.load(url: missingFileURL(), startPosition: nil, autoplay: false)
        await fulfillment(of: [currentFailed], timeout: 10)

        XCTAssertEqual(failCount, 2, "每个当前条目各上报一次，旧条目迟到回调被身份校验挡掉")
    }

    func testStop_清空条目与回调() async {
        let manager = PlayerManager()
        manager.onItemFailed = { _ in }
        manager.onPlaybackEnded = {}
        manager.load(url: missingFileURL(), startPosition: nil, autoplay: false)

        manager.stop()

        XCTAssertNil(manager.player.currentItem)
        XCTAssertNil(manager.activeRequest)
        XCTAssertNil(manager.onItemFailed)
        XCTAssertNil(manager.onPlaybackEnded)
        XCTAssertNil(manager.onItemReady)
        XCTAssertEqual(manager.state, .idle)
        XCTAssertEqual(manager.currentTime, 0)
        XCTAssertEqual(manager.duration, 0)
    }

    func testSeek_无时长时只做下界钳制() {
        let manager = PlayerManager()
        // duration 为 0 时不做上界钳制，只保证非负
        manager.seek(to: -5)
        XCTAssertEqual(manager.currentTime, 0)
        manager.seek(to: 42)
        XCTAssertEqual(manager.currentTime, 42)
    }
}

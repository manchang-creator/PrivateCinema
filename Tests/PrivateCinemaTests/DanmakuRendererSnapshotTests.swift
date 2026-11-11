import UIKit
import XCTest
@testable import CinemaKit

/// 弹幕渲染器确定性测试。
///
/// 只覆盖**不依赖 CADisplayLink 驱动**的部分：快照 → 图层透明度的映射、
/// 载入 / 清空对图层子树的影响。视图不挂进 `UIWindow`，显示链保持暂停，
/// 因此不存在时序抖动。
///
/// 真正的逐帧生成 / 车道分配 / seek 对齐逻辑由 `renderFrame()` 驱动，
/// 属私有实现，须在模拟器或真机上人工验证，不在此处用计时断言替代。
@MainActor
final class DanmakuRendererSnapshotTests: XCTestCase {

    private func makeView() -> DanmakuRendererView {
        DanmakuRendererView(frame: CGRect(x: 0, y: 0, width: 390, height: 219))
    }

    private func makeItem(time: Double, content: String = "测试弹幕") -> DanmakuItem {
        DanmakuItem(
            mediaId: "m1",
            episodeId: "m1-ep-01",
            time: time,
            content: content,
            userId: "user-test"
        )
    }

    // MARK: - 快照 → 透明度

    func testLoad_按快照透明度写入图层() {
        let view = makeView()
        view.load(
            items: [],
            snapshot: DanmakuRendererView.Snapshot(
                areaRatio: 0.5,
                opacity: 0.5,
                fontScale: 1,
                speedFactor: 1,
                allowScroll: true,
                allowTop: true,
                allowBottom: true
            )
        )

        XCTAssertEqual(view.layer.opacity, 0.5)
    }

    func testLoad_三种弹幕全部关闭时透明度归零() {
        let view = makeView()
        view.load(
            items: [],
            snapshot: DanmakuRendererView.Snapshot(
                areaRatio: 0.5,
                opacity: 1,
                fontScale: 1,
                speedFactor: 1,
                allowScroll: false,
                allowTop: false,
                allowBottom: false
            )
        )

        XCTAssertEqual(view.layer.opacity, 0, "全部关闭时 enabledOpacity 必须为 0，与 opacity 无关")
    }

    func testLoad_只关闭一种类型时仍按原透明度显示() {
        let view = makeView()
        view.load(
            items: [],
            snapshot: DanmakuRendererView.Snapshot(
                areaRatio: 0.5,
                opacity: 0.75,
                fontScale: 1,
                speedFactor: 1,
                allowScroll: false,
                allowTop: true,
                allowBottom: true
            )
        )

        XCTAssertEqual(view.layer.opacity, 0.75)
    }

    func testApply_设置变更后同步透明度() {
        let view = makeView()
        view.load(items: [], snapshot: .default)
        XCTAssertEqual(view.layer.opacity, 1)

        view.apply(
            snapshot: DanmakuRendererView.Snapshot(
                areaRatio: 0.25,
                opacity: 0.2,
                fontScale: 1.5,
                speedFactor: 2,
                allowScroll: true,
                allowTop: false,
                allowBottom: false
            )
        )

        XCTAssertEqual(view.layer.opacity, 0.2)
    }

    // MARK: - 载入 / 清空

    func testLoad_不挂窗口时不生成弹幕图层() {
        let view = makeView()
        view.load(
            items: [makeItem(time: 0), makeItem(time: 1)],
            snapshot: .default,
            at: 0
        )

        // 显示链在 window == nil 时保持暂停，渲染帧不会推进
        XCTAssertNil(view.layer.sublayers)
    }

    func testClear_清空待显队列与活动图层() {
        let view = makeView()
        view.load(items: [makeItem(time: 0)], snapshot: .default)
        view.clear()

        XCTAssertNil(view.layer.sublayers)
    }

    func testSkip_清屏后仍可继续载入() {
        let view = makeView()
        view.load(items: [makeItem(time: 0), makeItem(time: 30)], snapshot: .default)
        view.skip(to: 20)
        view.load(items: [makeItem(time: 0)], snapshot: .default, at: 0)

        XCTAssertNil(view.layer.sublayers)
    }
}

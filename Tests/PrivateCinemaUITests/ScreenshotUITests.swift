import XCTest

/// CI 截图预览：逐页导航并通过 XCTAttachment 截图，
/// 由 workflow 里的 xcresulttool 导出为图片产物上传。
/// 每个用例独立导航，单页失败不影响其余页面截图。
final class ScreenshotUITests: XCTestCase {

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    // MARK: - 工具

    private func launch() -> XCUIApplication {
        let app = XCUIApplication()
        app.launch()
        return app
    }

    private func snap(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    /// 等待首页加载与网络海报图（picsum 占位图）就绪。
    private func waitForHome(_ app: XCUIApplication) {
        XCTAssertTrue(app.tabBars.firstMatch.waitForExistence(timeout: 20))
        let poster = app.descendants(matching: .any)["poster-card"].firstMatch
        XCTAssertTrue(poster.waitForExistence(timeout: 20))
        sleep(4)
    }

    // MARK: - 各页截图

    func test01Home() throws {
        let app = launch()
        waitForHome(app)
        snap("01-首页")
    }

    func test02Detail() throws {
        let app = launch()
        waitForHome(app)
        let poster = app.descendants(matching: .any)["poster-card"].firstMatch
        poster.tap()
        sleep(4)
        snap("02-详情")
    }

    func test03Player() throws {
        let app = launch()
        waitForHome(app)
        let poster = app.descendants(matching: .any)["poster-card"].firstMatch
        poster.tap()
        let playButton = app.buttons["播放"]
        XCTAssertTrue(playButton.waitForExistence(timeout: 15))
        playButton.tap()
        // 等演示流起播后，单击画面呼出控制层再截图
        sleep(6)
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.4)).tap()
        sleep(1)
        snap("03-播放器")
    }

    func test04Library() throws {
        let app = launch()
        waitForHome(app)
        app.tabBars.buttons["片库"].tap()
        _ = app.descendants(matching: .any)["poster-card"].firstMatch.waitForExistence(timeout: 20)
        sleep(3)
        snap("04-片库")
    }

    func test05Settings() throws {
        let app = launch()
        XCTAssertTrue(app.tabBars.firstMatch.waitForExistence(timeout: 20))
        app.tabBars.buttons["我的"].tap()
        let settingsEntry = app.buttons["设置"]
        XCTAssertTrue(settingsEntry.waitForExistence(timeout: 15))
        settingsEntry.tap()
        sleep(2)
        snap("05-设置")
    }

    func test06DarkHome() throws {
        let app = launch()
        XCTAssertTrue(app.tabBars.firstMatch.waitForExistence(timeout: 20))
        app.tabBars.buttons["我的"].tap()
        let settingsEntry = app.buttons["设置"]
        XCTAssertTrue(settingsEntry.waitForExistence(timeout: 15))
        settingsEntry.tap()
        let darkSegment = app.buttons["深色"]
        XCTAssertTrue(darkSegment.waitForExistence(timeout: 15))
        darkSegment.tap()
        sleep(1)
        app.tabBars.buttons["首页"].tap()
        waitForHome(app)
        snap("06-首页-深色")
    }
}

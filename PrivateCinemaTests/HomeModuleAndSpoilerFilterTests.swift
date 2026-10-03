import XCTest
@testable import PrivateCinema

/// 首页模块映射与防剧透过滤测试。
final class HomeModuleAndSpoilerFilterTests: XCTestCase {

    // MARK: - HomeModule section 映射

    func testSectionId映射覆盖全部Provider约定id() {
        // MockMediaProvider 使用的全部 section id 必须可映射，否则模块隐藏功能静默失效
        let providerIds = ["recent-updates", "recent-added", "hot-movies", "hot-series", "anime", "variety"]
        for id in providerIds {
            XCTAssertNotNil(HomeModule(sectionId: id), "section id \(id) 缺少 HomeModule 映射")
        }
    }

    func test未知SectionId返回nil() {
        XCTAssertNil(HomeModule(sectionId: "local"))
        XCTAssertNil(HomeModule(sectionId: ""))
    }

    // MARK: - SpoilerFilter

    func testSpoilerFilter_命中屏蔽词不区分大小写() {
        let filter = SpoilerFilter(keywords: ["结局"])
        XCTAssertTrue(filter.isBlocked("大结局真离谱"))
        XCTAssertTrue(filter.isBlocked("The END 结局"))
    }

    func testSpoilerFilter_空关键词与未命中() {
        let filter = SpoilerFilter(keywords: ["", "  "])
        XCTAssertFalse(filter.isBlocked("正常评论"))
        XCTAssertFalse(SpoilerFilter(keywords: []).isBlocked("凶手是他"))
    }

    func testSpoilerFilter_内置词包含剧透关键词() {
        XCTAssertTrue(SpoilerFilter.builtIn.contains("凶手是"))
        let filter = SpoilerFilter(keywords: SpoilerFilter.builtIn)
        XCTAssertTrue(filter.isBlocked("内鬼是主角"))
    }
}

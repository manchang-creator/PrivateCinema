import XCTest
@testable import PrivateCinema

/// SRT / VTT 字幕解析器测试。
final class SubtitleParserTests: XCTestCase {

    // MARK: - SRT

    func testParseSRT_标准双行字幕() {
        let raw = """
        1
        00:00:01,000 --> 00:00:03,500
        你好

        2
        00:00:04,000 --> 00:00:06,000
        第二句
        第二行
        """
        let cues = SubtitleParser.parse(raw)
        XCTAssertEqual(cues.count, 2)
        XCTAssertEqual(cues[0].start, 1.0, accuracy: 0.001)
        XCTAssertEqual(cues[0].end, 3.5, accuracy: 0.001)
        XCTAssertEqual(cues[0].text, "你好")
        XCTAssertEqual(cues[1].text, "第二句\n第二行")
    }

    func testParseSRT_缺序号块仍可解析() {
        // 现实中的 SRT 常见缺序号，解析不应依赖序号行
        let raw = """
        00:00:01,000 --> 00:00:02,000
        无序号块
        """
        let cues = SubtitleParser.parse(raw)
        XCTAssertEqual(cues.count, 1)
        XCTAssertEqual(cues[0].text, "无序号块")
    }

    func testParseSRT_CRLF换行() {
        let raw = "1\r\n00:00:01,000 --> 00:00:02,000\r\nWindows 换行\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\n第二句"
        let cues = SubtitleParser.parse(raw)
        XCTAssertEqual(cues.count, 2)
        XCTAssertEqual(cues[1].text, "第二句")
    }

    func testParseSRT_空文本块被跳过() {
        let raw = """
        1
        00:00:01,000 --> 00:00:02,000


        """
        XCTAssertTrue(SubtitleParser.parse(raw).isEmpty)
    }

    // MARK: - VTT

    func testParseVTT_剥离内联标签与头声明() {
        let raw = """
        WEBVTT

        00:00.000 --> 00:02.000
        <i>斜体</i>正文

        NOTE 这是注释块

        00:03.000 --> 00:04.500
        第二句
        """
        let cues = SubtitleParser.parse(raw)
        XCTAssertEqual(cues.count, 2)
        XCTAssertEqual(cues[0].text, "斜体正文")
        XCTAssertEqual(cues[1].start, 3.0, accuracy: 0.001)
    }

    // MARK: - 时间戳与边界

    func testTimestamp_时分秒毫秒全字段() {
        let raw = "1\n01:02:03,400 --> 01:02:04,000\n文本"
        let cues = SubtitleParser.parse(raw)
        XCTAssertEqual(cues[0].start, 3723.4, accuracy: 0.001)
    }

    func testParse_空输入与乱输入返回空() {
        XCTAssertTrue(SubtitleParser.parse("").isEmpty)
        XCTAssertTrue(SubtitleParser.parse("这不是字幕").isEmpty)
    }

    func testParse_结果按起始时间排序() {
        let raw = """
        1
        00:00:10,000 --> 00:00:11,000
        后写前播

        2
        00:00:01,000 --> 00:00:02,000
        先播
        """
        let cues = SubtitleParser.parse(raw)
        XCTAssertEqual(cues[0].text, "先播")
        XCTAssertEqual(cues[1].text, "后写前播")
    }
}

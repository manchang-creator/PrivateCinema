import XCTest
@testable import CinemaKit

/// 媒体源两阶段解析测试。
///
/// `playInfo` 只声明「有哪些线路 / 字幕 / 音轨」，`resolvePlayback` 才给出可播放地址。
/// 全部断言基于 `MockContent` 的确定性映射表，不访问网络。
final class MediaProviderPlaybackTests: XCTestCase {

    private let provider = MockMediaProvider()

    // MARK: - 剧集：播放信息构造

    func testPlayInfo_剧集首集_返回默认线路与外挂字幕与音轨() async throws {
        let info = try await provider.playInfo(episodeId: "mock-series-01-ep-01")

        XCTAssertEqual(info.episodeId, "mock-series-01-ep-01")
        XCTAssertEqual(info.lines.map(\.id), ["default"])
        XCTAssertEqual(info.lines.first?.name, "默认线路")
        XCTAssertEqual(info.audioTracks.map(\.id), ["default"])
        XCTAssertEqual(info.audioTracks.first?.languageCode, "und")
        XCTAssertEqual(info.externalSubtitles.count, 1)
        XCTAssertEqual(info.externalSubtitles.first?.id, "external-demo-srt")
        XCTAssertEqual(info.externalSubtitles.first?.isExternal, true)
        XCTAssertEqual(info.externalSubtitles.first?.languageCode, "zh-Hans")
    }

    func testPlayInfo_剧集非首集_不声明外挂字幕() async throws {
        let info = try await provider.playInfo(episodeId: "mock-series-01-ep-02")

        XCTAssertEqual(info.lines.count, 1)
        XCTAssertTrue(info.externalSubtitles.isEmpty)
        XCTAssertEqual(info.audioTracks.count, 1)
    }

    // MARK: - 电影：播放信息构造

    func testPlayInfo_电影正片_返回默认线路与默认音轨() async throws {
        let info = try await provider.playInfo(episodeId: "mock-movie-01-ep-01")

        XCTAssertEqual(info.episodeId, "mock-movie-01-ep-01")
        XCTAssertEqual(info.lines.map(\.id), ["default"])
        XCTAssertEqual(info.audioTracks.map(\.id), ["default"])
        // 电影正片同样走「第 1 集」分支，因此带外挂字幕声明。
        // 不校验 url 是否可解析：测试宿主内的 Bundle 资源查找不稳定。
        XCTAssertEqual(info.externalSubtitles.count, 1)
    }

    // MARK: - 第二阶段：线路 → 地址

    func testResolvePlayback_剧集首集_解析为HLS() async throws {
        let resolved = try await provider.resolvePlayback(
            line: PlayLine(id: "default", name: "默认线路"),
            episodeId: "mock-series-01-ep-01"
        )

        XCTAssertEqual(resolved.url, MockContent.appleHLS)
        XCTAssertEqual(resolved.urlKind, .hls)
    }

    func testResolvePlayback_剧集非首集_解析为MP4() async throws {
        let resolved = try await provider.resolvePlayback(
            line: PlayLine(id: "default", name: "默认线路"),
            episodeId: "mock-series-01-ep-02"
        )

        // planIndex 0 + 集号 2 - 1 = 1
        XCTAssertEqual(resolved.url, MockContent.sampleMP4s[1])
        XCTAssertEqual(resolved.urlKind, .mp4)
    }

    func testResolvePlayback_非HLS剧集首集_解析为MP4() async throws {
        let resolved = try await provider.resolvePlayback(
            line: PlayLine(id: "default", name: "默认线路"),
            episodeId: "mock-series-02-ep-01"
        )

        // planIndex 1 + 集号 1 - 1 = 1
        XCTAssertEqual(resolved.url, MockContent.sampleMP4s[1])
        XCTAssertEqual(resolved.urlKind, .mp4)
    }

    func testResolvePlayback_电影正片_解析为MP4() async throws {
        let resolved = try await provider.resolvePlayback(
            line: PlayLine(id: "default", name: "默认线路"),
            episodeId: "mock-movie-01-ep-01"
        )

        XCTAssertEqual(resolved.url, MockContent.sampleMP4s[0])
        XCTAssertEqual(resolved.urlKind, .mp4)
    }

    func testResolvePlayback_电影末位_按电影下标映射到示例池() async throws {
        let resolved = try await provider.resolvePlayback(
            line: PlayLine(id: "default", name: "默认线路"),
            episodeId: "mock-movie-06-ep-01"
        )

        // movieIndex 5 + 1 - 1 = 5
        XCTAssertEqual(resolved.url, MockContent.sampleMP4s[5])
    }

    /// 固化当前行为：Mock 源只有一个线路，线路参数不参与地址计算。
    /// 真实多线路源的「无效线路」语义由 Provider 自行定义，这里只记录 Mock 的现状，
    /// 避免将来无意识改变演示源的解析结果。
    func testResolvePlayback_忽略线路参数_仅按剧集寻址() async throws {
        let resolved = try await provider.resolvePlayback(
            line: PlayLine(id: "no-such-line", name: "不存在的线路"),
            episodeId: "mock-series-01-ep-02"
        )

        XCTAssertEqual(resolved.url, MockContent.sampleMP4s[1])
    }

    // MARK: - 错误处理

    func testPlayInfo_无效剧集编号_抛notFound() async {
        let invalidIds = [
            "mock-series-01-ep-99",   // 超出集数
            "mock-series-01-ep-00",   // 集号从 1 开始
            "mock-movie-01-ep-02",    // 电影只有一条正片
            "bogus",                  // 缺少 -ep- 分隔符
            "mock-series-01-ep-",     // 集号缺失
            "no-such-media-ep-01",    // 媒体不存在
            "",
        ]
        for id in invalidIds {
            do {
                _ = try await provider.playInfo(episodeId: id)
                XCTFail("playInfo(\(id)) 应抛 notFound")
            } catch {
                XCTAssertEqual(error as? AppError, .notFound, "playInfo(\(id))")
            }
        }
    }

    func testResolvePlayback_无效剧集编号_抛notFound() async {
        let line = PlayLine(id: "default", name: "默认线路")
        let invalidIds = ["mock-series-01-ep-99", "mock-movie-01-ep-02", "bogus"]
        for id in invalidIds {
            do {
                _ = try await provider.resolvePlayback(line: line, episodeId: id)
                XCTFail("resolvePlayback(\(id)) 应抛 notFound")
            } catch {
                XCTAssertEqual(error as? AppError, .notFound, "resolvePlayback(\(id))")
            }
        }
    }

    // MARK: - 季集构造

    func testEpisodes_剧集构造_集数编号与时长一致() {
        let plan = MockContent.seriesPlans[0]
        let episodes = MockContent.episodes(for: plan)

        XCTAssertEqual(episodes.count, plan.episodeCount)
        XCTAssertEqual(episodes.first?.id, "mock-series-01-ep-01")
        XCTAssertEqual(episodes.last?.id, "mock-series-01-ep-16")
        XCTAssertEqual(episodes.first?.index, 1)
        XCTAssertEqual(episodes.last?.index, plan.episodeCount)
        XCTAssertTrue(episodes.allSatisfy { $0.mediaId == plan.id })
        XCTAssertTrue(episodes.allSatisfy { $0.seasonIndex == 1 })
        XCTAssertTrue(episodes.allSatisfy { $0.duration == Double(plan.episodeMinutes * 60) })
    }

    func testMovieEpisode_电影构造_单片单集正片() {
        let movie = MockContent.movies[0]
        let episode = MockContent.movieEpisode(for: movie)

        XCTAssertEqual(episode.id, "mock-movie-01-ep-01")
        XCTAssertEqual(episode.mediaId, movie.id)
        XCTAssertEqual(episode.title, movie.title)
        XCTAssertEqual(episode.duration, Double(movie.durationMinutes * 60))
        XCTAssertEqual(episode.seasonIndex, 1)
        XCTAssertEqual(episode.index, 1)
    }

    func testDetail_电影返回可播放的季集结构() async throws {
        let detail = try await provider.detail(id: "mock-movie-01")

        XCTAssertEqual(detail.seasons.count, 1)
        XCTAssertEqual(detail.seasons.first?.name, "正片")
        XCTAssertEqual(detail.allEpisodes.count, 1)
        XCTAssertEqual(detail.allEpisodes.first?.id, "mock-movie-01-ep-01")
    }
}

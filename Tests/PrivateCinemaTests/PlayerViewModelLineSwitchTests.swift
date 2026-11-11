import AVFoundation
import SwiftData
import XCTest
@testable import CinemaKit

/// 线路切换状态机测试（真实 `PlayerViewModel` + 替身 Provider + 真实 AVPlayer）。
///
/// 播放地址使用本地生成的静音 WAV：离线、确定、`AVPlayerItem` 能真正进入
/// `.readyToPlay`，因此线路切换走的是与生产一致的「替换条目 → 就绪 / 失败回调」链路。
///
/// 覆盖：切换成功后状态更新、解析失败保留原线路、新地址加载失败回退原线路、
/// 解析进行中重复点击被互斥挡下、换集沿用 / 失效线路清理。
///
/// 注意：本测试验证的是**状态机与回调接线**，不代表真实视频解码播放通过。
@MainActor
final class PlayerViewModelLineSwitchTests: XCTestCase {

    // MARK: - 替身 Provider

    /// 可编排的媒体源：线路列表、解析结果、解析闸门全部由测试控制。
    /// 与仓库既有 `MemoryProvider` 同款写法：仅在测试内使用，故 @unchecked Sendable。
    private final class FakeProvider: MediaProvider, @unchecked Sendable {
        let info: ProviderInfo
        let lines: [PlayLine]
        /// 按剧集覆盖线路列表；缺省回落到 `lines`。
        var linesByEpisodeID: [String: [PlayLine]] = [:]
        /// 线路 id → 解析出的地址；缺省视为解析失败。
        var urlsByLineID: [String: URL] = [:]
        /// 非 nil 时所有解析都在此闸门上等待，用于制造「解析未完成」的中间态。
        var gate: Gate?
        private(set) var resolveCallCount = 0

        init(lines: [PlayLine]) {
            self.info = ProviderInfo(
                id: "fake-line-test",
                name: "线路测试源",
                kind: .remote,
                description: "仅用于测试"
            )
            self.lines = lines
        }

        func home() async throws -> HomeData { HomeData(sections: []) }
        func search(keyword: String, filters: SearchFilters) async throws -> [MediaItem] { [] }
        func catalog(kind: MediaKind?, page: Int, pageSize: Int) async throws -> [MediaItem] { [] }
        func detail(id: String) async throws -> MediaDetail { throw AppError.notFound }
        func episodes(id: String) async throws -> [Episode] { [] }

        func playInfo(episodeId: String) async throws -> PlayInfo {
            PlayInfo(episodeId: episodeId, lines: linesByEpisodeID[episodeId] ?? lines)
        }

        func resolvePlayback(line: PlayLine, episodeId: String) async throws -> ResolvedPlayback {
            resolveCallCount += 1
            if let gate { await gate.wait() }
            guard let url = urlsByLineID[line.id] else {
                throw AppError.provider("线路不可用")
            }
            return ResolvedPlayback(url: url, urlKind: .mp4)
        }
    }

    /// 手动放行的闸门：让测试停在「解析尚未返回」的瞬间。
    private final class Gate: @unchecked Sendable {
        private var waiters: [CheckedContinuation<Void, Never>] = []
        private var isOpen = false

        func wait() async {
            if isOpen { return }
            await withCheckedContinuation { waiters.append($0) }
        }

        func open() {
            isOpen = true
            let pending = waiters
            waiters = []
            pending.forEach { $0.resume() }
        }
    }

    // MARK: - 夹具

    /// 容器必须在整个测试套件生命周期内保活：进度保存任务可能在测试结束后才落库，
    /// 容器若已释放，悬空的 mainContext 执行 fetch 会触发 EXC_BREAKPOINT。
    private static var aliveContainers: [ModelContainer] = []
    private var container: ModelContainer!
    private var environment: AppEnvironment!
    private var previousProviderID: String?
    private var mediaFileURL: URL!

    private let lineA = PlayLine(id: "line-a", name: "线路 A")
    private let lineB = PlayLine(id: "line-b", name: "线路 B")
    private let lineC = PlayLine(id: "line-c", name: "线路 C")

    override func setUp() {
        super.setUp()
        container = try! ModelContainer(
            for: Schema(PersistenceController.schemaModels),
            configurations: [ModelConfiguration(isStoredInMemoryOnly: true)]
        )
        Self.aliveContainers.append(container)
        previousProviderID = UserDefaults.standard.string(forKey: "provider.active")
        mediaFileURL = Self.makeSilentWAV(seconds: 60)
    }

    override func tearDown() {
        environment?.player.stop()
        if let previousProviderID {
            UserDefaults.standard.set(previousProviderID, forKey: "provider.active")
        } else {
            UserDefaults.standard.removeObject(forKey: "provider.active")
        }
        environment = nil
        container = nil
        if let mediaFileURL { try? FileManager.default.removeItem(at: mediaFileURL) }
        super.tearDown()
    }

    /// 生成一段静音 WAV：AVFoundation 原生支持，无需网络与仓库资源。
    private static func makeSilentWAV(seconds: Int) -> URL {
        let sampleRate: UInt32 = 8_000
        let channels: UInt16 = 1
        let bitsPerSample: UInt16 = 16
        let byteRate = sampleRate * UInt32(channels) * UInt32(bitsPerSample / 8)
        let blockAlign = channels * (bitsPerSample / 8)
        let dataSize = byteRate * UInt32(seconds)

        var data = Data()
        func appendASCII(_ text: String) { data.append(contentsOf: Array(text.utf8)) }
        func appendUInt32(_ value: UInt32) {
            withUnsafeBytes(of: value.littleEndian) { data.append(contentsOf: $0) }
        }
        func appendUInt16(_ value: UInt16) {
            withUnsafeBytes(of: value.littleEndian) { data.append(contentsOf: $0) }
        }

        appendASCII("RIFF")
        appendUInt32(36 + dataSize)
        appendASCII("WAVE")
        appendASCII("fmt ")
        appendUInt32(16)
        appendUInt16(1)                 // PCM
        appendUInt16(channels)
        appendUInt32(sampleRate)
        appendUInt32(byteRate)
        appendUInt16(blockAlign)
        appendUInt16(bitsPerSample)
        appendASCII("data")
        appendUInt32(dataSize)
        data.append(Data(count: Int(dataSize)))

        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("silent-\(UUID().uuidString).wav")
        try! data.write(to: url)
        return url
    }

    private func makeEnvironment(provider: FakeProvider) -> AppEnvironment {
        let env = AppEnvironment(container: container, providers: [provider])
        env.activeProviderID = provider.info.id
        return env
    }

    private func makeRequest() -> PlaybackRequest {
        let media = MediaItem(id: "fake-media", title: "测试影片", kind: .series, year: 2026)
        let episodes = (1...3).map { index in
            Episode(
                id: "fake-ep-\(String(format: "%02d", index))",
                mediaId: media.id,
                seasonIndex: 1,
                index: index,
                title: "第\(index)集",
                duration: 60,
                stillURL: nil,
                remark: nil
            )
        }
        return PlaybackRequest(
            media: media,
            episode: episodes[0],
            playlist: episodes
        )
    }

    /// 构建播放上下文并等待首条目真正就绪。
    /// 首条目的就绪回调会清空回退快照，必须等它落地后再开始切换，
    /// 否则它的迟到回调会与切换建立快照的时机重叠。
    private func makeSUT(resolveURLs: [String: URL]) async -> (PlayerViewModel, FakeProvider) {
        let provider = FakeProvider(lines: [lineA, lineB, lineC])
        provider.urlsByLineID = resolveURLs
        environment = makeEnvironment(provider: provider)
        let viewModel = PlayerViewModel(environment: environment, request: makeRequest())
        await viewModel.prepare()
        await waitUntil("首条目就绪") {
            self.environment.player.player.currentItem?.status == .readyToPlay
        }
        // 让 KVO → MainActor 的就绪回调跑完
        try? await Task.sleep(nanoseconds: 50_000_000)
        return (viewModel, provider)
    }

    private func waitUntil(
        timeout: TimeInterval = 10,
        _ description: String,
        _ condition: () -> Bool
    ) async {
        let deadline = Date().addingTimeInterval(timeout)
        while !condition() {
            if Date() > deadline {
                XCTFail("等待超时：\(description)")
                return
            }
            try? await Task.sleep(nanoseconds: 10_000_000)
        }
    }

    // MARK: - 切换成功

    func testSelectLine_切换成功_更新选中线路且保持会话() async {
        let (viewModel, provider) = await makeSUT(resolveURLs: [
            lineA.id: mediaFileURL,
            lineB.id: mediaFileURL,
        ])

        XCTAssertEqual(viewModel.selectedLineID, lineA.id)
        XCTAssertNil(viewModel.loadError)

        await viewModel.selectLine(lineB)

        XCTAssertEqual(viewModel.selectedLineID, lineB.id)
        XCTAssertEqual(viewModel.selectedLine?.id, lineB.id)
        XCTAssertNil(viewModel.lineSwitchError)
        XCTAssertFalse(viewModel.isSwitchingLine)
        XCTAssertEqual(provider.resolveCallCount, 2, "prepare 一次 + 切换一次")
        XCTAssertEqual(viewModel.request.episode.id, "fake-ep-01", "切线路不得改变播放上下文")
    }

    func testSelectLine_点击当前线路_直接返回() async {
        let (viewModel, provider) = await makeSUT(resolveURLs: [
            lineA.id: mediaFileURL,
            lineB.id: mediaFileURL,
        ])

        await viewModel.selectLine(lineA)

        XCTAssertEqual(provider.resolveCallCount, 1, "同一线路不应重新解析")
        XCTAssertEqual(viewModel.selectedLineID, lineA.id)
    }

    // MARK: - 解析失败：保留原线路

    func testSelectLine_解析失败_保留原线路并就地提示() async {
        // 线路 B 没有地址 → 解析阶段抛错
        let (viewModel, provider) = await makeSUT(resolveURLs: [lineA.id: mediaFileURL])

        await viewModel.selectLine(lineB)

        XCTAssertEqual(provider.resolveCallCount, 2)
        XCTAssertEqual(viewModel.selectedLineID, lineA.id, "解析失败时选中项不得先行漂移")
        XCTAssertEqual(viewModel.lineSwitchError, "线路切换失败，已保持原线路")
        XCTAssertNil(viewModel.loadError, "旧线路仍在播，不应弹全屏错误")
        XCTAssertFalse(viewModel.isSwitchingLine)
    }

    // MARK: - 新地址加载失败：回退原线路

    func testSelectLine_新地址加载失败_回退原线路() async {
        let missing = FileManager.default.temporaryDirectory
            .appendingPathComponent("missing-\(UUID().uuidString).mp4")
        let (viewModel, _) = await makeSUT(resolveURLs: [
            lineA.id: mediaFileURL,
            lineB.id: missing,
        ])

        await viewModel.selectLine(lineB)

        // 条目失败回调异步到达：选中项先退回，再重新解析旧线路
        await waitUntil("回退完成") {
            viewModel.selectedLineID == self.lineA.id && !viewModel.isSwitchingLine
        }

        XCTAssertEqual(viewModel.selectedLineID, lineA.id)
        XCTAssertEqual(viewModel.lineSwitchError, "线路切换失败，已恢复原线路")
        XCTAssertNil(viewModel.loadError, "回退成功不应留下全屏错误")
    }

    // MARK: - 并发：解析中重复点击被互斥挡下

    func testSelectLine_解析进行中重复点击_只生效一次() async {
        let (viewModel, provider) = await makeSUT(resolveURLs: [
            lineA.id: mediaFileURL,
            lineB.id: mediaFileURL,
            lineC.id: mediaFileURL,
        ])
        let gate = Gate()
        provider.gate = gate

        let first = Task { await viewModel.selectLine(lineB) }
        await waitUntil("第一次解析已开始") {
            viewModel.isSwitchingLine && provider.resolveCallCount == 2
        }

        // 解析未返回时再点另一条线路：必须被 isSwitchingLine 挡下
        await viewModel.selectLine(lineC)
        XCTAssertEqual(provider.resolveCallCount, 2, "互斥期间不得发起第二次解析")
        XCTAssertEqual(viewModel.selectedLineID, lineA.id)

        gate.open()
        await first.value

        XCTAssertEqual(viewModel.selectedLineID, lineB.id, "只有第一次切换生效")
        XCTAssertFalse(viewModel.isSwitchingLine)
    }

    // MARK: - 换集：线路沿用与失效清理

    func testPlay_切换剧集_沿用线路并重新解析() async {
        let (viewModel, provider) = await makeSUT(resolveURLs: [
            lineA.id: mediaFileURL,
            lineB.id: mediaFileURL,
        ])
        await viewModel.selectLine(lineB)
        XCTAssertEqual(viewModel.selectedLineID, lineB.id)

        await viewModel.play(episode: viewModel.request.playlist[1])

        XCTAssertEqual(viewModel.request.episode.id, "fake-ep-02")
        XCTAssertEqual(viewModel.selectedLineID, lineB.id, "该集也有线路 B，应沿用")
        XCTAssertNil(viewModel.loadError)
        // prepare(1) + 切换(1) + 换集(1)
        XCTAssertEqual(provider.resolveCallCount, 3)
    }

    func testPlay_新剧集没有原线路_失效选择被丢弃并落到第一条() async {
        let (viewModel, provider) = await makeSUT(resolveURLs: [
            lineA.id: mediaFileURL,
            lineB.id: mediaFileURL,
        ])
        await viewModel.selectLine(lineB)
        XCTAssertEqual(viewModel.selectedLineID, lineB.id)

        // 第二集只提供线路 A：prepare 必须丢弃失效的线路 B 选择
        provider.linesByEpisodeID["fake-ep-02"] = [lineA]
        await viewModel.play(episode: viewModel.request.playlist[1])

        XCTAssertEqual(viewModel.request.episode.id, "fake-ep-02")
        // 失效选择被丢弃后落到第一条；装载成功后 selectedLineID 记录实际在播线路，
        // 保证「选中项恒等于正在播放的线路」（否则再点第一条会被当成新选择重载）
        XCTAssertEqual(viewModel.selectedLineID, lineA.id, "失效的线路 B 应被丢弃")
        XCTAssertEqual(viewModel.selectedLine?.id, lineA.id, "selectedLine 落到第一条")
        XCTAssertNil(viewModel.loadError)
    }
}

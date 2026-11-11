import AVFoundation
import Foundation
import UIKit

/// 播放器编排层：连接 Provider / 进度服务 / 弹幕 / 字幕 与 PlayerManager。
/// View 只与本 ViewModel 交互；ViewModel 不直接写数据库（经服务层）。
@MainActor
@Observable
public final class PlayerViewModel {

    public enum ControlSheet: Hashable, Identifiable {
        case danmakuSettings
        case subtitleSettings
        case trackPicker

        public var id: Self { self }
    }

    // MARK: - 依赖

    public let environment: AppEnvironment
    private let manager: PlayerManager
    public var danmaku: DanmakuManager { environment.danmaku }
    public let subtitles = SubtitleManager()
    /// 弹幕渲染视图（由 PlayerView 挂载为覆盖层）
    public let renderer = DanmakuRendererView(frame: .zero)

    // MARK: - 播放上下文

    public private(set) var request: PlaybackRequest
    public private(set) var playInfo: PlayInfo?
    /// 当前选中的线路（切集时沿用；该集没有此线路则退回第一条）
    public private(set) var selectedLineID: String?
    public private(set) var loadError: AppError?
    /// 线路切换失败提示：只影响这一次切换，旧线路仍在正常播放，
    /// 因此不用全屏 loadError，改为在轨道面板内就地提示。
    public private(set) var lineSwitchError: String?
    /// 线路解析中（远端二次跳转 / 临时签名可能耗时），供轨道面板显示进度
    public private(set) var isSwitchingLine = false
    public private(set) var isPreparing = true

    /// 线路切换的回退快照：新条目加载失败时，用旧线路的进度与播放状态恢复。
    private struct LineRollback {
        let line: PlayLine
        let position: Double
        let wasPlaying: Bool
    }

    private var lineRollback: LineRollback?
    /// 回退只尝试一次，避免旧线路同样失效时来回重试
    private var rollbackAttempted = false
    /// 线路操作序号：切换与回退共用一把锁，只有最新一次操作能解锁并写回结果。
    /// 条目失败回调是异步到达的，可能在切换的 await 期间就触发，
    /// 没有序号则两者会互相覆盖 isSwitchingLine / selectedLineID。
    private var lineOpToken = 0

    // MARK: - 轨道

    public struct TrackSelection: Identifiable {
        public let id: Int
        let name: String
        let group: AVMediaSelectionGroup
        let option: AVMediaSelectionOption
    }

    public private(set) var audioTracks: [TrackSelection] = []
    public private(set) var embeddedSubtitleTracks: [TrackSelection] = []
    public private(set) var selectedAudioTrackID: Int?
    public private(set) var selectedEmbeddedSubtitleID: Int?
    public private(set) var selectedExternalSubtitle: SubtitleTrackInfo?

    // MARK: - UI 状态

    public var activeSheet: ControlSheet?
    public var isDanmakuInputPresented = false
    /// 手势 HUD（快进 / 亮度 / 音量）
    public var hudText: String?
    public var hudIcon: String = "arrow.right"
    public private(set) var nextCountdownSeconds: Int?

    // MARK: - 手势状态

    private enum PanMode {
        case none, seek, brightness, volume
    }

    private var panMode: PanMode = .none
    private var pendingSeekDelta: Double = 0
    private var brightnessAtPanStart: CGFloat = 0
    private var lastHapticAt: TimeInterval = 0

    // MARK: - 任务

    private var progressSaveTask: Task<Void, Never>?
    private var countdownTask: Task<Void, Never>?

    private let volumeController = VolumeController()

    // MARK: - Init

    public init(environment: AppEnvironment, request: PlaybackRequest) {
        self.environment = environment
        self.request = request
        self.manager = environment.player
        self.manager.preferredRate = Float(environment.playbackSettings.defaultRate)
        danmaku.settings.userId = environment.identity.userId

        // ==================== 弹幕时间轴绑定 ====================
        // 直接用 AVPlayer 的当前时间：manager.currentTime 每 0.5s 才刷新一次，
        // 喂给 60fps 的渲染循环会产生可见的跳格。
        // 弱引用 player，避免渲染器（被 ViewModel 持有）反过来钉住播放器。
        let player = environment.player.player
        renderer.timeProvider = { [weak player] in
            let seconds = player?.currentTime().seconds ?? 0
            return seconds.isFinite ? seconds : 0
        }
    }

    // MARK: - 准备 / 切集

    public func prepare() async {
        isPreparing = true
        loadError = nil
        lineSwitchError = nil
        // 换集 / 重试必须作废所有在途的线路操作：回退任务若在新一集加载完成之后
        // 才返回，会把上一集的线路地址装回播放器（序号校验是唯一防线）
        lineOpToken += 1
        isSwitchingLine = false
        // 换集后旧的线路快照必须作废：否则新一集加载失败时会退回上一集的线路
        lineRollback = nil
        rollbackAttempted = false

        // 同一集已经在播（例如从 MiniPlayer 重开播放页）：跳过重新加载
        let previousRequest = manager.activeRequest
        let sameEpisodePlaying = previousRequest?.episode.id == request.episode.id
            && manager.player.currentItem != nil
            && manager.state != .idle
        manager.activeRequest = request

        do {
            let info: PlayInfo
            if let cached = playInfo, cached.episodeId == request.episode.id {
                info = cached
            } else {
                info = try await environment.mediaProvider.playInfo(episodeId: request.episode.id)
                playInfo = info
            }
            // 该集没有上次选中的线路时退回第一条
            if let id = selectedLineID, !info.lines.contains(where: { $0.id == id }) {
                selectedLineID = nil
            }

            // 字幕：默认第一条外挂
            subtitles.clear()
            selectedExternalSubtitle = nil
            if let external = info.externalSubtitles.first, let url = external.url {
                selectedExternalSubtitle = external
                await subtitles.loadExternal(url: url)
            }

            manager.onPlaybackEnded = { [weak self] in
                self?.handlePlaybackEnded()
            }
            // 回调必须在 load 之前注入：首条目也可能加载失败
            bindItemCallbacks()

            // 弹幕锚点：只有换了新条目才需要显式指定（此时 seek 尚未生效，
            // 实时时间还停在旧值）。重开播放页沿用实时时间，避免把
            // 载入弹幕这几百毫秒里已经播过的弹幕一次性补放出来。
            var danmakuAnchor: Double?
            if !sameEpisodePlaying {
                let resume = request.startPosition
                    ?? environment.history.resumePosition(
                        mediaId: request.media.id,
                        episodeId: request.episode.id
                    )
                guard let line = selectedLine else {
                    throw AppError.provider("该集没有可用播放线路")
                }
                let resolved = try await resolve(line: line)
                apply(resolved, startPosition: resume, autoplay: true)
                selectedLineID = line.id
                // 没有续播点时起点就是 0，必须显式给出：条目替换后实时时间可能
                // 仍停在上一集的位置，按它索引会让本集弹幕整集不出现。
                danmakuAnchor = resume ?? 0
            }

            await loadTrackOptions()

            // 弹幕（切集后旧弹幕已清空，这里重新载入）
            let duration = max(request.episode.duration, manager.duration)
            await danmaku.load(
                mediaId: request.media.id,
                episodeId: request.episode.id,
                duration: duration,
                // 仅演示源生成种子弹幕，真实内容源不写入假数据
                allowSeeding: environment.mediaProvider.info.kind == .mock
            )
            // 刚替换完条目时 player.currentTime() 尚未反映新位置（seek 未生效），
            // 读实时时间会把弹幕倒退到开头，因此换条目时必须传入续播点。
            applyDanmakuRendering(at: danmakuAnchor)

            startProgressSaving()
            isPreparing = false
        } catch {
            loadError = AppError.from(error)
            isPreparing = false
        }
    }

    // MARK: - 线路

    /// 当前生效的线路：优先用户选择，其次第一条。
    public var selectedLine: PlayLine? {
        guard let lines = playInfo?.lines, !lines.isEmpty else { return nil }
        return lines.first { $0.id == selectedLineID } ?? lines.first
    }

    /// 解析线路地址（播放器不感知来源）。
    private func resolve(line: PlayLine) async throws -> ResolvedPlayback {
        try await environment.mediaProvider.resolvePlayback(
            line: line,
            episodeId: request.episode.id
        )
    }

    /// 把解析结果交给播放器。
    /// 与 `resolve` 分开是刻意的：条目替换必须在序号校验之后同步发生，
    /// 否则两个并发操作（切换 / 回退）会按解析完成的先后互相覆盖底层内容。
    private func apply(_ resolved: ResolvedPlayback, startPosition: Double?, autoplay: Bool) {
        manager.load(url: resolved.url, startPosition: startPosition, autoplay: autoplay)
    }

    /// 播放会话是否仍然有效。
    /// `resolvePlayback` 可能耗时数秒，期间用户可能已经在 MiniPlayer 关闭播放
    /// （`PlayerManager.stop()` 会清空 activeRequest）：此时任何迟到的解析结果
    /// 都必须丢弃，否则会凭空拉起一个没有播放上下文的后台音频。
    private var isSessionActive: Bool {
        manager.activeRequest?.episode.id == request.episode.id
    }

    /// 切换线路（保持当前播放进度与播放/暂停状态）。
    public func selectLine(_ line: PlayLine) async {
        guard line.id != selectedLine?.id, !isSwitchingLine else { return }
        // load 会把 currentTime 归零，进度必须在切换前取。
        // 用 AVPlayer 的实时时间：manager.currentTime 每 0.5s 才刷新一次。
        let resume = livePlaybackTime
        let wasPlaying = manager.state == .playing || manager.state == .preparing
        let previousLine = selectedLine
        // 解析可能耗时（远端二次跳转 / 临时签名）；面板通常盖在播放页上，
        // 全屏 isPreparing 会被挡住，因此在面板内就地显示进度
        let token = beginLineOp()
        lineSwitchError = nil
        defer { endLineOp(token) }
        do {
            // 解析成功才切换状态：解析失败时旧线路仍在播，选中项不能先行漂移
            let resolved = try await resolve(line: line)
            // 解析期间可能有回退操作抢先完成（回退会递增序号），
            // 也可能用户已经退出播放（activeRequest 被清空）：
            // 两种情况本次切换都已作废，既不能替换底层条目，也不能写回选中项
            guard token == lineOpToken, isSessionActive else { return }
            // 回退快照必须在替换条目的同一刻建立：解析期间旧条目的就绪回调
            // 可能迟到，提前建立会被它误清，导致新条目失败时无线路可退
            lineRollback = previousLine.map {
                LineRollback(line: $0, position: resume, wasPlaying: wasPlaying)
            }
            rollbackAttempted = false
            apply(resolved, startPosition: resume, autoplay: wasPlaying)
            selectedLineID = line.id
            // 紧跟在条目替换之后对齐弹幕：中间插入 await 会让旧索引与新播放头
            // 短暂错配，出现半秒的堆积或空窗
            renderer.skip(to: resume)
            // 新 AVPlayerItem 不继承内嵌轨道选择；外挂字幕与线路无关，保持不变
            selectedEmbeddedSubtitleID = nil
            await loadTrackOptions()
            guard token == lineOpToken else { return }
            loadError = nil
        } catch {
            // 解析阶段就失败：底层内容未被替换，旧线路继续播，快照作废
            lineRollback = nil
            // 旧线路仍在正常播放，只影响这一次切换：就地提示，不弹全屏错误
            lineSwitchError = "线路切换失败，已保持原线路"
        }
    }

    /// AVPlayer 的实时进度（秒），过滤 NaN / 无限值。
    private var livePlaybackTime: Double {
        let seconds = manager.player.currentTime().seconds
        return seconds.isFinite ? max(0, seconds) : manager.currentTime
    }

    // MARK: - 线路回退

    /// 开启一次线路操作（切换 / 回退），返回本次操作的序号。
    /// 只有序号仍是最新的操作才有资格解锁，避免迟到的旧操作提前放开互斥。
    private func beginLineOp() -> Int {
        lineOpToken += 1
        isSwitchingLine = true
        return lineOpToken
    }

    private func endLineOp(_ token: Int) {
        guard token == lineOpToken else { return }
        isSwitchingLine = false
    }

    /// 注入条目状态回调：就绪即确认切换成功，失败则退回旧线路。
    private func bindItemCallbacks() {
        manager.onItemReady = { [weak self] in
            guard let self else { return }
            self.lineRollback = nil
            self.rollbackAttempted = false
        }
        manager.onItemFailed = { [weak self] _ in
            guard let self else { return }
            self.handleItemFailed()
        }
    }

    /// 地址解析成功但条目加载失败（地址失效 / 格式不支持 / 网络中断）：
    /// 底层内容已被替换，必须用旧线路恢复，不能只保住 selectedLineID。
    private func handleItemFailed() {
        guard let rollback = lineRollback, !rollbackAttempted else {
            // 没有可回退的线路（首次加载失败），交给全屏错误态
            lineRollback = nil
            loadError = AppError.provider("视频加载失败，请重试")
            return
        }
        rollbackAttempted = true
        lineRollback = nil
        // 选中项必须跟着内容一起退回去，否则 UI 显示新线路、实际播的是旧线路
        selectedLineID = rollback.line.id
        lineSwitchError = "线路切换失败，已恢复原线路"
        // 恢复过程同样占用切换锁：否则用户此刻再点线路会与回退加载相互覆盖
        let token = beginLineOp()
        Task { [weak self] in
            guard let self else { return }
            defer { self.endLineOp(token) }
            do {
                let resolved = try await self.resolve(line: rollback.line)
                // 与 selectLine 同一条规则：解析期间会话可能已关闭（MiniPlayer 退出），
                // 此时恢复旧线路会把条目重新装回已停止的播放器，凭空拉起后台音频
                guard token == self.lineOpToken, self.isSessionActive else { return }
                self.apply(
                    resolved,
                    startPosition: rollback.position,
                    autoplay: rollback.wasPlaying
                )
                self.renderer.skip(to: rollback.position)
            } catch {
                self.loadError = AppError.from(error)
            }
        }
    }

    /// 切换到指定集（复用同一播放列表）。
    public func play(episode: Episode) async {
        guard episode.id != request.episode.id else { return }
        cancelCountdown()
        saveProgressNow()
        renderer.clear()
        danmaku.clear()
        subtitles.clear()
        selectedExternalSubtitle = nil
        selectedEmbeddedSubtitleID = nil
        request = PlaybackRequest(
            media: request.media,
            episode: episode,
            playlist: request.playlist,
            startPosition: nil
        )
        await prepare()
    }

    public func playNext() async {
        guard let next = request.nextEpisode else { return }
        await play(episode: next)
    }

    public func playPrevious() async {
        guard let previous = request.previousEpisode else { return }
        await play(episode: previous)
    }

    /// 完全退出播放（MiniPlayer 关闭按钮）。
    public func stopPlayback() {
        cancelCountdown()
        progressSaveTask?.cancel()
        saveProgressNow()
        renderer.clear()
        danmaku.clear()
        manager.stop()
    }

    // MARK: - 播完 / 自动连播

    private func handlePlaybackEnded() {
        saveProgressNow()
        guard let next = request.nextEpisode,
              environment.playbackSettings.autoPlayNext else {
            return
        }
        showNextCountdown(for: next)
    }

    private func showNextCountdown(for episode: Episode) {
        nextCountdownSeconds = 5
        countdownTask?.cancel()
        countdownTask = Task { [weak self] in
            var remaining = 5
            while remaining > 0 {
                try? await Task.sleep(nanoseconds: 1_000_000_000)
                guard let self, !Task.isCancelled else { return }
                remaining -= 1
                self.nextCountdownSeconds = remaining > 0 ? remaining : nil
                if remaining == 0 {
                    await self.play(episode: episode)
                }
            }
        }
    }

    public func cancelCountdown() {
        countdownTask?.cancel()
        countdownTask = nil
        nextCountdownSeconds = nil
    }

    public func skipCountdownAndPlayNow() {
        guard let next = request.nextEpisode else { return }
        cancelCountdown()
        Task { await play(episode: next) }
    }

    // MARK: - 手势

    public func panBegan() {
        panMode = .none
        pendingSeekDelta = 0
        brightnessAtPanStart = UIScreen.main.brightness
    }

    public func panChanged(translation: CGPoint, side: PanScreenSide) {
        if panMode == .none {
            panMode = translation.x != 0
                ? .seek
                : (side == .left ? .brightness : .volume)
        }
        switch panMode {
        case .seek:
            // 每 60pt ≈ 5 秒
            pendingSeekDelta = Double(translation.x / 60) * 5
            let forward = pendingSeekDelta >= 0
            hudIcon = forward ? "goforward.10" : "gobackward.10"
            hudText = "\(forward ? "快进" : "快退") \(abs(Int(pendingSeekDelta.rounded())))s"
            triggerSeekHaptic()
        case .brightness:
            let value = brightnessAtPanStart - translation.y / 400
            UIScreen.main.brightness = min(1, max(0, value))
            hudIcon = "sun.max"
            hudText = "亮度 \(Int(UIScreen.main.brightness * 100))%"
        case .volume:
            volumeController.adjust(by: Float(-translation.y / 500))
            hudIcon = "speaker.wave.2"
            hudText = "音量"
        case .none:
            break
        }
    }

    public func panEnded() {
        defer {
            panMode = .none
            hudText = nil
            pendingSeekDelta = 0
        }
        guard panMode == .seek else { return }
        skip(by: pendingSeekDelta)
    }

    // MARK: - 进度跳转

    /// 统一的 seek 入口：播放器与弹幕必须同步移动。
    /// 渲染器按绝对时间索引待显弹幕，只改播放器会让索引停在旧位置：
    /// 后退会丢弹幕，前进会把中间弹幕一次性倾倒出来。
    public func seek(to seconds: Double) {
        manager.seek(to: seconds)
        // manager.seek 已把钳制后的值写回 currentTime，直接复用
        renderer.skip(to: manager.currentTime)
    }

    public func skip(by delta: Double) {
        // 基准取实时时间：manager.currentTime 每 0.5s 才刷新，
        // 连续点击快进会累积误差
        seek(to: livePlaybackTime + delta)
    }

    private func triggerSeekHaptic() {
        let now = Date().timeIntervalSince1970
        guard now - lastHapticAt > 0.15 else { return }
        lastHapticAt = now
        Haptics.selection()
    }

    // MARK: - 倍速

    public var rateOptions: [Float] {
        [0.5, 0.75, 1.0, 1.25, 1.5, 2.0]
    }

    public func setRate(_ rate: Float) {
        manager.setRate(rate)
        if environment.playbackSettings.rememberRate {
            environment.playbackSettings.defaultRate = Double(rate)
        }
    }

    // MARK: - 进度

    public func saveProgressNow() {
        guard manager.duration > 0, manager.activeRequest != nil else { return }
        environment.history.save(
            media: request.media,
            episode: request.episode,
            position: manager.currentTime,
            duration: manager.duration
        )
    }

    private func startProgressSaving() {
        progressSaveTask?.cancel()
        progressSaveTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 5_000_000_000)
                guard let self, !Task.isCancelled else { return }
                self.saveProgressNow()
            }
        }
    }

    // MARK: - 轨道

    public func loadTrackOptions() async {
        guard let item = manager.player.currentItem else { return }
        do {
            var audio: [TrackSelection] = []
            var id = 0
            if let group = try await item.asset.loadMediaSelectionGroup(for: .audible) {
                for option in group.options {
                    audio.append(TrackSelection(id: id, name: option.displayName, group: group, option: option))
                    id += 1
                }
            }
            audioTracks = audio
            selectedAudioTrackID = audio.first?.id

            var subtitleOptions: [TrackSelection] = []
            id = 1000
            if let group = try await item.asset.loadMediaSelectionGroup(for: .legible) {
                for option in group.options {
                    subtitleOptions.append(TrackSelection(id: id, name: option.displayName, group: group, option: option))
                    id += 1
                }
            }
            embeddedSubtitleTracks = subtitleOptions
        } catch {
            audioTracks = []
            embeddedSubtitleTracks = []
        }
    }

    public func selectAudioTrack(_ track: TrackSelection?) {
        guard let item = manager.player.currentItem else { return }
        if let track {
            item.select(track.option, in: track.group)
            selectedAudioTrackID = track.id
        } else if let current = audioTracks.first(where: { $0.id == selectedAudioTrackID }) {
            item.select(nil, in: current.group)
            selectedAudioTrackID = nil
        }
    }

    /// 选择内嵌字幕（同时关闭外挂渲染，避免重叠）。
    public func selectEmbeddedSubtitle(_ track: TrackSelection?) {
        guard let item = manager.player.currentItem else { return }
        if let track {
            item.select(track.option, in: track.group)
            selectedEmbeddedSubtitleID = track.id
            selectedExternalSubtitle = nil
            subtitles.clear()
        } else {
            if let first = embeddedSubtitleTracks.first {
                item.select(nil, in: first.group)
            }
            selectedEmbeddedSubtitleID = nil
        }
    }

    /// 选择外挂字幕文件。
    public func selectExternalSubtitle(_ info: SubtitleTrackInfo) async {
        if let first = embeddedSubtitleTracks.first {
            manager.player.currentItem?.select(nil, in: first.group)
            selectedEmbeddedSubtitleID = nil
        }
        selectedExternalSubtitle = info
        if let url = info.url {
            await subtitles.loadExternal(url: url)
        }
    }

    public func disableSubtitles() {
        selectEmbeddedSubtitle(nil)
        selectedExternalSubtitle = nil
        subtitles.clear()
    }

    // MARK: - 弹幕

    /// 把（过滤后的）弹幕喂给渲染器。
    /// - Parameter anchor: 载入时的播放位置；nil 表示取播放器实时时间（设置变更时的刷新）。
    ///   刚 load 完条目时 AVPlayer 尚未完成 seek，实时时间仍是旧值，
    ///   必须由调用方传入续播点，否则弹幕会从错误的位置开始索引。
    public func applyDanmakuRendering(at anchor: Double? = nil) {
        renderer.load(
            items: danmaku.filteredItems(),
            snapshot: danmaku.settings.snapshot,
            at: anchor
        )
    }

    /// 设置变化时刷新（PlayerView 的 onChange 触发）。
    public var danmakuSettingsSignature: String {
        let settings = danmaku.settings
        return [
            settings.isEnabled.description,
            settings.areaRatio.description,
            settings.opacity.description,
            settings.fontScale.description,
            settings.speedFactor.description,
            settings.blockScroll.description,
            settings.blockTop.description,
            settings.blockBottom.description,
            settings.showMine.description,
            settings.blockKeywords.joined(separator: ","),
        ].joined(separator: "|")
    }

    /// 发送弹幕（time = 当前播放进度）。
    public func sendDanmaku(content: String, type: DanmakuType, colorHex: String) async throws {
        let item = try await danmaku.send(
            content: content,
            type: type,
            colorHex: colorHex,
            mediaId: request.media.id,
            episodeId: request.episode.id,
            // 打点必须用实时时间：manager.currentTime 有 0.5s 延迟，
            // 会让刚发出的弹幕晚半秒才出现
            time: livePlaybackTime
        )
        // 只追加密发的这一条；全量 reload 会清空屏幕上正在飘的弹幕
        if danmaku.filteredItems().contains(where: { $0.id == item.id }) {
            renderer.enqueue(item)
        }
    }

    // MARK: - 字幕同步

    public func syncSubtitleIfNeeded() {
        subtitles.sync(time: manager.currentTime)
    }
}

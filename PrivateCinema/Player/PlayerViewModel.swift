import AVFoundation
import Foundation
import UIKit

/// 播放器编排层：连接 Provider / 进度服务 / 弹幕 / 字幕 与 PlayerManager。
/// View 只与本 ViewModel 交互；ViewModel 不直接写数据库（经服务层）。
@MainActor
@Observable
final class PlayerViewModel {

    enum ControlSheet: Hashable {
        case danmakuSettings
        case subtitleSettings
        case trackPicker
    }

    // MARK: - 依赖

    let environment: AppEnvironment
    private let manager: PlayerManager
    var danmaku: DanmakuManager { environment.danmaku }
    let subtitles = SubtitleManager()
    /// 弹幕渲染视图（由 PlayerView 挂载为覆盖层）
    let renderer = DanmakuRendererView()

    // MARK: - 播放上下文

    private(set) var request: PlaybackRequest
    private(set) var playInfo: PlayInfo?
    private(set) var loadError: AppError?
    private(set) var isPreparing = true

    // MARK: - 轨道

    struct TrackSelection: Identifiable {
        let id: Int
        let name: String
        let group: AVMediaSelectionGroup
        let option: AVMediaSelectionOption
    }

    private(set) var audioTracks: [TrackSelection] = []
    private(set) var embeddedSubtitleTracks: [TrackSelection] = []
    private(set) var selectedAudioTrackID: Int?
    private(set) var selectedEmbeddedSubtitleID: Int?
    private(set) var selectedExternalSubtitle: SubtitleTrackInfo?

    // MARK: - UI 状态

    var activeSheet: ControlSheet?
    var isDanmakuInputPresented = false
    /// 手势 HUD（快进 / 亮度 / 音量）
    var hudText: String?
    var hudIcon: String = "arrow.right"
    private(set) var nextCountdownSeconds: Int?

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

    init(environment: AppEnvironment, request: PlaybackRequest) {
        self.environment = environment
        self.request = request
        self.manager = environment.player
        self.manager.preferredRate = Float(environment.playbackSettings.defaultRate)
        danmaku.settings.userId = environment.identity.userId
    }

    // MARK: - 准备 / 切集

    func prepare() async {
        isPreparing = true
        loadError = nil

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

            // 字幕：默认第一条外挂
            subtitles.clear()
            selectedExternalSubtitle = nil
            if let external = info.externalSubtitles.first, let url = external.url {
                selectedExternalSubtitle = external
                await subtitles.loadExternal(url: url)
            }

            if !sameEpisodePlaying {
                let resume = request.startPosition
                    ?? environment.history.resumePosition(
                        mediaId: request.media.id,
                        episodeId: request.episode.id
                    )
                manager.load(url: info.url, startPosition: resume, autoplay: true)
            }
            manager.onPlaybackEnded = { [weak self] in
                self?.handlePlaybackEnded()
            }

            await loadTrackOptions()

            // 弹幕（切集后旧弹幕已清空，这里重新载入）
            let duration = max(request.episode.duration, manager.duration)
            await danmaku.load(
                mediaId: request.media.id,
                episodeId: request.episode.id,
                duration: duration
            )
            applyDanmakuRendering()

            startProgressSaving()
            isPreparing = false
        } catch {
            loadError = AppError.from(error)
            isPreparing = false
        }
    }

    /// 切换到指定集（复用同一播放列表）。
    func play(episode: Episode) async {
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

    func playNext() async {
        guard let next = request.nextEpisode else { return }
        await play(episode: next)
    }

    func playPrevious() async {
        guard let previous = request.previousEpisode else { return }
        await play(episode: previous)
    }

    /// 完全退出播放（MiniPlayer 关闭按钮）。
    func stopPlayback() {
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
            }
            await self.play(episode: episode)
        }
    }

    func cancelCountdown() {
        countdownTask?.cancel()
        countdownTask = nil
        nextCountdownSeconds = nil
    }

    func skipCountdownAndPlayNow() {
        guard let next = request.nextEpisode else { return }
        cancelCountdown()
        Task { await play(episode: next) }
    }

    // MARK: - 手势

    func panBegan() {
        panMode = .none
        pendingSeekDelta = 0
        brightnessAtPanStart = UIScreen.main.brightness
    }

    func panChanged(translation: CGPoint, side: PanScreenSide) {
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

    func panEnded() {
        defer {
            panMode = .none
            hudText = nil
            pendingSeekDelta = 0
        }
        guard panMode == .seek else { return }
        let target = manager.currentTime + pendingSeekDelta
        manager.skip(pendingSeekDelta)
        // seek 后弹幕同步：清掉已播过区间，避免堆积爆发
        renderer.skip(to: target)
    }

    private func triggerSeekHaptic() {
        let now = Date().timeIntervalSince1970
        guard now - lastHapticAt > 0.15 else { return }
        lastHapticAt = now
        Haptics.selection()
    }

    // MARK: - 倍速

    var rateOptions: [Float] {
        [0.5, 0.75, 1.0, 1.25, 1.5, 2.0]
    }

    func setRate(_ rate: Float) {
        manager.setRate(rate)
        if environment.playbackSettings.rememberRate {
            environment.playbackSettings.defaultRate = Double(rate)
        }
    }

    // MARK: - 进度

    func saveProgressNow() {
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

    func loadTrackOptions() async {
        guard let item = manager.player.currentItem else { return }
        do {
            let audioGroups = try await item.asset.loadMediaSelectionGroups(for: .audible)
            var audio: [TrackSelection] = []
            var id = 0
            for group in audioGroups {
                for option in group.options {
                    audio.append(TrackSelection(id: id, name: option.displayName, group: group, option: option))
                    id += 1
                }
            }
            audioTracks = audio
            selectedAudioTrackID = audio.first?.id

            let subtitleGroups = try await item.asset.loadMediaSelectionGroups(for: .legible)
            var subtitleOptions: [TrackSelection] = []
            id = 1000
            for group in subtitleGroups {
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

    func selectAudioTrack(_ track: TrackSelection?) {
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
    func selectEmbeddedSubtitle(_ track: TrackSelection?) {
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
    func selectExternalSubtitle(_ info: SubtitleTrackInfo) async {
        if let first = embeddedSubtitleTracks.first {
            manager.player.currentItem?.select(nil, in: first.group)
            selectedEmbeddedSubtitleID = nil
        }
        selectedExternalSubtitle = info
        if let url = info.url {
            await subtitles.loadExternal(url: url)
        }
    }

    func disableSubtitles() {
        selectEmbeddedSubtitle(nil)
        selectedExternalSubtitle = nil
        subtitles.clear()
    }

    // MARK: - 弹幕

    /// 把（过滤后的）弹幕喂给渲染器。
    func applyDanmakuRendering() {
        renderer.load(items: danmaku.filteredItems(), snapshot: danmaku.settings.snapshot)
    }

    /// 设置变化时刷新（PlayerView 的 onChange 触发）。
    var danmakuSettingsSignature: String {
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
    func sendDanmaku(content: String, type: DanmakuType, colorHex: String) async throws {
        let item = try await danmaku.send(
            content: content,
            type: type,
            colorHex: colorHex,
            mediaId: request.media.id,
            episodeId: request.episode.id,
            time: max(0, manager.currentTime)
        )
        applyDanmakuRendering()
        renderer.enqueue(item)
    }

    // MARK: - 字幕同步

    func syncSubtitleIfNeeded() {
        subtitles.sync(time: manager.currentTime)
    }
}

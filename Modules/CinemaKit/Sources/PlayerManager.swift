import AVFoundation
import AVKit
import Combine
import Foundation
import UIKit

/// 播放器核心：持有 AVPlayer，负责状态、进度观测、倍速、PiP、AirPlay 支持。
/// 不接触 Provider / 数据库，下一集逻辑由 PlayerViewModel 通过回调注入。
@MainActor
@Observable
public final class PlayerManager: NSObject {

    public enum PlaybackState: Equatable {
        case idle
        case preparing
        case playing
        case paused
        case ended
    }

    // MARK: - 状态

    public let player = AVPlayer()

    public private(set) var state: PlaybackState = .idle
    /// 当前播放条目（MiniPlayer 数据源；由 PlayerViewModel 在 prepare 时写入）
    public var activeRequest: PlaybackRequest?
    /// 全屏播放页的呈现绑定（MiniPlayer 点按后重新打开）
    public var fullscreenRequest: PlaybackRequest?

    public private(set) var currentTime: Double = 0
    public private(set) var duration: Double = 0
    public private(set) var bufferedSeconds: Double = 0
    public private(set) var isBuffering = false

    public var preferredRate: Float = 1.0
    public private(set) var isHoldBoosting = false

    public private(set) var isPictureInPicturePossible = false
    public private(set) var isPictureInPictureActive = false

    /// 单集播完回调（由 ViewModel 注入自动连播逻辑）。
    public var onPlaybackEnded: (() -> Void)?
    /// 当前条目加载失败回调（由 ViewModel 注入线路回退逻辑）。
    public var onItemFailed: ((Error?) -> Void)?
    /// 当前条目就绪回调（由 ViewModel 用于确认线路切换成功）。
    public var onItemReady: (() -> Void)?

    // MARK: - 私有

    private var playerLayer: AVPlayerLayer?
    private var pipController: AVPictureInPictureController?
    private var pipCancellable: AnyCancellable?
    /// 视图已卸载但画中画仍在播：延后到 PiP 停止再释放控制器
    private var pendingPipRelease = false
    private var statusCancellable: AnyCancellable?
    /// 当前条目的加载状态（.failed 时上报，供线路回退使用）
    private var itemStatusCancellable: AnyCancellable?
    private var endCancellable: AnyCancellable?
    private var durationLoadTask: Task<Void, Never>?
    /// 时间观测 token：注册后不移除（观测回调仅持弱引用，无保留环，
    /// player 随本对象释放时由系统一并拆除其观测器）。
    nonisolated(unsafe) private var timeObserver: Any?
    private let volumeController = VolumeController()

    // MARK: - 初始化

    public override init() {
        super.init()
        configureAudioSession()
        player.allowsExternalPlayback = true
        player.usesExternalPlaybackWhileExternalScreenIsActive = true
        addTimeObserver()
        observeTimeControlStatus()
    }

    // 不写 deinit：deinit 在非隔离上下文不能触碰 MainActor 隔离的 player；
    // 观测回调仅持弱引用，player 随本对象释放时由系统拆除其观测器，无泄漏。

    private func configureAudioSession() {
        do {
            try AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback)
            try? AVAudioSession.sharedInstance().setActive(true)
        } catch {
            // 静默失败：无声卡场景下不阻断播放
        }
    }

    // MARK: - 加载

    public func load(url: URL, startPosition: Double?, autoplay: Bool) {
        endCancellable = nil
        itemStatusCancellable = nil
        durationLoadTask?.cancel()

        let item = AVPlayerItem(url: url)
        currentTime = 0
        duration = 0
        bufferedSeconds = 0
        isBuffering = true
        state = .preparing

        player.replaceCurrentItem(with: item)

        endCancellable = NotificationCenter.default
            .publisher(for: AVPlayerItem.didPlayToEndTimeNotification, object: item)
            .sink { [weak self] _ in
                Task { @MainActor [weak self] in
                    self?.handleItemEnded()
                }
            }

        // 条目加载状态必须上报：线路切换时旧内容已被替换，
        // 只有上层知道该退回哪条线路、什么时候可以确认切换成功。
        // 身份校验放在 MainActor 内做：旧条目的迟到回调不得影响当前播放。
        itemStatusCancellable = item.publisher(for: \.status)
            .sink { [weak self, weak item] status in
                guard status == .readyToPlay || status == .failed else { return }
                Task { @MainActor [weak self, weak item] in
                    guard let self, let item, self.player.currentItem === item else { return }
                    switch status {
                    case .readyToPlay:
                        self.onItemReady?()
                    case .failed:
                        self.handleItemFailed(item.error)
                    default:
                        break
                    }
                }
            }

        durationLoadTask = Task { @MainActor [weak self] in
            if let time = try? await item.asset.load(.duration) {
                self?.duration = time.seconds.isFinite ? time.seconds : 0
            }
        }

        // 起点必须精确生效：调用方（ViewModel）用同一个值对齐弹幕与字幕时间轴，
        // 若这里对小幅起点悄悄改成从 0 播，画外音轨与画面会错位几秒。
        // seek 在条目未就绪时由 AVPlayer 排队，就绪后自动执行。
        if let startPosition, startPosition > 0 {
            seek(to: startPosition)
        }
        if autoplay {
            play()
        } else {
            // 不自动播放时 timeControlStatus 停在 .paused，
            // 而 observeTimeControlStatus 只从 .playing 回落 .paused，
            // 不显式收口会让 state 永远卡在 .preparing（首次点播放变成暂停）。
            state = .paused
            isBuffering = false
        }
    }

    public func stop() {
        pause()
        player.replaceCurrentItem(with: nil)
        activeRequest = nil
        fullscreenRequest = nil
        state = .idle
        currentTime = 0
        duration = 0
        bufferedSeconds = 0
        onPlaybackEnded = nil
        onItemFailed = nil
        onItemReady = nil
    }

    // MARK: - 基础控制

    public func play() {
        guard player.currentItem != nil else { return }
        player.play()
        player.rate = preferredRate
    }

    public func pause() {
        player.pause()
    }

    public func togglePlayPause() {
        switch state {
        case .playing, .preparing:
            pause()
        case .paused, .ended:
            if state == .ended, currentTime >= duration - 1, duration > 0 {
                seek(to: 0)
            }
            play()
        case .idle:
            break
        }
    }

    public func seek(to seconds: Double) {
        let clamped = duration > 0 ? min(max(0, seconds), duration) : max(0, seconds)
        currentTime = clamped
        let target = CMTime(seconds: clamped, preferredTimescale: 600)
        player.seek(
            to: target,
            toleranceBefore: .zero,
            toleranceAfter: .zero
        )
    }

    public func skip(_ delta: Double) {
        seek(to: currentTime + delta)
    }

    /// 长按倍速冲刺（2x）。
    public func setHoldBoost(_ enabled: Bool) {
        guard enabled != isHoldBoosting else { return }
        isHoldBoosting = enabled
        if enabled {
            player.rate = preferredRate * 2
        } else {
            player.rate = state == .paused ? 0 : preferredRate
        }
    }

    public func setRate(_ rate: Float) {
        preferredRate = rate
        if !isHoldBoosting, state != .paused, state != .idle {
            player.rate = rate
        }
    }

    // MARK: - 观测

    private func addTimeObserver() {
        let interval = CMTime(seconds: 0.5, preferredTimescale: 600)
        timeObserver = player.addPeriodicTimeObserver(forInterval: interval, queue: .main) { [weak self] time in
            Task { @MainActor [weak self] in
                self?.handleTick(time.seconds)
            }
        }
    }

    private func handleTick(_ seconds: Double) {
        guard state != .idle else { return }
        currentTime = seconds
        if let range = player.currentItem?.loadedTimeRanges.first?.timeRangeValue {
            bufferedSeconds = range.start.seconds + range.duration.seconds
        }
    }

    private func observeTimeControlStatus() {
        statusCancellable = player.publisher(for: \.timeControlStatus)
            .sink { [weak self] status in
                Task { @MainActor [weak self] in
                    guard let self else { return }
                    switch status {
                    case .playing:
                        self.isBuffering = false
                        if self.state != .ended { self.state = .playing }
                    case .paused:
                        if self.state == .playing { self.state = .paused }
                    case .waitingToPlayAtSpecifiedRate:
                        self.isBuffering = self.state == .playing || self.state == .preparing
                    @unknown default:
                        break
                    }
                }
            }
    }

    private func handleItemEnded() {
        state = .ended
        currentTime = duration
        onPlaybackEnded?()
    }

    private func handleItemFailed(_ error: Error?) {
        // 旧条目的迟到回调（已被替换）不得影响当前播放
        guard player.currentItem?.status == .failed else { return }
        state = .paused
        isBuffering = false
        onItemFailed?(error)
    }

    // MARK: - 画中画 (PiP)

    /// 由视频承载视图在挂载图层时调用。
    public func attach(playerLayer layer: AVPlayerLayer) {
        if playerLayer === layer, pipController != nil { return }
        playerLayer = layer
        pipCancellable = nil
        let controller = AVPictureInPictureController(playerLayer: layer)
        guard let controller else { return }
        controller.delegate = self
        controller.canStartPictureInPictureAutomaticallyFromInline = true
        pipController = controller
        pipCancellable = controller.publisher(for: \.isPictureInPicturePossible)
            .sink { [weak self] possible in
                Task { @MainActor [weak self] in
                    self?.isPictureInPicturePossible = possible
                }
            }
    }

    public func detachPlayerLayer() {
        playerLayer = nil
        isPictureInPicturePossible = false
        // 画中画仍在播时不能立刻销毁控制器，否则小窗会直接断掉；
        // 等系统回调 didStop 之后再补做释放。
        if isPictureInPictureActive {
            pendingPipRelease = true
            return
        }
        releasePipController()
    }

    private func releasePipController() {
        pipController?.delegate = nil
        pipController = nil
        pipCancellable = nil
        pendingPipRelease = false
    }

    public func togglePictureInPicture() {
        guard let pipController else { return }
        if pipController.isPictureInPictureActive {
            pipController.stopPictureInPicture()
        } else if pipController.isPictureInPicturePossible {
            pipController.startPictureInPicture()
        }
    }
}

// MARK: - AVPictureInPictureControllerDelegate

extension PlayerManager: AVPictureInPictureControllerDelegate {
    public nonisolated func pictureInPictureControllerDidStartPictureInPicture(_ pictureInPictureController: AVPictureInPictureController) {
        Task { @MainActor [weak self] in
            self?.isPictureInPictureActive = true
        }
    }

    public nonisolated func pictureInPictureControllerDidStopPictureInPicture(_ pictureInPictureController: AVPictureInPictureController) {
        Task { @MainActor [weak self] in
            guard let self else { return }
            self.isPictureInPictureActive = false
            // 视图卸载时挂起的释放，等小窗真正关闭后再执行
            if self.pendingPipRelease {
                self.releasePipController()
            }
        }
    }
}

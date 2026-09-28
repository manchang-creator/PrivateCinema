import AVFoundation
import AVKit
import Combine
import Foundation
import UIKit

/// 播放器核心：持有 AVPlayer，负责状态、进度观测、倍速、PiP、AirPlay 支持。
/// 不接触 Provider / 数据库，下一集逻辑由 PlayerViewModel 通过回调注入。
@MainActor
@Observable
final class PlayerManager: NSObject {

    enum PlaybackState: Equatable {
        case idle
        case preparing
        case playing
        case paused
        case ended
    }

    // MARK: - 状态

    let player = AVPlayer()

    private(set) var state: PlaybackState = .idle
    /// 当前播放条目（MiniPlayer 数据源；由 PlayerViewModel 在 prepare 时写入）
    var activeRequest: PlaybackRequest?
    /// 全屏播放页的呈现绑定（MiniPlayer 点按后重新打开）
    var fullscreenRequest: PlaybackRequest?

    private(set) var currentTime: Double = 0
    private(set) var duration: Double = 0
    private(set) var bufferedSeconds: Double = 0
    private(set) var isBuffering = false

    var preferredRate: Float = 1.0
    private(set) var isHoldBoosting = false

    private(set) var isPictureInPicturePossible = false
    private(set) var isPictureInPictureActive = false

    /// 单集播完回调（由 ViewModel 注入自动连播逻辑）。
    var onPlaybackEnded: (() -> Void)?

    // MARK: - 私有

    private var playerLayer: AVPlayerLayer?
    private var pipController: AVPictureInPictureController?
    private var pipCancellable: AnyCancellable?
    private var statusCancellable: AnyCancellable?
    private var endCancellable: AnyCancellable?
    private var durationLoadTask: Task<Void, Never>?
    /// 时间观测 token：init 后只读；deinit 在非隔离上下文读取，故不参与隔离检查。
    nonisolated(unsafe) private var timeObserver: Any?
    private let volumeController = VolumeController()

    // MARK: - 初始化

    override init() {
        super.init()
        configureAudioSession()
        player.allowsExternalPlayback = true
        player.usesExternalPlaybackWhileExternalScreenIsActive = true
        addTimeObserver()
        observeTimeControlStatus()
    }

    deinit {
        if let timeObserver {
            player.removeTimeObserver(timeObserver)
        }
    }

    private func configureAudioSession() {
        do {
            try AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback)
            try? AVAudioSession.sharedInstance().setActive(true)
        } catch {
            // 静默失败：无声卡场景下不阻断播放
        }
    }

    // MARK: - 加载

    func load(url: URL, startPosition: Double?, autoplay: Bool) {
        endCancellable = nil
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

        durationLoadTask = Task { @MainActor [weak self] in
            if let time = try? await item.asset.load(.duration) {
                self?.duration = time.seconds.isFinite ? time.seconds : 0
            }
        }

        if autoplay {
            play()
        }
        if let startPosition, startPosition > 3 {
            seek(to: startPosition)
        }
    }

    func stop() {
        pause()
        player.replaceCurrentItem(with: nil)
        activeRequest = nil
        fullscreenRequest = nil
        state = .idle
        currentTime = 0
        duration = 0
        bufferedSeconds = 0
        onPlaybackEnded = nil
    }

    // MARK: - 基础控制

    func play() {
        guard player.currentItem != nil else { return }
        player.play()
        player.rate = preferredRate
    }

    func pause() {
        player.pause()
    }

    func togglePlayPause() {
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

    func seek(to seconds: Double) {
        let clamped = duration > 0 ? min(max(0, seconds), duration) : max(0, seconds)
        currentTime = clamped
        let target = CMTime(seconds: clamped, preferredTimescale: 600)
        player.seek(
            to: target,
            toleranceBefore: .zero,
            toleranceAfter: .zero
        )
    }

    func skip(_ delta: Double) {
        seek(to: currentTime + delta)
    }

    /// 长按倍速冲刺（2x）。
    func setHoldBoost(_ enabled: Bool) {
        guard enabled != isHoldBoosting else { return }
        isHoldBoosting = enabled
        if enabled {
            player.rate = preferredRate * 2
        } else {
            player.rate = state == .paused ? 0 : preferredRate
        }
    }

    func setRate(_ rate: Float) {
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

    // MARK: - 画中画 (PiP)

    /// 由视频承载视图在挂载图层时调用。
    func attach(playerLayer layer: AVPlayerLayer) {
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

    func detachPlayerLayer() {
        playerLayer = nil
        pipController = nil
        pipCancellable = nil
        isPictureInPicturePossible = false
    }

    func togglePictureInPicture() {
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
    nonisolated func pictureInPictureControllerDidStartPictureInPicture(_ pictureInPictureController: AVPictureInPictureController) {
        Task { @MainActor [weak self] in
            self?.isPictureInPictureActive = true
        }
    }

    nonisolated func pictureInPictureControllerDidStopPictureInPicture(_ pictureInPictureController: AVPictureInPictureController) {
        Task { @MainActor [weak self] in
            self?.isPictureInPictureActive = false
        }
    }
}

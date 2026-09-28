import AVFoundation
import SwiftUI

/// 全屏播放器页面（由 fullScreenCover 呈现）。
struct PlayerHostView: View {
    @Environment(AppEnvironment.self) private var environment
    @Environment(\.dismiss) private var dismiss

    let request: PlaybackRequest

    @State private var viewModel: PlayerViewModel?

    var body: some View {
        Group {
            if let viewModel {
                PlayerView(viewModel: viewModel, dismiss: dismiss)
            } else {
                ZStack {
                    Color.black.ignoresSafeArea()
                    ProgressView()
                        .controlSize(.large)
                        .tint(.white)
                }
            }
        }
        .task {
            if viewModel == nil {
                let vm = PlayerViewModel(environment: environment, request: request)
                viewModel = vm
                await vm.prepare()
            }
        }
    }
}

struct PlayerView: View {
    @Environment(AppEnvironment.self) private var environment

    @Bindable var viewModel: PlayerViewModel
    let dismiss: DismissAction

    private var manager: PlayerManager { environment.player }

    @State private var controlsVisible = true
    @State private var hideTask: Task<Void, Never>?
    @State private var isLandscapeLayout = false

    var body: some View {
        GeometryReader { proxy in
            let landscape = proxy.size.width > proxy.size.height
            ZStack {
                Color.black

                VideoSurfaceView(
                    player: manager.player,
                    onTap: { toggleControls() },
                    onHoldChanged: { manager.setHoldBoost($0) },
                    onPanBegan: { viewModel.panBegan() },
                    onPanChanged: { translation, side in
                        viewModel.panChanged(translation: translation, side: side)
                    },
                    onPanEnded: { viewModel.panEnded() },
                    onAttach: { manager.attach(playerLayer: $0) }
                )

                DanmakuOverlay(renderer: viewModel.renderer)
                SubtitleOverlayView(manager: viewModel.subtitles)

                PlayerControls(
                    viewModel: viewModel,
                    manager: manager,
                    visible: controlsVisible,
                    isLandscape: landscape,
                    onLandscapeToggle: {
                        isLandscapeLayout.toggle()
                        ScreenOrientation.setLandscape(isLandscapeLayout)
                    },
                    onBack: {
                        viewModel.saveProgressNow()
                        dismiss()
                    }
                )

                gestureHUD

                if manager.isBuffering && manager.state == .playing {
                    ProgressView()
                        .controlSize(.large)
                        .tint(.white)
                }

                if viewModel.isPreparing {
                    ZStack {
                        Color.black.opacity(0.6).ignoresSafeArea()
                        VStack(spacing: 12) {
                            ProgressView().controlSize(.large).tint(.white)
                            Text("正在准备播放…")
                                .font(.footnote)
                                .foregroundStyle(.white.opacity(0.7))
                        }
                    }
                }

                if let error = viewModel.loadError {
                    ErrorStateView(error: error) {
                        Task { await viewModel.prepare() }
                    }
                    .environment(\.colorScheme, .dark)
                }

                nextEpisodeOverlay
                danmakuInput
            }
            .onChange(of: landscape) { _, newValue in
                isLandscapeLayout = newValue
            }
        }
        .statusBarHidden(true)
        .onAppear {
            if environment.playbackSettings.autoLandscape {
                isLandscapeLayout = true
                ScreenOrientation.setLandscape(true)
            }
            scheduleAutoHide()
        }
        .onDisappear {
            viewModel.saveProgressNow()
            hideTask?.cancel()
        }
        .onChange(of: manager.currentTime) { _, newValue in
            viewModel.syncSubtitleIfNeeded()
        }
        .onChange(of: viewModel.danmakuSettingsSignature) { _, _ in
            viewModel.applyDanmakuRendering()
        }
        .sheet(item: $viewModel.activeSheet) { sheet in
            switch sheet {
            case .danmakuSettings:
                DanmakuSettingsView(settings: viewModel.danmaku.settings)
            case .subtitleSettings:
                SubtitleSettingsView(manager: viewModel.subtitles)
            case .trackPicker:
                TrackPickerSheet(viewModel: viewModel)
            }
        }
    }

    // MARK: - 子视图

    /// 手势 HUD（快进 / 亮度 / 音量）
    @ViewBuilder
    private var gestureHUD: some View {
        if let hudText = viewModel.hudText {
            VStack {
                Spacer()
                HStack(spacing: 8) {
                    Image(systemName: viewModel.hudIcon)
                    Text(hudText).monospacedDigit()
                }
                .font(.callout.weight(.medium))
                .foregroundStyle(.white)
                .padding(.horizontal, 14)
                .padding(.vertical, 9)
                .background(.ultraThinMaterial, in: Capsule())
            }
            .padding(.bottom, 110)
            .allowsHitTesting(false)
        }
    }

    /// 自动连播倒计时浮层
    @ViewBuilder
    private var nextEpisodeOverlay: some View {
        if viewModel.nextCountdownSeconds != nil {
            NextEpisodeOverlay(
                nextTitle: viewModel.request.nextEpisode?.displayTitle ?? "",
                onPlayNow: { viewModel.skipCountdownAndPlayNow() },
                onCancel: { viewModel.cancelCountdown() }
            )
        }
    }

    /// 底部弹幕输入条
    @ViewBuilder
    private var danmakuInput: some View {
        if viewModel.isDanmakuInputPresented {
            VStack {
                Spacer()
                DanmakuInputView(
                    isPresented: $viewModel.isDanmakuInputPresented,
                    currentTime: manager.currentTime,
                    mediaId: viewModel.request.media.id,
                    episodeId: viewModel.request.episode.id
                ) { item in
                    Task {
                        try? await viewModel.sendDanmaku(
                            content: item.content,
                            type: item.type,
                            colorHex: item.color
                        )
                    }
                }
            }
            .transition(.move(edge: .bottom).combined(with: .opacity))
        }
    }

    // MARK: - 控制层显隐

    private func toggleControls() {
        withAnimation(.easeInOut(duration: 0.2)) {
            controlsVisible.toggle()
        }
        if controlsVisible {
            scheduleAutoHide()
        } else {
            hideTask?.cancel()
        }
    }

    private func scheduleAutoHide() {
        hideTask?.cancel()
        hideTask = Task {
            try? await Task.sleep(nanoseconds: 3_500_000_000)
            guard !Task.isCancelled else { return }
            withAnimation(.easeInOut(duration: 0.25)) {
                controlsVisible = false
            }
        }
    }
}

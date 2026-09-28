import AVFoundation
import SwiftUI

/// 播放器控制层：顶部信息栏 + 中间播放控制 + 底部进度与功能按钮。
/// Apple TV 风格：Material 底、SF Symbols、克制的动效。
struct PlayerControls: View {
    @Bindable var viewModel: PlayerViewModel
    let manager: PlayerManager
    let visible: Bool
    let isLandscape: Bool
    var onLandscapeToggle: () -> Void
    var onBack: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            topBar
            Spacer()
            centerControls
            Spacer()
            bottomControls
        }
        .padding(.horizontal, isLandscape ? 28 : 16)
        .padding(.vertical, 12)
        .opacity(visible ? 1 : 0)
        .allowsHitTesting(visible)
        .animation(.easeInOut(duration: 0.22), value: visible)
        .background(alignment: .top) {
            LinearGradient(
                colors: [.black.opacity(0.55), .clear],
                startPoint: .top, endPoint: .bottom
            )
            .frame(height: 140)
            .opacity(visible ? 1 : 0)
            .ignoresSafeArea(edges: .top)
            .allowsHitTesting(false)
        }
        .background(alignment: .bottom) {
            LinearGradient(
                colors: [.clear, .black.opacity(0.55)],
                startPoint: .top, endPoint: .bottom
            )
            .frame(height: 170)
            .opacity(visible ? 1 : 0)
            .ignoresSafeArea(edges: .bottom)
            .allowsHitTesting(false)
        }
    }

    // MARK: - 顶部

    private var topBar: some View {
        HStack(spacing: 14) {
            Button(action: onBack) {
                Image(systemName: "chevron.down")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: 38, height: 38)
                    .background(.white.opacity(0.14), in: Circle())
            }

            VStack(alignment: .leading, spacing: 2) {
                Text(viewModel.request.media.title)
                    .font(.callout.weight(.semibold))
                    .foregroundStyle(.white)
                    .lineLimit(1)
                Text(viewModel.request.episodeLabel)
                    .font(.caption)
                    .foregroundStyle(.white.opacity(0.65))
                    .lineLimit(1)
            }

            Spacer()

            Menu {
                Button {
                    manager.togglePictureInPicture()
                } label: {
                    Label("画中画", systemImage: "pip.enter")
                }
                .disabled(!manager.isPictureInPicturePossible)

                Button {
                    viewModel.activeSheet = .trackPicker
                } label: {
                    Label("音轨与字幕", systemImage: "waveform")
                }

                Button {
                    onLandscapeToggle()
                } label: {
                    Label(isLandscape ? "竖屏" : "横屏", systemImage: "arrow.up.left.and.arrow.down.right")
                }
            } label: {
                Image(systemName: "ellipsis")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: 38, height: 38)
                    .background(.white.opacity(0.14), in: Circle())
            }
        }
    }

    // MARK: - 中间

    private var centerControls: some View {
        HStack(spacing: 44) {
            controlButton("gobackward.10") {
                manager.skip(-10)
            }
            .disabled(viewModel.request.previousEpisode == nil && manager.currentTime < 10)

            controlButton(
                manager.state == .playing ? "pause.fill" : "play.fill",
                size: 30,
                circle: 72
            ) {
                manager.togglePlayPause()
            }

            controlButton("goforward.10") {
                manager.skip(10)
            }
        }
    }

    // MARK: - 底部

    private var bottomControls: some View {
        VStack(spacing: 10) {
            HStack(spacing: 10) {
                Text(manager.currentTime.clockString)
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.white.opacity(0.8))
                    .frame(minWidth: 44, alignment: .leading)

                PlayerProgressBar(
                    current: manager.currentTime,
                    duration: manager.duration,
                    buffered: manager.bufferedSeconds,
                    heat: viewModel.danmaku.heatBuckets(),
                    onSeek: { manager.seek(to: $0) }
                )
                .frame(maxWidth: .infinity)

                Text(manager.duration.clockString)
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.white.opacity(0.8))
                    .frame(minWidth: 44, alignment: .trailing)
            }

            HStack(spacing: 18) {
                // 弹幕开关
                Button {
                    Haptics.light()
                    viewModel.danmaku.settings.isEnabled.toggle()
                } label: {
                    Image(systemName: viewModel.danmaku.settings.isEnabled
                        ? "list.bullet.rectangle.fill" : "list.bullet.rectangle")
                        .font(.system(size: 15, weight: .medium))
                }
                .buttonStyle(bottomButtonStyle)

                // 发送弹幕
                Button {
                    viewModel.isDanmakuInputPresented = true
                } label: {
                    Image(systemName: "text.bubble")
                        .font(.system(size: 15, weight: .medium))
                }
                .buttonStyle(bottomButtonStyle)

                // 弹幕设置
                Button {
                    viewModel.activeSheet = .danmakuSettings
                } label: {
                    Image(systemName: "slider.horizontal.3")
                        .font(.system(size: 15, weight: .medium))
                }
                .buttonStyle(bottomButtonStyle)

                // 字幕
                Button {
                    viewModel.activeSheet = .subtitleSettings
                } label: {
                    Image(systemName: "captions.bubble")
                        .font(.system(size: 15, weight: .medium))
                }
                .buttonStyle(bottomButtonStyle)

                // 倍速
                Menu {
                    ForEach(viewModel.rateOptions, id: \.self) { rate in
                        Button {
                            viewModel.setRate(rate)
                        } label: {
                            if manager.preferredRate == rate {
                                Label("\(rateText(rate))x", systemImage: "checkmark")
                            } else {
                                Text("\(rateText(rate))x")
                            }
                        }
                    }
                } label: {
                    Text("\(rateText(manager.preferredRate))x")
                        .font(.system(size: 13, weight: .semibold))
                        .monospacedDigit()
                }
                .buttonStyle(bottomButtonStyle)

                Spacer(minLength: 0)

                // PiP
                Button {
                    manager.togglePictureInPicture()
                } label: {
                    Image(systemName: "pip.enter")
                        .font(.system(size: 15, weight: .medium))
                }
                .buttonStyle(bottomButtonStyle)
                .disabled(!manager.isPictureInPicturePossible)

                // AirPlay
                AirPlayButton()
                    .frame(width: 26, height: 26)

                // 全屏 / 方向
                Button {
                    onLandscapeToggle()
                } label: {
                    Image(systemName: isLandscape
                        ? "arrow.down.right.and.arrow.up.left"
                        : "arrow.up.left.and.arrow.down.right")
                        .font(.system(size: 15, weight: .medium))
                }
                .buttonStyle(bottomButtonStyle)
            }
        }
    }

    // MARK: - 组件

    private func controlButton(
        _ icon: String,
        size: CGFloat = 22,
        circle: CGFloat = 52,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: size, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: circle, height: circle)
                .background(.white.opacity(0.14), in: Circle())
        }
    }

    private var bottomButtonStyle: some ButtonStyle {
        BottomIconButtonStyle()
    }

    private func rateText(_ rate: Float) -> String {
        rate.truncatingRemainder(dividingBy: 1) == 0
            ? String(Int(rate))
            : String(rate)
    }
}

/// 底部小圆形按钮样式。
/// 使用 ButtonStyle（而非 PrimitiveButtonStyle）：只有前者提供 isPressed。
struct BottomIconButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .foregroundStyle(.white)
            .frame(width: 40, height: 40)
            .background(.white.opacity(0.14), in: Circle())
            .scaleEffect(configuration.isPressed ? 0.9 : 1)
            .animation(.spring(duration: 0.25), value: configuration.isPressed)
    }
}

/// 音轨 / 字幕选择 Sheet。
struct TrackPickerSheet: View {
    @Bindable var viewModel: PlayerViewModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Section("音轨") {
                    if viewModel.audioTracks.isEmpty {
                        Text("当前视频没有可选音轨")
                            .foregroundStyle(.secondary)
                    }
                    ForEach(viewModel.audioTracks) { track in
                        Button {
                            viewModel.selectAudioTrack(track)
                            Haptics.selection()
                        } label: {
                            HStack {
                                Text(track.name)
                                Spacer()
                                if viewModel.selectedAudioTrackID == track.id {
                                    Image(systemName: "checkmark").foregroundStyle(.tint)
                                }
                            }
                        }
                    }
                }

                Section("内嵌字幕") {
                    Button {
                        viewModel.selectEmbeddedSubtitle(nil)
                        Haptics.selection()
                    } label: {
                        HStack {
                            Text("关闭")
                            Spacer()
                            if viewModel.selectedEmbeddedSubtitleID == nil
                                && viewModel.selectedExternalSubtitle == nil {
                                Image(systemName: "checkmark").foregroundStyle(.tint)
                            }
                        }
                    }
                    ForEach(viewModel.embeddedSubtitleTracks) { track in
                        Button {
                            viewModel.selectEmbeddedSubtitle(track)
                            Haptics.selection()
                        } label: {
                            HStack {
                                Text(track.name)
                                Spacer()
                                if viewModel.selectedEmbeddedSubtitleID == track.id {
                                    Image(systemName: "checkmark").foregroundStyle(.tint)
                                }
                            }
                        }
                    }
                }

                Section("外挂字幕") {
                    ForEach(externalSubtitles, id: \.id) { info in
                        Button {
                            Task { await viewModel.selectExternalSubtitle(info) }
                            Haptics.selection()
                        } label: {
                            HStack {
                                Text(info.name)
                                Spacer()
                                if viewModel.selectedExternalSubtitle?.id == info.id {
                                    Image(systemName: "checkmark").foregroundStyle(.tint)
                                }
                            }
                        }
                    }
                    if externalSubtitles.isEmpty {
                        Text("当前视频没有外挂字幕")
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .navigationTitle("音轨与字幕")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("完成") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private var externalSubtitles: [SubtitleTrackInfo] {
        viewModel.playInfo?.externalSubtitles ?? []
    }
}

import SwiftUI

/// Apple Music 风格 MiniPlayer：用户退出播放页后，
/// 若视频仍在播放，则显示在 TabBar 上方。
struct MiniPlayerBar: View {
    @Environment(AppEnvironment.self) private var environment
    let manager: PlayerManager

    var body: some View {
        if let request = manager.activeRequest {
            HStack(spacing: 12) {
                PosterImage(url: request.media.posterURL, width: 44, height: 44, cornerRadius: 8)

                VStack(alignment: .leading, spacing: 2) {
                    Text(request.media.title)
                        .font(.footnote.weight(.semibold))
                        .lineLimit(1)
                    Text(request.episodeLabel)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }

                Spacer(minLength: 8)

                Button {
                    manager.togglePlayPause()
                    Haptics.light()
                } label: {
                    Image(systemName: manager.state == .playing ? "pause.fill" : "play.fill")
                        .font(.system(size: 16, weight: .semibold))
                        .frame(width: 34, height: 34)
                }

                Button {
                    closePlayback(request: request)
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(.secondary)
                        .frame(width: 30, height: 34)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(.regularMaterial)
                    .shadow(color: .black.opacity(0.18), radius: 12, y: 4)
            )
            .padding(.horizontal, 12)
            .padding(.bottom, 6)
            .contentShape(Rectangle())
            .onTapGesture {
                Haptics.light()
                manager.fullscreenRequest = request
            }
            .transition(.move(edge: .bottom).combined(with: .opacity))
        }
    }

    private func closePlayback(request: PlaybackRequest) {
        // 关闭前保存最后一次进度
        if manager.duration > 0 {
            environment.history.save(
                media: request.media,
                episode: request.episode,
                position: manager.currentTime,
                duration: manager.duration
            )
        }
        Haptics.light()
        manager.stop()
    }
}

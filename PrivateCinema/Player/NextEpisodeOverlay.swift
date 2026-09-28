import SwiftUI

/// 自动连播倒计时浮层：右下角深色毛玻璃卡片。
struct NextEpisodeOverlay: View {
    let nextTitle: String
    var onPlayNow: () -> Void
    var onCancel: () -> Void

    @State private var remainingSeconds = 5
    private let timer = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("下一集将在 \(remainingSeconds) 秒后播放")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.white)
            Text(nextTitle)
                .font(.caption)
                .foregroundStyle(.white.opacity(0.7))
                .lineLimit(1)

            HStack(spacing: 10) {
                Button(action: onPlayNow) {
                    Text("立即播放")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 8)
                        .background(.tint, in: Capsule())
                }
                Button(action: onCancel) {
                    Text("取消")
                        .font(.footnote)
                        .foregroundStyle(.white.opacity(0.85))
                        .padding(.horizontal, 14)
                        .padding(.vertical, 8)
                        .background(.white.opacity(0.16), in: Capsule())
                }
                Spacer()
            }
        }
        .padding(16)
        .frame(maxWidth: 320, alignment: .leading)
        .background {
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(Color.black.opacity(0.62))
                .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        }
        .onReceive(timer) { _ in
            guard remainingSeconds > 0 else { return }
            remainingSeconds -= 1
        }
        .padding(.trailing, 18)
        .padding(.bottom, 130)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)
        .transition(.opacity.combined(with: .scale(scale: 0.95)))
    }
}

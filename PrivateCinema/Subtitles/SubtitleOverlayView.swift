import SwiftUI

/// 外挂字幕覆盖层（自定义渲染，跟随 SubtitleManager 样式设置）。
struct SubtitleOverlayView: View {
    let manager: SubtitleManager

    var body: some View {
        GeometryReader { proxy in
            let size = proxy.size
            VStack {
                Spacer(minLength: 0)
                if let cue = manager.currentCue {
                    Text(cue.text)
                        .font(.system(size: manager.fontSize, weight: .medium))
                        .foregroundStyle(Color(hex: manager.colorHex))
                        .multilineTextAlignment(.center)
                        .lineLimit(3)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                        .background(
                            RoundedRectangle(cornerRadius: 8, style: .continuous)
                                .fill(Color.black.opacity(manager.backgroundOpacity))
                        )
                        .frame(maxWidth: size.width - 32)
                        .position(
                            x: size.width / 2,
                            y: size.height * manager.positionRatio
                        )
                        .transition(.opacity)
                        .id(cue.id)
                }
            }
        }
        .allowsHitTesting(false)
        .animation(.easeInOut(duration: 0.18), value: manager.currentCue?.id)
    }
}

import SwiftUI

/// 带弹幕热力图的播放进度条：
/// 上层为密度柱状图，中层为缓冲进度，下层为已播进度，支持拖动 seek。
struct PlayerProgressBar: View {
    let current: Double
    let duration: Double
    let buffered: Double
    let heat: [Double]
    var onSeek: (Double) -> Void

    @State private var dragProgress: Double?
    @State private var isDragging = false

    private var progress: Double {
        if let dragProgress { return dragProgress }
        guard duration > 0 else { return 0 }
        return min(1, max(0, current / duration))
    }

    var body: some View {
        GeometryReader { proxy in
            let width = proxy.size.width
            let trackHeight: CGFloat = 4

            VStack(spacing: 4) {
                // 弹幕热力
                DanmakuHeatmap(buckets: heat, height: 12, tint: .white)
                    .opacity(0.55)

                // 进度轨道
                ZStack(alignment: .leading) {
                    Capsule()
                        .fill(.white.opacity(0.22))
                        .frame(height: trackHeight)

                    Capsule()
                        .fill(.white.opacity(0.35))
                        .frame(width: max(0, width * min(1, bufferedRatio)), height: trackHeight)

                    Capsule()
                        .fill(.white)
                        .frame(width: max(0, width * progress), height: trackHeight)

                    Circle()
                        .fill(.white)
                        .frame(width: isDragging ? 14 : 0, height: isDragging ? 14 : 0)
                        .offset(x: width * progress - (isDragging ? 7 : 0))
                        .animation(.spring(duration: 0.2), value: isDragging)
                }
                .frame(height: trackHeight)
                .frame(maxHeight: .infinity, alignment: .center)
                .contentShape(Rectangle().inset(by: -12))
                .gesture(dragGesture(width: width))
            }
        }
        .frame(height: 26)
        .accessibilityElement()
        .accessibilityLabel("播放进度")
        .accessibilityValue("\(Int(progress * 100)) percent")
    }

    private var bufferedRatio: Double {
        guard duration > 0 else { return 0 }
        return min(1, max(0, buffered / duration))
    }

    private func dragGesture(width: CGFloat) -> some Gesture {
        DragGesture(minimumDistance: 0)
            .onChanged { value in
                isDragging = true
                let ratio = min(1, max(0, value.location.x / max(1, width)))
                dragProgress = ratio
            }
            .onEnded { value in
                let ratio = min(1, max(0, value.location.x / max(1, width)))
                dragProgress = nil
                isDragging = false
                onSeek(ratio * duration)
            }
    }
}

import SwiftUI

/// 弹幕热力图：用于进度条上方的高能密度显示。
/// ▁ ▁ ▂ ▅ █ █ █ ▃ ▂ ▁ —— 柱高即弹幕密度。
struct DanmakuHeatmap: View {
    /// 0...1 归一化密度数组
    let buckets: [Double]
    var height: CGFloat = 18
    var tint: Color = .accentColor

    var body: some View {
        GeometryReader { proxy in
            Canvas { context, size in
                guard !buckets.isEmpty else { return }
                let barGap: CGFloat = 1.5
                let barWidth = max(1.2, (size.width - barGap * CGFloat(buckets.count - 1)) / CGFloat(buckets.count))
                var x: CGFloat = 0
                for value in buckets {
                    let barHeight = max(1.5, size.height * value)
                    let rect = CGRect(
                        x: x,
                        y: size.height - barHeight,
                        width: barWidth,
                        height: barHeight
                    )
                    let path = Path(roundedRect: rect, cornerRadius: barWidth / 2)
                    context.fill(path, with: .color(tint.opacity(0.35 + 0.5 * value)))
                    x += barWidth + barGap
                }
            }
        }
        .frame(height: height)
        .accessibilityHidden(true)
    }
}

#Preview {
    DanmakuHeatmap(buckets: [0.1, 0.15, 0.3, 0.8, 1, 0.9, 0.5, 0.2, 0.4, 0.9, 0.7, 0.2, 0.1])
        .padding()
        .background(Color.black)
}

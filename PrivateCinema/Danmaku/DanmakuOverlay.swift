import SwiftUI
import UIKit

/// 弹幕覆盖层：桥接 SwiftUI 与高性能渲染视图。
/// 本层 `allowsHitTesting(false)`，不拦截播放器手势。
struct DanmakuOverlay: UIViewRepresentable {
    let renderer: DanmakuRendererView

    func makeUIView(context: Context) -> DanmakuRendererView {
        renderer
    }

    func updateUIView(_ uiView: DanmakuRendererView, context: Context) {}
}

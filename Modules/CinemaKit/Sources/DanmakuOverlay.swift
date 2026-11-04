import SwiftUI
import UIKit

/// 弹幕覆盖层：桥接 SwiftUI 与高性能渲染视图。
/// 本层 `allowsHitTesting(false)`，不拦截播放器手势。
public struct DanmakuOverlay: UIViewRepresentable {
    public let renderer: DanmakuRendererView

    public func makeUIView(context: Context) -> DanmakuRendererView {
        renderer
    }

    public func updateUIView(_ uiView: DanmakuRendererView, context: Context) {}
}

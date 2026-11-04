import AVKit
import SwiftUI

/// 系统 AirPlay 路由选择按钮（使用系统 AVRoutePickerView，不自造协议）。
public struct AirPlayButton: UIViewRepresentable {
    public func makeUIView(context: Context) -> AVRoutePickerView {
        let view = AVRoutePickerView()
        view.tintColor = .white
        view.activeTintColor = .systemBlue
        view.backgroundColor = .clear
        view.isUserInteractionEnabled = true
        return view
    }

    public func updateUIView(_ uiView: AVRoutePickerView, context: Context) {}
}

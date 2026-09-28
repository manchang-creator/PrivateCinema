import AVKit
import SwiftUI

/// 系统 AirPlay 路由选择按钮（使用系统 AVRoutePickerView，不自造协议）。
struct AirPlayButton: UIViewRepresentable {
    func makeUIView(context: Context) -> AVRoutePickerView {
        let view = AVRoutePickerView()
        view.tintColor = .white
        view.activeTintColor = .systemBlue
        view.backgroundColor = .clear
        view.isUserInteractionEnabled = true
        return view
    }

    func updateUIView(_ uiView: AVRoutePickerView, context: Context) {}
}

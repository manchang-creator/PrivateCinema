import AVFoundation
import SwiftUI
import UIKit

/// 垂直手势命中的屏幕侧（左侧亮度 / 右侧音量）。
enum PanScreenSide {
    case left
    case right
}

/// 视频画面承载视图：AVPlayerLayer + 手势识别。
/// 手势约定：
/// - 单击：显示 / 隐藏控制层
/// - 长按（0.5s）：2 倍速冲刺，松开恢复
/// - 水平拖动：快进 / 快退预览
/// - 垂直拖动：左半屏亮度，右半屏音量
struct VideoSurfaceView: UIViewRepresentable {
    let player: AVPlayer
    var onTap: () -> Void = {}
    var onHoldChanged: (Bool) -> Void = { _ in }
    var onPanBegan: () -> Void = {}
    var onPanChanged: (_ translation: CGPoint, _ side: PanScreenSide) -> Void = { _, _ in }
    var onPanEnded: () -> Void = {}
    /// AVPlayerLayer 挂载回调（PiP 控制器需要持有它）
    var onAttach: (AVPlayerLayer) -> Void = { _ in }

    func makeUIView(context: Context) -> PlayerContainerView {
        let view = PlayerContainerView()
        view.player = player
        view.onTap = onTap
        view.onHoldChanged = onHoldChanged
        view.onPanBegan = onPanBegan
        view.onPanChanged = onPanChanged
        view.onPanEnded = onPanEnded
        onAttach(view.playerLayer)
        return view
    }

    func updateUIView(_ uiView: PlayerContainerView, context: Context) {
        uiView.player = player
        uiView.onTap = onTap
        uiView.onHoldChanged = onHoldChanged
        uiView.onPanBegan = onPanBegan
        uiView.onPanChanged = onPanChanged
        uiView.onPanEnded = onPanEnded
    }

    static func dismantleUIView(_ uiView: PlayerContainerView, coordinator: ()) {
        uiView.onDetach?()
    }

    final class PlayerContainerView: UIView {
        var playerLayer: AVPlayerLayer {
            layer as! AVPlayerLayer
        }

        var player: AVPlayer? {
            didSet {
                playerLayer.player = player
            }
        }

        var onTap: () -> Void = {}
        var onHoldChanged: (Bool) -> Void = { _ in }
        var onPanBegan: () -> Void = {}
        var onPanChanged: (CGPoint, PanScreenSide) -> Void = { _, _ in }
        var onPanEnded: () -> Void = {}
        var onDetach: (() -> Void)?

        private enum PanAxis {
            case undetermined, horizontal, vertical
        }

        private var panAxis: PanAxis = .undetermined

        override static var layerClass: AnyClass {
            AVPlayerLayer.self
        }

        override init(frame: CGRect) {
            super.init(frame: frame)
            backgroundColor = .black
            (layer as? AVPlayerLayer)?.videoGravity = .resizeAspect

            let tap = UITapGestureRecognizer(target: self, action: #selector(handleTap))
            addGestureRecognizer(tap)

            let longPress = UILongPressGestureRecognizer(target: self, action: #selector(handleLongPress(_:)))
            longPress.minimumPressDuration = 0.5
            longPress.allowableMovement = 40
            addGestureRecognizer(longPress)

            let pan = UIPanGestureRecognizer(target: self, action: #selector(handlePan(_:)))
            pan.maximumNumberOfTouches = 1
            addGestureRecognizer(pan)

            tap.require(toFail: longPress)
        }

        required init?(coder: NSCoder) {
            super.init(coder: coder)
        }

        @objc private func handleTap() {
            onTap()
        }

        @objc private func handleLongPress(_ gesture: UILongPressGestureRecognizer) {
            switch gesture.state {
            case .began:
                Haptics.medium()
                onHoldChanged(true)
            case .ended, .cancelled, .failed:
                onHoldChanged(false)
            default:
                break
            }
        }

        @objc private func handlePan(_ gesture: UIPanGestureRecognizer) {
            let translation = gesture.translation(in: self)

            switch gesture.state {
            case .began:
                panAxis = .undetermined
                onPanBegan()
            case .changed:
                if panAxis == .undetermined, abs(translation.x) + abs(translation.y) > 12 {
                    panAxis = abs(translation.x) > abs(translation.y) ? .horizontal : .vertical
                }
                guard panAxis != .undetermined else { return }
                let side: PanScreenSide = gesture.location(in: self).x < bounds.midX ? .left : .right
                switch panAxis {
                case .horizontal:
                    onPanChanged(CGPoint(x: translation.x, y: 0), side)
                case .vertical:
                    onPanChanged(CGPoint(x: 0, y: translation.y), side)
                case .undetermined:
                    break
                }
            case .ended, .cancelled, .failed:
                guard panAxis != .undetermined else { return }
                onPanEnded()
                panAxis = .undetermined
            default:
                break
            }
        }
    }
}

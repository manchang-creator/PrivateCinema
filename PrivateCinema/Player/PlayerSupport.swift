import Foundation
import MediaPlayer
import SwiftUI
import UIKit

/// 播放偏好设置（设置页与播放器共享）。
@MainActor
@Observable
final class PlaybackSettings {
    private let defaults: UserDefaults

    private enum Keys {
        static let autoPlayNext = "playback.autoPlayNext"
        static let rememberRate = "playback.rememberRate"
        static let defaultRate = "playback.defaultRate"
        static let autoLandscape = "playback.autoLandscape"
        static let appearance = "playback.appearance"
    }

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    var autoPlayNext: Bool {
        get { defaults.object(forKey: Keys.autoPlayNext) as? Bool ?? true }
        set { defaults.set(newValue, forKey: Keys.autoPlayNext) }
    }

    var rememberRate: Bool {
        get { defaults.bool(forKey: Keys.rememberRate) }
        set { defaults.set(newValue, forKey: Keys.rememberRate) }
    }

    /// 默认倍速（0.5 ~ 2.0）。
    var defaultRate: Double {
        get { defaults.object(forKey: Keys.defaultRate) as? Double ?? 1.0 }
        set { defaults.set(min(2, max(0.5, newValue)), forKey: Keys.defaultRate) }
    }

    /// 进入播放器自动横屏。
    var autoLandscape: Bool {
        get { defaults.bool(forKey: Keys.autoLandscape) }
        set { defaults.set(newValue, forKey: Keys.autoLandscape) }
    }

    // MARK: - 外观

    enum AppearanceMode: String, CaseIterable, Identifiable {
        case system, light, dark

        var id: String { rawValue }

        var displayName: String {
            switch self {
            case .system: return "跟随系统"
            case .light: return "浅色"
            case .dark: return "深色"
            }
        }

        var colorScheme: ColorScheme? {
            switch self {
            case .system: return nil
            case .light: return .light
            case .dark: return .dark
            }
        }
    }

    var appearance: AppearanceMode {
        get { AppearanceMode(rawValue: defaults.string(forKey: Keys.appearance) ?? "") ?? .system }
        set { defaults.set(newValue.rawValue, forKey: Keys.appearance) }
    }
}

/// 屏幕方向控制（iOS 16+ 官方 API）。
enum ScreenOrientation {
    static func setLandscape(_ landscape: Bool) {
        let mask: UIInterfaceOrientationMask = landscape ? .landscapeRight : .portrait
        for scene in UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }) {
            scene.requestGeometryUpdate(.iOS(interfaceOrientations: mask))
            scene.windows.first?.rootViewController?.setNeedsUpdateOfSupportedInterfaceOrientations()
        }
    }
}

/// 系统音量步进（MPVolumeView 隐藏实例）。
final class VolumeController {
    private let volumeView = MPVolumeView(frame: CGRect(x: -200, y: -200, width: 1, height: 1))

    init() {
        DispatchQueue.main.async { [weak self] in
            guard let self,
                  let window = UIApplication.shared.connectedScenes
                      .compactMap({ $0 as? UIWindowScene })
                      .flatMap({ $0.windows })
                      .first(where: \.isKeyWindow) else { return }
            window.addSubview(self.volumeView)
        }
    }

    func adjust(by delta: Float) {
        guard let slider = volumeView.subviews.compactMap({ $0 as? UISlider }).first else { return }
        slider.value = min(1, max(0, slider.value + delta))
    }
}

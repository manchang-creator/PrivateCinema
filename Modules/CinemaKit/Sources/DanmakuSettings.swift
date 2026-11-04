import Foundation
import UIKit

/// 弹幕设置：全部持久化到 UserDefaults（配合"恢复默认"一键重置）。
@MainActor
@Observable
public final class DanmakuSettings {
    private let defaults: UserDefaults

    private enum Keys {
        static let enabled = "danmaku.enabled"
        static let areaRatio = "danmaku.areaRatio"
        static let opacity = "danmaku.opacity"
        static let fontScale = "danmaku.fontScale"
        static let speedFactor = "danmaku.speedFactor"
        static let blockTop = "danmaku.blockTop"
        static let blockBottom = "danmaku.blockBottom"
        static let blockScroll = "danmaku.blockScroll"
        static let blockKeywords = "danmaku.blockKeywords"
        static let showMine = "danmaku.showMine"
    }

    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    public var isEnabled: Bool {
        get { defaults.object(forKey: Keys.enabled) as? Bool ?? true }
        set { defaults.set(newValue, forKey: Keys.enabled) }
    }

    /// 显示区域：0.25 / 0.5 / 0.75 / 1
    public var areaRatio: Double {
        get { defaults.object(forKey: Keys.areaRatio) as? Double ?? 0.5 }
        set { defaults.set(min(1, max(0.25, newValue)), forKey: Keys.areaRatio) }
    }

    public var opacity: Double {
        get { defaults.object(forKey: Keys.opacity) as? Double ?? 1 }
        set { defaults.set(min(1, max(0.2, newValue)), forKey: Keys.opacity) }
    }

    /// 字体缩放 0.7 ~ 1.5
    public var fontScale: Double {
        get { defaults.object(forKey: Keys.fontScale) as? Double ?? 1 }
        set { defaults.set(min(1.5, max(0.7, newValue)), forKey: Keys.fontScale) }
    }

    /// 速度 0.5 ~ 2（1 为标准速度）
    public var speedFactor: Double {
        get { defaults.object(forKey: Keys.speedFactor) as? Double ?? 1 }
        set { defaults.set(min(2, max(0.5, newValue)), forKey: Keys.speedFactor) }
    }

    public var blockTop: Bool {
        get { defaults.bool(forKey: Keys.blockTop) }
        set { defaults.set(newValue, forKey: Keys.blockTop) }
    }

    public var blockBottom: Bool {
        get { defaults.bool(forKey: Keys.blockBottom) }
        set { defaults.set(newValue, forKey: Keys.blockBottom) }
    }

    public var blockScroll: Bool {
        get { defaults.bool(forKey: Keys.blockScroll) }
        set { defaults.set(newValue, forKey: Keys.blockScroll) }
    }

    public var blockKeywords: [String] {
        get { defaults.stringArray(forKey: Keys.blockKeywords) ?? [] }
        set { defaults.set(newValue, forKey: Keys.blockKeywords) }
    }

    public var showMine: Bool {
        get { defaults.object(forKey: Keys.showMine) as? Bool ?? true }
        set { defaults.set(newValue, forKey: Keys.showMine) }
    }

    public var userId: String = ""

    /// 用户 ID 是否被屏蔽（设置页可维护屏蔽用户列表时使用）。
    public var blockedUserIds: [String] {
        get { defaults.stringArray(forKey: "danmaku.blockUsers") ?? [] }
        set { defaults.set(newValue, forKey: "danmaku.blockUsers") }
    }

    public func resetToDefault() {
        isEnabled = true
        areaRatio = 0.5
        opacity = 1
        fontScale = 1
        speedFactor = 1
        blockTop = false
        blockBottom = false
        blockScroll = false
        blockKeywords = []
        showMine = true
    }

    /// 渲染器快照（渲染线程读取，不持有设置对象）。
    public var snapshot: DanmakuRendererView.Snapshot {
        DanmakuRendererView.Snapshot(
            areaRatio: areaRatio,
            opacity: opacity,
            fontScale: fontScale,
            speedFactor: speedFactor,
            allowScroll: isEnabled && !blockScroll,
            allowTop: isEnabled && !blockTop,
            allowBottom: isEnabled && !blockBottom
        )
    }
}

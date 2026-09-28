import SwiftUI
import UIKit

/// 高性能弹幕渲染器。
///
/// 设计要点：
/// - 渲染层为普通 UIView + CATextLayer，由 CADisplayLink 驱动，
///   不创建 SwiftUI 视图树，任意数量弹幕都不会撑爆 SwiftUI diff。
/// - 位置完全由"绝对时间"推导（x = f(t)），暂停时画面自然冻结，
///   seek 后弹幕自动同步到新时间点，不会漂移。
/// - 滚动弹幕按车道防重叠：新弹幕只有在前一条"尾部完全进入屏幕"后才允许进入该车道。
/// - 顶部 / 底部弹幕固定显示数秒，独立车道。
final class DanmakuRendererView: UIView {

    struct Snapshot {
        var areaRatio: Double = 0.5
        var opacity: Double = 1
        var fontScale: Double = 1
        var speedFactor: Double = 1
        var allowScroll = true
        var allowTop = true
        var allowBottom = true

        static let `default` = Snapshot()

        /// 设置关闭时整体透明度为 0。
        var enabledOpacity: Double {
            (allowScroll || allowTop || allowBottom) ? opacity : 0
        }
    }

    // MARK: - 配置

    var timeProvider: () -> Double = { 0 }
    private var snapshot: Snapshot = .default

    /// 滚动弹幕横穿全屏所需的基础秒数（速度 1x 时）。
    private let baseCrossDuration: Double = 9.0
    /// 固定弹幕停留秒数。
    private let fixedDisplayDuration: Double = 4.5

    // MARK: - 状态

    private struct ActiveDanmaku {
        let layer: CATextLayer
        let item: DanmakuItem
        let startTime: Double
        let textWidth: CGFloat
        let travelDuration: Double
    }

    private var pending: [DanmakuItem] = []
    private var pendingIndex = 0
    private var activeScroll: [ActiveDanmaku] = []
    private var activeFixed: [ActiveDanmaku] = []
    private var scrollLaneFreeAt: [Double] = []
    private var topLaneFreeAt: [Double] = []
    private var bottomLaneFreeAt: [Double] = []

    private var displayLink: CADisplayLink?
    private var proxyStorage: DisplayLinkProxy?

    // MARK: - 生命周期

    override init(frame: CGRect) {
        super.init(frame: frame)
        isUserInteractionEnabled = false
        backgroundColor = .clear
        startDisplayLink()
    }

    required init?(coder: NSCoder) {
        super.init(coder: coder)
        startDisplayLink()
    }

    deinit {
        displayLink?.invalidate()
        displayLink = nil
    }

    private func startDisplayLink() {
        let proxy = DisplayLinkProxy(view: self)
        let link = CADisplayLink(target: proxy, selector: #selector(DisplayLinkProxy.step))
        link.add(to: .main, forMode: .common)
        displayLink = link
        proxyStorage = proxy
    }

    /// 显示链与视图弱引用桥接，避免 CADisplayLink 强持有 UIView 造成泄漏。
    private final class DisplayLinkProxy: NSObject {
        weak var view: DanmakuRendererView?

        init(view: DanmakuRendererView) {
            self.view = view
        }

        @objc func step() {
            view?.renderFrame()
        }
    }

    // MARK: - 对外接口

    /// 载入一集的弹幕（需按时间升序）。
    func load(items: [DanmakuItem], snapshot: Snapshot) {
        self.snapshot = snapshot
        layer.opacity = Float(snapshot.enabledOpacity)
        pending = items
        pendingIndex = 0
        clearActive()
        resetLanes()
        displayLink?.isPaused = false
    }

    func clear() {
        pending = []
        pendingIndex = 0
        clearActive()
        resetLanes()
    }

    func apply(snapshot: Snapshot) {
        self.snapshot = snapshot
        layer.opacity = Float(snapshot.enabledOpacity)
        activeScroll.removeAll { danmaku in
            if !snapshot.allowScroll {
                danmaku.layer.removeFromSuperlayer()
                return true
            }
            return false
        }
        activeFixed.removeAll { danmaku in
            let blocked = (danmaku.item.type == .top && !snapshot.allowTop)
                || (danmaku.item.type == .bottom && !snapshot.allowBottom)
            if blocked { danmaku.layer.removeFromSuperlayer() }
            return blocked
        }
    }

    /// 实时追加密发出的弹幕。
    func enqueue(_ item: DanmakuItem) {
        guard pendingIndex < pending.count,
              let insertion = pending[pendingIndex...].firstIndex(where: { $0.time > item.time }) else {
            pending.append(item)
            return
        }
        pending.insert(item, at: insertion)
    }

    /// seek 后同步：丢弃已播过时间点的待显弹幕，清空在播图层。
    func skip(to time: Double) {
        clearActive()
        resetLanes(at: time)
        if let index = pending.firstIndex(where: { $0.time >= time }) {
            pendingIndex = index
        } else {
            pendingIndex = pending.count
        }
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        // 尺寸变化（旋转等）后清屏重来，避免错位
        clearActive()
        resetLanes()
    }

    // MARK: - 渲染

    private func renderFrame() {
        guard bounds.width > 1, bounds.height > 1 else { return }
        let now = timeProvider()

        // 到点弹幕进入渲染队列
        while pendingIndex < pending.count, pending[pendingIndex].time <= now {
            let item = pending[pendingIndex]
            pendingIndex += 1
            spawn(item, at: now)
        }

        // 更新活动弹幕位置
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        updateScroll(at: now)
        updateFixed(at: now)
        CATransaction.commit()
    }

    private func spawn(_ item: DanmakuItem, at now: Double) {
        switch item.type {
        case .scroll:
            guard snapshot.allowScroll else { return }
            spawnScroll(item, at: now)
        case .top:
            guard snapshot.allowTop else { return }
            spawnFixed(item, at: now, isTop: true)
        case .bottom:
            guard snapshot.allowBottom else { return }
            spawnFixed(item, at: now, isTop: false)
        }
    }

    private func spawnScroll(_ item: DanmakuItem, at now: Double) {
        guard let textLayer = makeLayer(for: item) else { return }
        let textWidth = textLayer.frame.width

        guard let lane = availableScrollLane(at: now) else {
            // 车道全满则丢弃（常见策略，避免堆积）
            return
        }
        let laneY = laneOffset(for: lane)
        let pxPerSecond = scrollSpeed(textWidth: textWidth)
        let travel = (bounds.width + textWidth) / pxPerSecond

        textLayer.frame.origin = CGPoint(x: bounds.width, y: laneY)
        layer.addSublayer(textLayer)

        activeScroll.append(ActiveDanmaku(
            layer: textLayer,
            item: item,
            startTime: now,
            textWidth: textWidth,
            travelDuration: Double(travel)
        ))
        scrollLaneFreeAt[lane] = now + Double(textWidth / pxPerSecond)
    }

    private func spawnFixed(_ item: DanmakuItem, at now: Double, isTop: Bool) {
        guard let textLayer = makeLayer(for: item) else { return }

        var lanes = isTop ? topLaneFreeAt : bottomLaneFreeAt
        guard let lane = lanes.firstIndex(where: { now >= $0 }) else { return }
        lanes[lane] = now + fixedDisplayDuration
        if isTop {
            topLaneFreeAt = lanes
        } else {
            bottomLaneFreeAt = lanes
        }

        let textWidth = textLayer.frame.width
        let x = max(8, (bounds.width - textWidth) / 2)
        let laneY = isTop
            ? laneOffset(for: lane)
            : bounds.height - laneOffset(for: lane) - textLayer.frame.height
        textLayer.frame.origin = CGPoint(x: x, y: laneY)
        layer.addSublayer(textLayer)

        activeFixed.append(ActiveDanmaku(
            layer: textLayer,
            item: item,
            startTime: now,
            textWidth: textWidth,
            travelDuration: fixedDisplayDuration
        ))
    }

    private func updateScroll(at now: Double) {
        activeScroll.removeAll { danmaku in
            let progress = (now - danmaku.startTime) / max(0.001, danmaku.travelDuration)
            let x = bounds.width - CGFloat(progress) * (bounds.width + danmaku.textWidth)
            if x < -danmaku.textWidth - 8 {
                danmaku.layer.removeFromSuperlayer()
                return true
            }
            danmaku.layer.frame.origin.x = x
            return false
        }
    }

    private func updateFixed(at now: Double) {
        activeFixed.removeAll { danmaku in
            if now > danmaku.startTime + fixedDisplayDuration {
                danmaku.layer.removeFromSuperlayer()
                return true
            }
            return false
        }
    }

    // MARK: - 车道与几何

    private var baseFontSize: CGFloat {
        16 * CGFloat(snapshot.fontScale) * max(1, (bounds.width / 390).rounded(.down))
    }

    private var laneHeight: CGFloat {
        baseFontSize * 1.4 + 4
    }

    private var usableHeight: CGFloat {
        bounds.height * CGFloat(snapshot.areaRatio)
    }

    private var scrollLaneCount: Int {
        max(1, Int(usableHeight / laneHeight))
    }

    private var fixedLaneCount: Int {
        max(1, Int(usableHeight / laneHeight))
    }

    private func laneOffset(for lane: Int) -> CGFloat {
        CGFloat(lane) * laneHeight + 4
    }

    private func scrollSpeed(textWidth: CGFloat) -> CGFloat {
        let width = max(bounds.width, 100)
        return (width + textWidth) / CGFloat(baseCrossDuration / max(0.1, snapshot.speedFactor))
    }

    private func availableScrollLane(at now: Double) -> Int? {
        for lane in 0..<scrollLaneCount {
            guard lane < scrollLaneFreeAt.count else { break }
            if now >= scrollLaneFreeAt[lane] {
                return lane
            }
        }
        return nil
    }

    private func resetLanes(at time: Double? = nil) {
        let t = time ?? timeProvider()
        scrollLaneFreeAt = [Double](repeating: t, count: max(scrollLaneCount, 8))
        topLaneFreeAt = [Double](repeating: t, count: max(fixedLaneCount, 4))
        bottomLaneFreeAt = [Double](repeating: t, count: max(fixedLaneCount, 4))
    }

    // MARK: - 图层

    private func makeLayer(for item: DanmakuItem) -> CATextLayer? {
        let content = item.content.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !content.isEmpty else { return nil }

        let fontSize = baseFontSize
        let font = UIFont.systemFont(ofSize: fontSize, weight: .medium)
        let attributes: [NSAttributedString.Key: Any] = [
            .font: font,
            .foregroundColor: UIColor(Color(hex: item.color)),
        ]
        let attributed = NSAttributedString(string: content, attributes: attributes)
        let textSize = (content as NSString).size(withAttributes: attributes)

        let textLayer = CATextLayer()
        textLayer.string = attributed
        textLayer.contentsScale = window?.screen.scale ?? UIScreen.main.scale
        textLayer.alignmentMode = .left
        textLayer.frame = CGRect(x: 0, y: 0, width: textSize.width + 8, height: laneHeight)
        // 轻描边观感：阴影模拟描边
        textLayer.shadowColor = UIColor.black.cgColor
        textLayer.shadowOpacity = 0.9
        textLayer.shadowRadius = 0.8
        textLayer.shadowOffset = CGSize(width: 0.7, height: 0.7)
        return textLayer
    }

    private func clearActive() {
        for danmaku in activeScroll {
            danmaku.layer.removeFromSuperlayer()
        }
        for danmaku in activeFixed {
            danmaku.layer.removeFromSuperlayer()
        }
        activeScroll = []
        activeFixed = []
    }
}

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
public final class DanmakuRendererView: UIView {

    public struct Snapshot {
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

    public var timeProvider: () -> Double = { 0 }
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

    /// 后退 seek 之后 AVPlayer 仍会短暂上报旧位置。
    /// 在播放头回到新位置之前以锚点作为时间基准，否则旧位置会把两者之间的
    /// 弹幕一次性倾倒出来。前进 seek 不需要锚点：播放头落后时自然只补新弹幕。
    private var syncAnchor: Double?
    /// 锚点失效时间：seek 万一没有生效，必须回到实际播放头而不是永久冻结。
    private var syncAnchorDeadline: CFTimeInterval = 0

    // MARK: - 生命周期

    public override init(frame: CGRect) {
        super.init(frame: frame)
        isUserInteractionEnabled = false
        backgroundColor = .clear
        startDisplayLink()
    }

    public required init?(coder: NSCoder) {
        super.init(coder: coder)
        startDisplayLink()
    }

    deinit {
        displayLink?.invalidate()
        displayLink = nil
    }

    public override func didMoveToWindow() {
        super.didMoveToWindow()
        // 离开窗口（退出播放页）就停掉渲染循环：60fps 空转没有意义，
        // 回来时窗口挂载会自动恢复。
        displayLink?.isPaused = window == nil
    }

    private func startDisplayLink() {
        let proxy = DisplayLinkProxy(view: self)
        let link = CADisplayLink(target: proxy, selector: #selector(DisplayLinkProxy.step))
        link.add(to: .main, forMode: .common)
        // 创建时通常尚未挂载到窗口：先暂停，由 didMoveToWindow 恢复，
        // 避免播放页没出现前就在后台空转 60fps
        link.isPaused = window == nil
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
    /// 起点取当前播放时间：从 MiniPlayer 重开播放页或续播到中途时，
    /// 不能把此前已经过去的弹幕一次性倾倒到屏幕上。
    /// - Parameter anchor: 明确的起始播放位置。刚换完条目时 AVPlayer 的
    ///   实时时间还停在旧值（seek 尚未生效），由调用方传入续播点更可靠。
    public func load(items: [DanmakuItem], snapshot: Snapshot, at anchor: Double? = nil) {
        self.snapshot = snapshot
        layer.opacity = Float(snapshot.enabledOpacity)
        pending = items
        // 换条目时播放头还停在旧条目的位置上，必须等它落到锚点再用实时时间
        if let anchor {
            holdTimeline(at: anchor)
        }
        // 没有显式锚点时沿用当前时间基准：设置变更触发的刷新不会打断
        // 尚未生效的 seek 锚点，避免读回旧位置导致弹幕倾倒
        let now = renderTime()
        clearActive()
        resetLanes(at: now)
        pendingIndex = pending.firstIndex(where: { $0.time >= now }) ?? pending.count
        // 视图不在窗口上时保持暂停，避免后台空转（didMoveToWindow 负责恢复）
        displayLink?.isPaused = window == nil
    }

    public func clear() {
        releaseTimeline()
        pending = []
        pendingIndex = 0
        clearActive()
        resetLanes()
    }

    public func apply(snapshot: Snapshot) {
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
    public func enqueue(_ item: DanmakuItem) {
        guard pendingIndex < pending.count,
              let insertion = pending[pendingIndex...].firstIndex(where: { $0.time > item.time }) else {
            pending.append(item)
            return
        }
        pending.insert(item, at: insertion)
    }

    /// seek 后同步：丢弃已播过时间点的待显弹幕，清空在播图层。
    public func skip(to time: Double) {
        clearActive()
        resetLanes(at: time)
        if let index = pending.firstIndex(where: { $0.time >= time }) {
            pendingIndex = index
        } else {
            pendingIndex = pending.count
        }
        holdTimeline(at: time)
    }

    // MARK: - 时间基准

    /// 以锚点作为时间基准，直到播放头落到锚点附近（或超时）。
    /// 后退 seek 之后 AVPlayer 会继续上报旧位置几百毫秒，直接用实时时间会把
    /// 锚点与旧位置之间的弹幕整段倾泻出来。
    private func holdTimeline(at time: Double) {
        syncAnchor = time
        // 网络流的 seek 可能耗时数秒：给足 3s，宁可短暂冻结也不要倾倒弹幕；
        // 超时后由 renderTime 交还实时时间，不会永久冻结
        syncAnchorDeadline = CACurrentMediaTime() + 3.0
    }

    private func releaseTimeline() {
        syncAnchor = nil
        syncAnchorDeadline = 0
    }

    /// 渲染用的时间：锚点生效期间取锚点，播放头落到锚点后交还实时时间。
    /// 判定用绝对差值而非方向：后退 seek 时旧位置大于锚点，前进 seek 时小于，
    /// 只有「已经落在锚点附近」才说明 seek 真正生效。
    private func renderTime() -> Double {
        let live = timeProvider()
        guard let anchor = syncAnchor else { return live }
        if abs(live - anchor) <= 0.5 {
            releaseTimeline()
            return live
        }
        guard CACurrentMediaTime() > syncAnchorDeadline else { return anchor }
        // seek 迟迟未生效（条目未就绪 / 网络卡顿 / 被播放器忽略）：交还实时时间。
        // 播放头已越过锚点说明是后退 seek 卡住，必须重建索引，否则恢复瞬间会把
        // 锚点到旧位置之间的弹幕整段倾泻出来；播放头仍在锚点之前（新条目尚未
        // seek 到位）则保留索引，等播放头自然追上锚点，同样不会堆积。
        releaseTimeline()
        if live > anchor {
            clearActive()
            resetLanes(at: live)
            pendingIndex = pending.firstIndex { $0.time >= live } ?? pending.count
        }
        return live
    }

    public override func layoutSubviews() {
        super.layoutSubviews()
        // 尺寸变化（旋转等）后清屏重来，避免错位
        clearActive()
        resetLanes(at: renderTime())
    }

    // MARK: - 渲染

    private func renderFrame() {
        guard bounds.width > 1, bounds.height > 1 else { return }
        let now = renderTime()

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

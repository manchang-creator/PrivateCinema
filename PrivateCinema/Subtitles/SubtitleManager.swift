import Foundation
import SwiftUI

/// 字幕管理器：外挂字幕（SRT/VTT）加载、样式与时间偏移。
/// 内嵌字幕（HLS 内封轨道）由播放器通过 AVPlayer 轨道选择实现，
/// 本管理器只负责"自定义渲染"的外挂路径。
@MainActor
@Observable
final class SubtitleManager {
    private(set) var cues: [SubtitleCue] = []
    private(set) var currentCue: SubtitleCue?
    private(set) var sourceName: String?

    // MARK: - 样式设置（UserDefaults 持久化）

    private let defaults: UserDefaults

    private enum Keys {
        static let fontSize = "subtitle.fontSize"
        static let positionRatio = "subtitle.positionRatio"
        static let backgroundOpacity = "subtitle.backgroundOpacity"
        static let colorHex = "subtitle.colorHex"
        static let offset = "subtitle.offset"
    }

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    /// 字体大小。
    var fontSize: Double {
        get { defaults.object(forKey: Keys.fontSize) as? Double ?? 18 }
        set { defaults.set(min(32, max(12, newValue)), forKey: Keys.fontSize) }
    }

    /// 垂直位置（0 顶部 ~ 1 底部）。
    var positionRatio: Double {
        get { defaults.object(forKey: Keys.positionRatio) as? Double ?? 0.88 }
        set { defaults.set(min(0.95, max(0.2, newValue)), forKey: Keys.positionRatio) }
    }

    /// 背景透明度 0 ~ 0.9。
    var backgroundOpacity: Double {
        get { defaults.object(forKey: Keys.backgroundOpacity) as? Double ?? 0.35 }
        set { defaults.set(min(0.9, max(0, newValue)), forKey: Keys.backgroundOpacity) }
    }

    var colorHex: String {
        get { defaults.string(forKey: Keys.colorHex) ?? "#FFFFFF" }
        set { defaults.set(newValue, forKey: Keys.colorHex) }
    }

    /// 时间偏移 -5s ~ +5s。
    var offset: Double {
        get { defaults.object(forKey: Keys.offset) as? Double ?? 0 }
        set { defaults.set(min(5, max(-5, newValue)), forKey: Keys.offset) }
    }

    func resetStyle() {
        fontSize = 18
        positionRatio = 0.88
        backgroundOpacity = 0.35
        colorHex = "#FFFFFF"
        offset = 0
    }

    // MARK: - 加载

    func loadSRT(_ raw: String, sourceName: String) {
        cues = SubtitleParser.parseSRT(raw)
        self.sourceName = sourceName
    }

    func loadVTT(_ raw: String, sourceName: String) {
        cues = SubtitleParser.parseVTT(raw)
        self.sourceName = sourceName
    }

    func loadParsed(_ parsed: [SubtitleCue], sourceName: String) {
        cues = parsed
        self.sourceName = sourceName
    }

    /// 加载外挂字幕文件（本地文件或远程 URL，按扩展名 / 内容嗅探格式）。
    func loadExternal(url: URL) async {
        do {
            let (data, _) = try await URLSession.shared.data(from: url)
            let raw = String(data: data, encoding: .utf8) ?? ""
            let name = url.lastPathComponent
            let parsed = SubtitleParser.parse(raw)
            if !parsed.isEmpty {
                loadParsed(parsed, sourceName: name)
            }
        } catch {
            cues = []
            sourceName = nil
        }
    }

    func clear() {
        cues = []
        currentCue = nil
        sourceName = nil
    }

    // MARK: - 同步

    /// 播放器每帧/定时调用；offset 用于人工对齐。
    func sync(time: Double) {
        guard !cues.isEmpty else {
            currentCue = nil
            return
        }
        let shifted = time - offset
        var candidate: SubtitleCue?
        // 线性游标足够快（字幕量级在千条内），避免每帧二叉树的复杂度
        for cue in cues {
            if cue.start <= shifted && shifted <= cue.end {
                candidate = cue
                break
            }
            if cue.start > shifted {
                break
            }
        }
        if candidate != currentCue {
            currentCue = candidate
        }
    }
}

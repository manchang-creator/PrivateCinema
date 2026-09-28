import Foundation

/// 字幕 Cue。
struct SubtitleCue: Equatable, Identifiable {
    let start: Double
    let end: Double
    let text: String

    var id: String { "\(start)-\(end)-\(text.hashValue)" }
}

/// SRT / WebVTT 字幕解析器。
enum SubtitleParser {

    /// 自动识别格式并解析。
    static func parse(_ raw: String) -> [SubtitleCue] {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return [] }
        if trimmed.uppercased().hasPrefix("WEBVTT") {
            return parseVTT(trimmed)
        }
        return parseSRT(trimmed)
    }

    // MARK: - SRT

    static func parseSRT(_ raw: String) -> [SubtitleCue] {
        let blocks = raw
            .replacingOccurrences(of: "\r\n", with: "\n")
            .components(separatedBy: "\n\n")
        var cues: [SubtitleCue] = []
        for block in blocks {
            let lines = block
                .components(separatedBy: "\n")
                .map { $0.trimmingCharacters(in: .whitespaces) }
                .filter { !$0.isEmpty }
            guard lines.count >= 2,
                  let range = findTiming(in: lines) else { continue }
            let (start, end) = parseTimingSRT(lines[range])
            let text = lines[(range + 1)...].joined(separator: "\n")
            guard !text.isEmpty else { continue }
            cues.append(SubtitleCue(start: start, end: end, text: text))
        }
        return cues.sorted { $0.start < $1.start }
    }

    private static func findTiming(in lines: [String]) -> Int? {
        lines.firstIndex { $0.contains("-->") }
    }

    private static func parseTimingSRT(_ line: String) -> (Double, Double) {
        let parts = line.components(separatedBy: "-->")
        guard parts.count == 2 else { return (0, 0) }
        return (parseTimestamp(parts[0], decimalSeparator: ","),
                parseTimestamp(parts[1], decimalSeparator: ","))
    }

    // MARK: - VTT

    static func parseVTT(_ raw: String) -> [SubtitleCue] {
        let blocks = raw
            .replacingOccurrences(of: "\r\n", with: "\n")
            .components(separatedBy: "\n\n")
        var cues: [SubtitleCue] = []
        for block in blocks {
            let lines = block
                .components(separatedBy: "\n")
                .map { $0.trimmingCharacters(in: .whitespaces) }
            if lines.first?.uppercased().hasPrefix("WEBVTT") == true ||
                lines.first?.uppercased().hasPrefix("NOTE") == true ||
                lines.first?.uppercased().hasPrefix("STYLE") == true {
                continue
            }
            guard let range = findTiming(in: lines) else { continue }
            let startText = lines[range].components(separatedBy: "-->")[0]
                .replacingOccurrences(of: " ", with: "")
            let endText = lines[range].components(separatedBy: "-->")[1]
                .split(separator: " ").first.map(String.init) ?? ""
            let start = parseTimestamp(startText, decimalSeparator: ".")
            let end = parseTimestamp(endText, decimalSeparator: ".")
            // VTT 文本可能带内联标签，直接剥掉 <...>
            let text = lines[(range + 1)...]
                .joined(separator: "\n")
                .replacingOccurrences(of: "<[^>]+>", with: "", options: .regularExpression)
            guard !text.isEmpty else { continue }
            cues.append(SubtitleCue(start: start, end: end, text: text))
        }
        return cues.sorted { $0.start < $1.start }
    }

    // MARK: - 时间戳

    /// "00:01:02,500" / "01:02.500" / "00:01:02.500"
    private static func parseTimestamp(_ raw: String, decimalSeparator: String) -> Double {
        var text = raw.trimmingCharacters(in: .whitespaces)
        text = text.replacingOccurrences(of: decimalSeparator, with: ".")
        let parts = text.split(separator: ":").map(String.init)
        var seconds = 0.0
        for part in parts {
            seconds = seconds * 60 + (Double(part) ?? 0)
        }
        return seconds
    }
}

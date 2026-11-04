import Foundation
import SwiftUI

/// 弹幕防剧透 / 屏蔽规则（先做关键词规则，后续可接模型）。
public struct SpoilerFilter {
    public var keywords: [String]

    public init(keywords: [String] = []) {
        self.keywords = keywords
    }

    /// 内置默认屏蔽词（可关闭设置里调整）。
    public static let builtIn: [String] = [
        "剧透", "结局", "凶手是", "死了", "内鬼是",
    ]

    public func isBlocked(_ content: String) -> Bool {
        let lowered = content.lowercased()
        return keywords.contains { !$0.isEmpty && lowered.contains($0.lowercased()) }
    }
}

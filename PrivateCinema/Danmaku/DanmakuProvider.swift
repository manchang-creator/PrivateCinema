import Foundation

/// 弹幕数据源协议。
/// 播放器只依赖 DanmakuManager，不关心弹幕来自本地 / 服务器 / 第三方。
protocol DanmakuProvider: Sendable {
    /// 拉取某集全部弹幕。
    func fetchDanmaku(episodeId: String) async throws -> [DanmakuItem]

    /// 发送弹幕。
    func sendDanmaku(_ item: DanmakuItem) async throws

    /// 按关键词搜索弹幕（可用于跳转高能片段等场景）。
    func searchDanmaku(keyword: String, episodeId: String?) async throws -> [DanmakuItem]
}

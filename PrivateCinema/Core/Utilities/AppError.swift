import Foundation

/// 统一错误类型：UI 只展示 `userMessage`，不直接暴露 NSError。
enum AppError: Error, Equatable {
    case network(String)
    case unauthorized
    case notFound
    case playback(String)
    case provider(String)
    case decode(String)
    case unknown(String)

    var userMessage: String {
        switch self {
        case .network(let detail):
            return "网络连接出现问题，请稍后重试。（\(detail)）"
        case .unauthorized:
            return "媒体源需要登录授权。"
        case .notFound:
            return "没有找到对应的内容。"
        case .playback(let detail):
            return "播放出现问题：\(detail)"
        case .provider(let detail):
            return "媒体源暂时不可用：\(detail)"
        case .decode(let detail):
            return "数据解析失败。（\(detail)）"
        case .unknown(let detail):
            return "发生了一点小问题。（\(detail)）"
        }
    }

    var isRetryable: Bool {
        switch self {
        case .network, .provider, .unknown:
            return true
        case .playback:
            return true
        case .unauthorized, .notFound, .decode:
            return false
        }
    }

    static func from(_ error: Error) -> AppError {
        if let appError = error as? AppError {
            return appError
        }
        let nsError = error as NSError
        switch nsError.domain {
        case NSURLErrorDomain:
            return .network(nsError.localizedDescription)
        case NSCocoaErrorDomain where nsError.code == 4865:
            return .decode(nsError.localizedDescription)
        default:
            return .unknown(nsError.localizedDescription)
        }
    }
}

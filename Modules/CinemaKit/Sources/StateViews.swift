import SwiftUI

/// 通用加载态。
public struct LoadingView: View {
    /// 跨模块构造入口。
    public init(text: String = "加载中…") {
        self.text = text
    }

    public var text = "加载中…"

    public var body: some View {
        VStack(spacing: 12) {
            ProgressView().controlSize(.regular)
            Text(text)
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// 通用空态。
public struct EmptyStateView: View {
    /// 跨模块构造入口。
    public init(icon: String = "sparkles", title: String, hint: String? = nil) {
        self.icon = icon
        self.title = title
        self.hint = hint
    }

    public var icon: String = "sparkles"
    public var title: String
    public var hint: String? = nil

    public var body: some View {
        VStack(spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 40))
                .foregroundStyle(.tertiary)
            Text(title)
                .font(.headline)
            if let hint {
                Text(hint)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(32)
    }
}

/// 通用错误态（带重试）。
public struct ErrorStateView: View {
    /// 跨模块构造入口。
    public init(error: AppError, onRetry: @escaping () -> Void) {
        self.error = error
        self.onRetry = onRetry
    }

    public let error: AppError
    public var onRetry: () -> Void

    public var body: some View {
        VStack(spacing: 14) {
            Image(systemName: "wifi.exclamationmark")
                .font(.system(size: 40))
                .foregroundStyle(.tertiary)
            Text(error.userMessage)
                .font(.footnote)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            if error.isRetryable {
                Button("重新加载") {
                    Haptics.light()
                    onRetry()
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.small)
            }
        }
        .padding(32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// 统一加载状态包装：Loading / Empty / Error / Content。
public enum LoadableState<Value> {
    case idle
    case loading
    case loaded(Value)
    case failed(AppError)
}

public struct StateContainer<Value, Content: View>: View {
    public let state: LoadableState<Value>
    public var emptyTitle: String = "暂无内容"
    public var emptyHint: String? = nil
    @ViewBuilder public var content: (Value) -> Content

    public var body: some View {
        switch state {
        case .idle, .loading:
            LoadingView()
        case .failed(let error):
            ErrorStateView(error: error) {
                // 重试由外部通过重新 load 触发
            }
        case .loaded(let value):
            content(value)
        }
    }
}

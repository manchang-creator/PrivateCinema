import SwiftUI

/// 通用加载态。
struct LoadingView: View {
    var text = "加载中…"

    var body: some View {
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
struct EmptyStateView: View {
    var icon: String = "sparkles"
    var title: String
    var hint: String? = nil

    var body: some View {
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
struct ErrorStateView: View {
    let error: AppError
    var onRetry: () -> Void

    var body: some View {
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
enum LoadableState<Value> {
    case idle
    case loading
    case loaded(Value)
    case failed(AppError)
}

struct StateContainer<Value, Content: View>: View {
    let state: LoadableState<Value>
    var emptyTitle: String = "暂无内容"
    var emptyHint: String? = nil
    @ViewBuilder var content: (Value) -> Content

    var body: some View {
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

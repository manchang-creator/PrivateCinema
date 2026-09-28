import SwiftUI

/// 下载行操作。
enum DownloadRowAction {
    case togglePause
    case remove
}

/// 下载页：任务列表 + 进度 + 暂停/继续/删除 + 下载设置。
struct DownloadsView: View {
    @Environment(AppEnvironment.self) private var environment

    @AppStorage("download.wifiOnly") private var wifiOnly = true
    @AppStorage("download.autoNext") private var autoDownloadNext = false
    @AppStorage("download.autoDeleteWatched") private var autoDeleteWatched = false

    var body: some View {
        List {
            @Bindable var downloads = environment.downloads

            if downloads.tasks.isEmpty {
                EmptyStateView(
                    icon: "arrow.down.circle",
                    title: "暂无下载任务",
                    hint: "在详情页的下载面板里选择要离线的剧集"
                )
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets())
            } else {
                Section("下载中 / 等待中") {
                    ForEach(downloads.tasks.filter { $0.state != .completed }) { task in
                        DownloadRow(task: task) { action in
                            handle(action, task: task)
                        }
                    }
                }

                Section("已完成") {
                    if downloads.tasks.filter({ $0.state == .completed }).isEmpty {
                        Text("暂无已完成任务")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                    ForEach(downloads.tasks.filter { $0.state == .completed }) { task in
                        DownloadRow(task: task) { action in
                            handle(action, task: task)
                        }
                    }
                }
            }

            Section("下载设置") {
                Toggle("仅 Wi-Fi 下载", isOn: $wifiOnly)
                Toggle("自动下载下一集", isOn: $autoDownloadNext)
                Toggle("看完自动删除", isOn: $autoDeleteWatched)
            }
        }
        .navigationTitle("下载")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("清理已完成") {
                    environment.downloads.clearCompleted()
                }
                .disabled(environment.downloads.tasks.allSatisfy { $0.state != .completed })
            }
        }
    }

    private func handle(_ action: DownloadRowAction, task: DownloadTask) {
        switch action {
        case .togglePause:
            if task.state == .downloading || task.state == .waiting {
                environment.downloads.pause(task)
            } else {
                environment.downloads.resume(task)
            }
            Haptics.light()
        case .remove:
            environment.downloads.remove(task)
        }
    }
}

struct DownloadRow: View {
    let task: DownloadTask
    var onAction: (DownloadRowAction) -> Void

    var body: some View {
        HStack(spacing: 12) {
            PosterImage(url: task.posterURL, width: 40, cornerRadius: 6)

            VStack(alignment: .leading, spacing: 4) {
                Text(task.mediaTitle)
                    .font(.subheadline.weight(.medium))
                    .lineLimit(1)
                Text(task.episodeTitle)
                    .font(.caption)
                    .foregroundStyle(.secondary)

                HStack(spacing: 8) {
                    ProgressView(value: task.progress)
                        .tint(progressTint)
                    Text(stateText)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .frame(width: 56, alignment: .trailing)
                }
            }

            Spacer(minLength: 0)

            Button {
                onAction(.togglePause)
            } label: {
                Image(systemName: toggleIcon)
                    .font(.system(size: 15, weight: .semibold))
            }
            .buttonStyle(.borderless)

            Button {
                onAction(.remove)
            } label: {
                Image(systemName: "trash")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(.red)
            }
            .buttonStyle(.borderless)
        }
        .padding(.vertical, 2)
    }

    private var progressTint: Color {
        switch task.state {
        case .failed: return .red
        case .completed: return .green
        default: return .accentColor
        }
    }

    private var toggleIcon: String {
        switch task.state {
        case .downloading, .waiting: return "pause.circle"
        default: return "play.circle"
        }
    }

    private var stateText: String {
        switch task.state {
        case .waiting: return "等待中"
        case .downloading: return "\(Int(task.progress * 100))%"
        case .paused: return "已暂停"
        case .completed: return "已完成"
        case .failed: return "失败"
        }
    }
}

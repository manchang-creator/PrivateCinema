import SwiftUI

/// 历史记录：按日期分组，支持删除 / 清空 / 继续播放。
struct HistoryView: View {
    @Environment(AppEnvironment.self) private var environment

    @State private var items: [WatchProgress] = []
    @State private var showClearConfirm = false

    var body: some View {
        Group {
            if items.isEmpty {
                EmptyStateView(
                    icon: "clock.arrow.circlepath",
                    title: "还没有观看记录",
                    hint: "看过的内容会出现在这里，随时接着看"
                )
            } else {
                historyList
            }
        }
        .navigationTitle("历史记录")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button(role: .destructive) {
                    showClearConfirm = true
                } label: {
                    Text("清空")
                }
                .disabled(items.isEmpty)
            }
        }
        .confirmationDialog("清空全部观看记录？", isPresented: $showClearConfirm, titleVisibility: .visible) {
            Button("清空历史", role: .destructive) {
                environment.history.clearAll()
                reload()
            }
        }
        .onAppear { reload() }
    }

    private var grouped: [(label: String, items: [WatchProgress])] {
        Dictionary(grouping: items) { $0.lastPlayedAt.historyDayLabel }
            .map { (label: $0.key, items: $0.value) }
            .sorted { lhs, rhs in
                guard let l = lhs.items.first?.lastPlayedAt,
                      let r = rhs.items.first?.lastPlayedAt else { return false }
                return l > r
            }
    }

    private var historyList: some View {
        List {
            ForEach(grouped, id: \.label) { group in
                Section(group.label) {
                    ForEach(group.items) { progress in
                        Button {
                            environment.resumePlayback(progress: progress)
                        } label: {
                            HistoryRow(progress: progress)
                        }
                        .swipeActions(edge: .trailing) {
                            Button(role: .destructive) {
                                environment.history.remove(
                                    mediaId: progress.mediaId,
                                    episodeId: progress.episodeId
                                )
                                reload()
                            } label: {
                                Label("删除", systemImage: "trash")
                            }
                        }
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
    }

    private func reload() {
        items = environment.history.recentHistory()
    }
}

struct HistoryRow: View {
    let progress: WatchProgress

    var body: some View {
        HStack(spacing: 12) {
            PosterImage(url: progress.posterURL, width: 44, cornerRadius: 8)
            VStack(alignment: .leading, spacing: 3) {
                Text(progress.mediaTitle)
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(.primary)
                    .lineLimit(1)
                HStack(spacing: 6) {
                    Text(progress.kind == .movie
                        ? progress.episodeTitle
                        : "第\(progress.episodeIndex)集")
                    Text(progress.position.clockString)
                    if progress.completed {
                        Label("已看完", systemImage: "checkmark.circle")
                    }
                }
                .font(.caption)
                .foregroundStyle(.secondary)

                GeometryReader { proxy in
                    ZStack(alignment: .leading) {
                        Capsule().fill(.quaternary)
                        Capsule().fill(progress.completed ? Color.green : Color.accentColor)
                            .frame(width: proxy.size.width * progress.percent)
                    }
                }
                .frame(height: 3)
            }
            Spacer(minLength: 0)
            Image(systemName: "play.circle")
                .foregroundStyle(.tint)
        }
        .padding(.vertical, 2)
        .contentShape(Rectangle())
    }
}

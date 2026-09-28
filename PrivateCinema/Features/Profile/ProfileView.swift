import SwiftUI

/// 「我的」页：个人中心入口（历史 / 收藏 / 下载 / 媒体源 / 设置）。
struct ProfileView: View {
    @Environment(AppEnvironment.self) private var environment

    @State private var continueCount = 0
    @State private var favoriteCount = 0

    var body: some View {
        NavigationStack {
            List {
                Section {
                    HStack(spacing: 14) {
                        Image(systemName: "person.crop.circle.fill")
                            .font(.system(size: 54))
                            .foregroundStyle(.tint)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(environment.identity.displayName)
                                .font(.title3.weight(.semibold))
                            Text("私人影院 · 本机模式")
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .padding(.vertical, 6)
                }

                Section {
                    statRow
                }

                Section {
                    NavigationLink {
                        HistoryView()
                    } label: {
                        Label("历史记录", systemImage: "clock.arrow.circlepath")
                    }
                    NavigationLink {
                        FavoritesView()
                    } label: {
                        Label("我的收藏", systemImage: "heart")
                    }
                    NavigationLink {
                        DownloadsView()
                    } label: {
                        Label("下载", systemImage: "arrow.down.circle")
                    }
                }

                Section {
                    NavigationLink {
                        SourcesView()
                    } label: {
                        Label("媒体源", systemImage: "server.rack")
                    }
                    NavigationLink {
                        SettingsView()
                    } label: {
                        Label("设置", systemImage: "gearshape")
                    }
                }
            }
            .navigationTitle("我的")
            .navigationDestination(for: MediaRoute.self) { route in
                DetailView(mediaID: route.mediaID)
            }
            .onAppear { refreshCounts() }
        }
    }

    private var statRow: some View {
        HStack {
            statCell("\(continueCount)", "继续观看")
            Divider()
            statCell("\(favoriteCount)", "收藏")
        }
        .frame(height: 58)
    }

    private func statCell(_ value: String, _ title: String) -> some View {
        VStack(spacing: 4) {
            Text(value)
                .font(.title2.weight(.bold))
                .monospacedDigit()
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
    }

    private func refreshCounts() {
        continueCount = environment.history.continueWatching().count
        favoriteCount = environment.favorites.entries(state: .favorite).count
    }
}

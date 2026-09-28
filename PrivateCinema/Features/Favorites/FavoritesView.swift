import SwiftUI

/// 收藏页：想看 / 收藏 / 看过 三种状态。
struct FavoritesView: View {
    @Environment(AppEnvironment.self) private var environment

    @State private var selectedState: FavoriteState = .favorite
    @State private var entries: [FavoriteEntry] = []

    private let columns = [GridItem(.adaptive(minimum: 104), spacing: 14)]

    var body: some View {
        VStack(spacing: 0) {
            Picker("状态", selection: $selectedState) {
                ForEach(FavoriteState.allCases) { state in
                    Text(state.displayName).tag(state)
                }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, 16)
            .padding(.vertical, 8)

            if entries.isEmpty {
                EmptyStateView(
                    icon: selectedState.systemImage,
                    title: "还没有「\(selectedState.displayName)」的内容",
                    hint: "在详情页可以标记想看、收藏或看过"
                )
            } else {
                ScrollView {
                    LazyVGrid(columns: columns, spacing: 18) {
                        ForEach(entries) { entry in
                            NavigationLink(value: MediaRoute(mediaID: entry.media.id)) {
                                PosterCard(item: entry.media)
                            }
                            .buttonStyle(.plain)
                            .contextMenu {
                                ForEach(FavoriteState.allCases.filter { $0 != entry.state }) { state in
                                    Button {
                                        environment.favorites.set(state, media: entry.media)
                                        reload()
                                    } label: {
                                        Label("移到「\(state.displayName)」", systemImage: state.systemImage)
                                    }
                                }
                                Button(role: .destructive) {
                                    environment.favorites.toggle(entry.state, media: entry.media)
                                    reload()
                                } label: {
                                    Label("移除", systemImage: "trash")
                                }
                            }
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                }
            }
        }
        .navigationTitle("我的收藏")
        .navigationDestination(for: MediaRoute.self) { route in
            DetailView(mediaID: route.mediaID)
        }
        .onChange(of: selectedState) { _, _ in reload() }
        .onAppear { reload() }
    }

    private func reload() {
        entries = environment.favorites.entries(state: selectedState)
    }
}

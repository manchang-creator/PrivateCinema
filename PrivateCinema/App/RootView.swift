import SwiftUI

/// 根视图：底部 TabBar（首页 / 发现 / 片库 / 我的）
/// + MiniPlayer 常驻条 + 全屏播放器 cover。
struct RootView: View {
    @Environment(AppEnvironment.self) private var environment

    private enum AppTab: Hashable {
        case home, discover, library, profile
    }

    @State private var selectedTab: AppTab = .home

    var body: some View {
        @Bindable var player = environment.player

        TabView(selection: $selectedTab) {
            HomeView()
                .tabItem { Label("首页", systemImage: "house.fill") }
                .tag(AppTab.home)

            SearchView()
                .tabItem { Label("发现", systemImage: "magnifyingglass") }
                .tag(AppTab.discover)

            LibraryView()
                .tabItem { Label("片库", systemImage: "square.grid.2x2") }
                .tag(AppTab.library)

            ProfileView()
                .tabItem { Label("我的", systemImage: "person.crop.circle") }
                .tag(AppTab.profile)
        }
        .preferredColorScheme(environment.playbackSettings.appearance.colorScheme)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if player.activeRequest != nil && player.fullscreenRequest == nil {
                MiniPlayerBar(manager: player)
                    .animation(.spring(duration: 0.35), value: player.activeRequest?.id)
            }
        }
        .fullScreenCover(item: $player.fullscreenRequest) { request in
            PlayerHostView(request: request)
        }
    }
}

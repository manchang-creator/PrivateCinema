import SwiftUI

/// 首页：欢迎语 + 可配置模块（继续观看 / 收藏 / 最近更新 / 热门…）。
struct HomeView: View {
    @Environment(AppEnvironment.self) private var environment

    @State private var viewModel: HomeViewModel?
    @State private var hiddenModules: Set<HomeModule> = HomeModule.loadHidden()

    var body: some View {
        NavigationStack {
            Group {
                if let viewModel {
                    content(viewModel)
                } else {
                    LoadingView()
                }
            }
            .navigationTitle("今天想看什么？")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    NavigationLink(value: HomeSearchRoute()) {
                        Image(systemName: "magnifyingglass")
                    }
                    .accessibilityLabel("搜索")
                }
            }
            .navigationDestination(for: MediaRoute.self) { route in
                DetailView(mediaID: route.mediaID)
            }
            .navigationDestination(for: HomeSearchRoute.self) { _ in
                SearchView()
            }
            .task {
                if viewModel == nil {
                    let vm = HomeViewModel()
                    viewModel = vm
                    await vm.load(environment: environment)
                }
            }
            .refreshable {
                await viewModel?.load(environment: environment)
            }
            .onChange(of: hiddenModules) { _, newValue in
                HomeModule.saveHidden(newValue)
            }
        }
    }

    // MARK: - 内容

    @ViewBuilder
    private func content(_ viewModel: HomeViewModel) -> some View {
        switch viewModel.state {
        case .idle, .loading:
            LoadingView()
        case .failed(let error):
            ErrorStateView(error: error) {
                Task { await viewModel.load(environment: environment) }
            }
        case .loaded(let payload):
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 26) {
                    if !payload.continueWatching.isEmpty
                        && !hiddenModules.contains(.continueWatching) {
                        VStack(alignment: .leading, spacing: 10) {
                            SectionHeader(title: "继续观看")
                            ScrollView(.horizontal, showsIndicators: false) {
                                LazyHStack(spacing: 14) {
                                    ForEach(payload.continueWatching) { progress in
                                        ContinueWatchingCard(progress: progress) {
                                            environment.resumePlayback(progress: progress)
                                        }
                                    }
                                }
                                .padding(.horizontal, 16)
                                .padding(.vertical, 2)
                            }
                        }
                    }

                    if !payload.favoriteItems.isEmpty
                        && !hiddenModules.contains(.favorites) {
                        MediaRow(title: "我的收藏", items: payload.favoriteItems)
                    }

                    ForEach(visibleSections(payload)) { section in
                        MediaRow(
                            title: section.title,
                            items: section.items,
                            badgeProvider: { payload.badges[$0.id] }
                        )
                    }
                }
                .padding(.vertical, 8)
            }
        }
    }

    private func visibleSections(_ payload: HomeViewModel.Payload) -> [HomeSection] {
        payload.sections.compactMap { section -> HomeSection? in
            // 无对应模块（或模块被隐藏）的 section 不展示
            if let module = HomeModule(sectionId: section.id),
               hiddenModules.contains(module) {
                return nil
            }
            guard !section.items.isEmpty else { return nil }
            return section
        }
    }
}

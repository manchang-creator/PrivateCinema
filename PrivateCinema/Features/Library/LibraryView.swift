import SwiftUI

/// 片库：分类 Segment + 网格/列表 + 排序与筛选。
struct LibraryView: View {
    @Environment(AppEnvironment.self) private var environment

    @State private var viewModel: LibraryViewModel?
    @State private var showFilters = false

    private let gridColumns = [GridItem(.adaptive(minimum: 104), spacing: 14)]

    var body: some View {
        Group {
            if let viewModel {
                content(viewModel)
            } else {
                LoadingView()
            }
        }
        .task {
            if viewModel == nil {
                let vm = LibraryViewModel()
                viewModel = vm
                await vm.load(environment: environment)
            }
        }
    }

    @ViewBuilder
    private func content(_ viewModel: LibraryViewModel) -> some View {
        @Bindable var viewModel = viewModel

        NavigationStack {
            Group {
                switch viewModel.state {
                case .idle, .loading:
                    LoadingView()
                case .failed(let error):
                    ErrorStateView(error: error) {
                        Task { await viewModel.load(environment: environment, reload: true) }
                    }
                case .loaded(let items):
                    itemsList(viewModel, items: items)
                }
            }
            .navigationTitle("片库")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        showFilters = true
                    } label: {
                        Image(systemName: viewModel.watchStateFilter == .any
                            ? "line.3.horizontal.decrease.circle"
                            : "line.3.horizontal.decrease.circle.fill")
                    }
                    .accessibilityLabel("筛选观看状态")
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Picker("排序", selection: $viewModel.sort) {
                            ForEach(LibrarySort.allCases) { sort in
                                Text(sort.displayName).tag(sort)
                            }
                        }
                    } label: {
                        Image(systemName: "arrow.up.arrow.down")
                    }
                    .accessibilityLabel("排序")
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        viewModel.setGridMode(!viewModel.isGridMode)
                        Haptics.light()
                    } label: {
                        Image(systemName: viewModel.isGridMode
                            ? "list.bullet"
                            : "square.grid.2x2")
                    }
                    .accessibilityLabel(viewModel.isGridMode ? "列表模式" : "网格模式")
                }
            }
            .navigationDestination(for: MediaRoute.self) { route in
                DetailView(mediaID: route.mediaID)
            }
            .sheet(isPresented: $showFilters) {
                LibraryFilterSheet(filter: $viewModel.watchStateFilter)
            }
            .onChange(of: viewModel.kind) { _, _ in
                Task { await viewModel.load(environment: environment, reload: true) }
            }
        }
    }

    @ViewBuilder
    private func itemsList(_ viewModel: LibraryViewModel, items: [MediaItem]) -> some View {
        VStack(spacing: 0) {
            Picker("分类", selection: Binding(
                get: { viewModel.kind },
                set: { viewModel.kind = $0 }
            )) {
                Text("全部").tag(MediaKind?.none)
                ForEach(MediaKind.allCases) { kind in
                    Text(kind.displayName).tag(MediaKind?.some(kind))
                }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, 16)
            .padding(.vertical, 8)

            if items.isEmpty {
                EmptyStateView(
                    icon: "square.grid.2x2",
                    title: "片库还是空的",
                    hint: "去媒体源添加内容，或稍后再来看看"
                )
            } else if viewModel.isGridMode {
                ScrollView {
                    LazyVGrid(columns: gridColumns, spacing: 18) {
                        ForEach(items) { item in
                            NavigationLink(value: MediaRoute(mediaID: item.id)) {
                                PosterCard(item: item, badge: badge(for: item, viewModel: viewModel))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                }
            } else {
                ScrollView {
                    LazyVStack(spacing: 12) {
                        ForEach(items) { item in
                            NavigationLink(value: MediaRoute(mediaID: item.id)) {
                                LibraryListRow(item: item, summary: viewModel.watchInfo[item.id])
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                }
            }
        }
    }

    private func badge(for item: MediaItem, viewModel: LibraryViewModel) -> String? {
        guard let index = viewModel.watchInfo[item.id]?.currentEpisodeIndex else { return nil }
        return "看到第\(index)集"
    }
}

/// 列表模式行。
struct LibraryListRow: View {
    let item: MediaItem
    let summary: LibraryViewModel.WatchSummary?

    var body: some View {
        HStack(spacing: 12) {
            PosterImage(url: item.posterURL, width: 52, cornerRadius: 8)
            VStack(alignment: .leading, spacing: 4) {
                Text(item.title)
                    .font(.subheadline.weight(.medium))
                    .lineLimit(1)
                Text([item.metaLine, item.remark].filter { !$0.isEmpty }.joined(separator: " · "))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                if let index = summary?.currentEpisodeIndex {
                    Text("看到第\(index)集")
                        .font(.caption2)
                        .foregroundStyle(.tint)
                }
            }
            Spacer()
            if item.rating > 0 {
                Text(item.ratingText)
                    .font(.caption.monospacedDigit().weight(.semibold))
                    .foregroundStyle(.secondary)
            }
        }
        .padding(10)
        .background(.quaternary.opacity(0.4), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .contentShape(Rectangle())
    }
}

struct LibraryFilterSheet: View {
    @Binding var filter: WatchStateFilter
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                ForEach(WatchStateFilter.allCases) { state in
                    Button {
                        filter = state
                        dismiss()
                    } label: {
                        HStack {
                            Text(state.displayName)
                            Spacer()
                            if filter == state {
                                Image(systemName: "checkmark").foregroundStyle(.tint)
                            }
                        }
                    }
                }
            }
            .navigationTitle("观看状态")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("完成") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium])
    }
}

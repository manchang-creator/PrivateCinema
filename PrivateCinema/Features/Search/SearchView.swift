import SwiftUI

/// 发现 / 搜索页：Spotlight 风格搜索 + 类型快筛 + 筛选面板 + 海报网格。
struct SearchView: View {
    @Environment(AppEnvironment.self) private var environment

    @State private var viewModel: SearchViewModel?
    @State private var showFilters = false

    private let columns = [
        GridItem(.adaptive(minimum: 104), spacing: 14),
    ]

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
                let vm = SearchViewModel(environment: environment)
                viewModel = vm
                await vm.search()
            }
        }
    }

    // MARK: - 内容

    @ViewBuilder
    private func content(_ viewModel: SearchViewModel) -> some View {
        @Bindable var viewModel = viewModel

        NavigationStack {
            Group {
                switch viewModel.state {
                case .idle, .loading:
                    LoadingView(text: viewModel.query.isEmpty ? "正在准备片库…" : "搜索中…")
                case .failed(let error):
                    ErrorStateView(error: error) {
                        Task { await viewModel.search() }
                    }
                case .loaded(let items):
                    resultsGrid(viewModel, items: items)
                }
            }
            .navigationTitle("发现")
            .searchable(
                text: $viewModel.query,
                placement: .navigationBarDrawer(displayMode: .always),
                prompt: "搜索电影、电视剧、演员"
            )
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        showFilters = true
                    } label: {
                        Image(systemName: viewModel.filters.isEmpty
                            ? "line.3.horizontal.decrease.circle"
                            : "line.3.horizontal.decrease.circle.fill")
                    }
                    .accessibilityLabel("筛选")
                }
            }
            .navigationDestination(for: MediaRoute.self) { route in
                DetailView(mediaID: route.mediaID)
            }
            .sheet(isPresented: $showFilters) {
                FilterSheet(filters: $viewModel.filters)
            }
        }
    }

    @ViewBuilder
    private func resultsGrid(_ viewModel: SearchViewModel, items: [MediaItem]) -> some View {
        ScrollView {
            if items.isEmpty {
                EmptyStateView(
                    icon: "magnifyingglass",
                    title: "没有找到相关内容",
                    hint: "换个关键词，或放宽筛选条件试试"
                )
            } else {
                LazyVStack(alignment: .leading, spacing: 14) {
                    kindChips(viewModel)
                    LazyVGrid(columns: columns, spacing: 18) {
                        ForEach(items) { item in
                            NavigationLink(value: MediaRoute(mediaID: item.id)) {
                                PosterCard(item: item)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal, 16)
                }
                .padding(.vertical, 8)
            }
        }
    }

    private func kindChips(_ viewModel: SearchViewModel) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                chip("全部", selected: viewModel.filters.kinds.isEmpty) {
                    viewModel.filters.kinds = []
                }
                ForEach(MediaKind.allCases) { kind in
                    chip(kind.displayName, selected: viewModel.filters.kinds == [kind]) {
                        viewModel.filters.kinds = viewModel.filters.kinds == [kind] ? [] : [kind]
                    }
                }
            }
            .padding(.horizontal, 16)
        }
    }

    private func chip(_ text: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button {
            Haptics.selection()
            action()
        } label: {
            Text(text)
                .font(.footnote.weight(.medium))
                .padding(.horizontal, 14)
                .padding(.vertical, 7)
                .background(
                    selected ? AnyShapeStyle(.tint) : AnyShapeStyle(.quaternary.opacity(0.6)),
                    in: Capsule()
                )
                .foregroundStyle(selected ? .white : .primary)
        }
        .buttonStyle(.plain)
    }
}

/// 筛选面板。
struct FilterSheet: View {
    @Binding var filters: SearchFilters
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section("类型") {
                    ForEach(MediaKind.allCases) { kind in
                        Toggle(kind.displayName, isOn: Binding(
                            get: { filters.kinds.contains(kind) },
                            set: { on in
                                if on { filters.kinds.insert(kind) }
                                else { filters.kinds.remove(kind) }
                            }
                        ))
                    }
                }

                Section("年代") {
                    Picker("年代", selection: yearBinding) {
                        ForEach(SearchViewModel.yearRanges, id: \.0) { range in
                            Text(range.0).tag(range.0)
                        }
                    }
                }

                Section("地区") {
                    ForEach(SearchViewModel.areas, id: \.self) { area in
                        Toggle(area, isOn: Binding(
                            get: { filters.areas.contains(area) },
                            set: { on in
                                if on { filters.areas.append(area) }
                                else { filters.areas.removeAll { $0 == area } }
                            }
                        ))
                    }
                }

                Section("题材") {
                    ForEach(SearchViewModel.genres, id: \.self) { genre in
                        Toggle(genre, isOn: Binding(
                            get: { filters.genres.contains(genre) },
                            set: { on in
                                if on { filters.genres.append(genre) }
                                else { filters.genres.removeAll { $0 == genre } }
                            }
                        ))
                    }
                }

                Section("规格") {
                    ForEach(SpecFlag.allCases) { flag in
                        Toggle(flag.displayName, isOn: Binding(
                            get: { filters.requiredSpecs.contains(flag) },
                            set: { on in
                                if on { filters.requiredSpecs.insert(flag) }
                                else { filters.requiredSpecs.remove(flag) }
                            }
                        ))
                    }
                }

                Section("其他") {
                    Picker("评分", selection: ratingBinding) {
                        ForEach(SearchViewModel.ratingSteps, id: \.0) { step in
                            Text(step.0).tag(step.0)
                        }
                    }
                    Toggle("只看已完结", isOn: $filters.finishedOnly)
                }
            }
            .navigationTitle("筛选")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("重置") {
                        filters = .none
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("完成") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private var yearBinding: Binding<String> {
        Binding(
            get: {
                SearchViewModel.yearRanges.first { $0.1 == filters.yearRange }?.0 ?? "全部年代"
            },
            set: { label in
                filters.yearRange = SearchViewModel.yearRanges
                    .first { $0.0 == label }?.1
            }
        )
    }

    private var ratingBinding: Binding<String> {
        Binding(
            get: {
                SearchViewModel.ratingSteps.first { $0.1 == filters.ratingMin }?.0 ?? "不限评分"
            },
            set: { label in
                filters.ratingMin = SearchViewModel.ratingSteps
                    .first { $0.0 == label }?.1
            }
        )
    }
}

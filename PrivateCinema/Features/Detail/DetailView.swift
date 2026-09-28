import SwiftUI

/// 影视详情页：大图 Backdrop + 信息 + 选集 + 简介 / 演员 / 剧照 / 相关推荐。
struct DetailView: View {
    @Environment(AppEnvironment.self) private var environment

    let mediaID: String

    @State private var viewModel: DetailViewModel?
    @State private var showDownloadSheet = false

    var body: some View {
        Group {
            if let viewModel {
                content(viewModel)
            } else {
                LoadingView()
            }
        }
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(.hidden, for: .navigationBar)
        .task {
            if viewModel == nil {
                let vm = DetailViewModel()
                viewModel = vm
                await vm.load(mediaID: mediaID, environment: environment)
            }
        }
        .onAppear {
            // 从播放器返回后刷新进度状态
            Task { await viewModel?.load(mediaID: mediaID, environment: environment) }
        }
    }

    // MARK: - 内容

    @ViewBuilder
    private func content(_ viewModel: DetailViewModel) -> some View {
        switch viewModel.state {
        case .idle, .loading:
            LoadingView()
        case .failed(let error):
            ErrorStateView(error: error) {
                Task { await viewModel.load(mediaID: mediaID, environment: environment) }
            }
        case .loaded(let detail):
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    hero(detail: detail, viewModel: viewModel)
                    actionButtons(detail: detail, viewModel: viewModel)
                    if !detail.allEpisodes.isEmpty {
                        episodeSection(detail: detail, viewModel: viewModel)
                    }
                    overviewSection(detail.item)
                    castSection(detail.item)
                    if !detail.item.stillImageURLs.isEmpty {
                        stillsSection(detail.item)
                    }
                    specSection(detail.item)
                    if !detail.related.isEmpty {
                        relatedSection(detail.related)
                    }
                }
                .padding(.bottom, 40)
            }
            .ignoresSafeArea(edges: .top)
            .sheet(isPresented: $showDownloadSheet) {
                DownloadPickerSheet(viewModel: viewModel)
            }
        }
    }

    // MARK: - Hero

    private func hero(detail: MediaDetail, viewModel: DetailViewModel) -> some View {
        let item = detail.item
        return ZStack(alignment: .bottomLeading) {
            CachedImage(url: item.backdropURL ?? item.posterURL) {
                Rectangle().fill(.quaternary)
            }
            .frame(height: 320)
            .frame(maxWidth: .infinity)
            .clipped()

            LinearGradient(
                colors: [.clear, .black.opacity(0.65)],
                startPoint: .center, endPoint: .bottom
            )

            HStack(alignment: .bottom, spacing: 14) {
                PosterImage(url: item.posterURL, width: 108)
                    .shadow(color: .black.opacity(0.4), radius: 10, y: 4)

                VStack(alignment: .leading, spacing: 5) {
                    Text(item.title)
                        .font(.title2.weight(.bold))
                        .foregroundStyle(.white)
                        .lineLimit(2)
                    Text([item.metaLine, item.area, item.ratingText].joined(separator: " · "))
                        .font(.caption)
                        .foregroundStyle(.white.opacity(0.85))
                    if !item.remark.isEmpty {
                        Text(item.remark)
                            .font(.caption2.weight(.medium))
                            .foregroundStyle(.white)
                            .padding(.horizontal, 7)
                            .padding(.vertical, 2)
                            .background(.tint.opacity(0.9), in: Capsule())
                    }
                }
                .padding(.bottom, 2)
            }
            .padding(16)
        }
    }

    // MARK: - 操作按钮

    private func actionButtons(detail: MediaDetail, viewModel: DetailViewModel) -> some View {
        VStack(spacing: 12) {
            Button {
                if let target = viewModel.resumeTarget {
                    Haptics.medium()
                    viewModel.play(episode: target, environment: environment)
                }
            } label: {
                Label(
                    viewModel.resumePositions.values.isEmpty == false && viewModel.currentEpisodeID != nil
                        ? "继续播放" : "播放",
                    systemImage: "play.fill"
                )
                .font(.headline)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 6)
            }
            .buttonStyle(.borderedProminent)
            .disabled(viewModel.resumeTarget == nil)

            HStack(spacing: 10) {
                actionTile(
                    icon: viewModel.favoriteState == .favorite ? "heart.fill" : "heart",
                    title: "收藏",
                    active: viewModel.favoriteState == .favorite
                ) {
                    viewModel.toggleFavoriteState(.favorite, environment: environment)
                }
                actionTile(
                    icon: viewModel.favoriteState == .wantToWatch ? "clock.fill" : "clock",
                    title: "想看",
                    active: viewModel.favoriteState == .wantToWatch
                ) {
                    viewModel.toggleFavoriteState(.wantToWatch, environment: environment)
                }
                actionTile(
                    icon: viewModel.favoriteState == .watched ? "eye.fill" : "eye",
                    title: "看过",
                    active: viewModel.favoriteState == .watched
                ) {
                    viewModel.toggleFavoriteState(.watched, environment: environment)
                }
                actionTile(icon: "arrow.down.circle", title: "下载", active: false) {
                    showDownloadSheet = true
                }
            }
        }
        .padding(.horizontal, 16)
    }

    private func actionTile(
        icon: String,
        title: String,
        active: Bool,
        action: @escaping () -> Void
    ) -> some View {
        Button {
            Haptics.light()
            action()
        } label: {
            VStack(spacing: 5) {
                Image(systemName: icon)
                    .font(.system(size: 17, weight: .medium))
                Text(title)
                    .font(.caption2)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 10)
            .foregroundStyle(active ? Color.white : Color.primary)
            .background(
                active ? AnyShapeStyle(.tint) : AnyShapeStyle(.quaternary.opacity(0.6)),
                in: RoundedRectangle(cornerRadius: 12, style: .continuous)
            )
        }
        .buttonStyle(.plain)
    }

    // MARK: - 选集

    private func episodeSection(detail: MediaDetail, viewModel: DetailViewModel) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("选集")
                    .font(.title3.weight(.semibold))
                Spacer()
                if detail.allEpisodes.count > 1 {
                    Text("共\(detail.allEpisodes.count)集")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            .padding(.horizontal, 16)

            let episodes = detail.episodesBySeason[viewModel.selectedSeasonIndex]
                ?? detail.allEpisodes
            let columns = [GridItem(.adaptive(minimum: 64), spacing: 10)]

            LazyVGrid(columns: columns, spacing: 10) {
                ForEach(episodes) { episode in
                    EpisodeChip(
                        episode: episode,
                        isWatched: viewModel.watchedEpisodeIDs.contains(episode.id),
                        isCurrent: viewModel.currentEpisodeID == episode.id,
                        downloadState: viewModel.downloadStates[episode.id]
                    ) {
                        Haptics.medium()
                        viewModel.play(episode: episode, environment: environment)
                    }
                }
            }
            .padding(.horizontal, 16)
        }
    }

    // MARK: - 文本区

    private func overviewSection(_ item: MediaItem) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("剧情简介")
                .font(.title3.weight(.semibold))
                .padding(.horizontal, 16)
            Text(item.overview)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .lineSpacing(4)
                .padding(.horizontal, 16)
        }
    }

    private func castSection(_ item: MediaItem) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("演职员")
                .font(.title3.weight(.semibold))
                .padding(.horizontal, 16)
            ScrollView(.horizontal, showsIndicators: false) {
                LazyHStack(spacing: 16) {
                    ForEach(item.directors + item.cast) { person in
                        VStack(spacing: 6) {
                            Image(systemName: "person.crop.circle.fill")
                                .font(.system(size: 44))
                                .foregroundStyle(.quaternary)
                            Text(person.name)
                                .font(.caption.weight(.medium))
                                .lineLimit(1)
                            Text(person.role)
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                        .frame(width: 64)
                    }
                }
                .padding(.horizontal, 16)
            }
        }
    }

    private func stillsSection(_ item: MediaItem) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("剧照")
                .font(.title3.weight(.semibold))
                .padding(.horizontal, 16)
            ScrollView(.horizontal, showsIndicators: false) {
                LazyHStack(spacing: 10) {
                    ForEach(item.stillImageURLs, id: \.self) { url in
                        BackdropImage(url: url, cornerRadius: 10)
                            .frame(width: 200)
                    }
                }
                .padding(.horizontal, 16)
            }
        }
    }

    private func specSection(_ item: MediaItem) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("视频规格")
                .font(.title3.weight(.semibold))
                .padding(.horizontal, 16)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    if item.specs.is4K { specChip("4K UHD") }
                    if item.specs.isHEVC { specChip("HEVC") }
                    if item.specs.isHDR { specChip("HDR") }
                    if item.specs.isDolbyVision { specChip("Dolby Vision") }
                    if item.specs.isDolbyAtmos { specChip("Dolby Atmos") }
                    specChip(String(format: "%.3g FPS", item.specs.fps))
                }
                .padding(.horizontal, 16)
            }
        }
    }

    private func specChip(_ text: String) -> some View {
        Text(text)
            .font(.caption.weight(.medium))
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(.quaternary.opacity(0.6), in: Capsule())
    }

    private func relatedSection(_ related: [MediaItem]) -> some View {
        MediaRow(title: "相关推荐", items: related)
    }
}

/// 选集格子：✓ 已看完 / ▶ 当前 / 数字未看。
struct EpisodeChip: View {
    let episode: Episode
    let isWatched: Bool
    let isCurrent: Bool
    let downloadState: DownloadState?
    var onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            VStack(spacing: 3) {
                ZStack {
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .fill(fillStyle)
                    content
                }
                .frame(height: 52)
                Text(episode.title)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
        .buttonStyle(.plain)
    }

    private var fillStyle: AnyShapeStyle {
        if isCurrent {
            return AnyShapeStyle(.tint.opacity(0.85))
        }
        if isWatched {
            return AnyShapeStyle(.quaternary.opacity(0.4))
        }
        return AnyShapeStyle(.quaternary.opacity(0.7))
    }

    @ViewBuilder
    private var content: some View {
        if isWatched {
            Image(systemName: "checkmark")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(.secondary)
        } else if isCurrent {
            Image(systemName: "play.fill")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(.white)
        } else {
            Text(String(format: "%02d", episode.index))
                .font(.callout.monospacedDigit().weight(.medium))
                .foregroundStyle(.primary)
        }
    }
}

/// 下载选集面板。
struct DownloadPickerSheet: View {
    @Bindable var viewModel: DetailViewModel
    @Environment(AppEnvironment.self) private var environment
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                if case .loaded(let detail) = viewModel.state {
                    Section {
                        Button("下载全部") {
                            viewModel.downloadAll(environment: environment)
                            dismiss()
                        }
                    }
                    Section("剧集") {
                        ForEach(detail.allEpisodes) { episode in
                            HStack {
                                Text(episode.displayTitle)
                                Spacer()
                                downloadBadge(for: episode)
                            }
                        }
                    }
                }
            }
            .navigationTitle("选择下载")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("完成") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    @ViewBuilder
    private func downloadBadge(for episode: Episode) -> some View {
        switch viewModel.downloadStates[episode.id] {
        case .completed:
            Image(systemName: "checkmark.circle.fill")
                .foregroundStyle(.green)
        case .downloading, .waiting:
            Text("已加入")
                .font(.caption)
                .foregroundStyle(.secondary)
        default:
            Button {
                viewModel.download(episode: episode, environment: environment)
            } label: {
                Image(systemName: "arrow.down.circle")
            }
            .buttonStyle(.borderless)
        }
    }
}

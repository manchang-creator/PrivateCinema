import SwiftUI

/// 海报卡片（首页 / 搜索 / 片库网格通用）。
struct PosterCard: View {
    let item: MediaItem
    /// 左上角角标（如"看到第8集"）
    var badge: String? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            PosterImage(url: item.posterURL)
                .overlay(alignment: .topLeading) {
                    if let badge {
                        Text(badge)
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(.white)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 3)
                            .background(.tint.opacity(0.9), in: Capsule())
                            .padding(6)
                    }
                }
                .overlay(alignment: .bottomTrailing) {
                    if item.rating > 0 {
                        Text(item.ratingText)
                            .font(.caption2.monospacedDigit().weight(.semibold))
                            .foregroundStyle(.white)
                            .padding(.horizontal, 5)
                            .padding(.vertical, 2)
                            .background(.black.opacity(0.55), in: Capsule())
                            .padding(6)
                    }
                }

            Text(item.title)
                .font(.footnote.weight(.medium))
                .lineLimit(1)

            Text(item.remark.isEmpty ? item.metaLine : item.remark)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
        .contentShape(Rectangle())
        // UI 测试定位海报入口用
        .accessibilityIdentifier("poster-card")
    }
}

/// 横向滚动媒体行（首页模块）。
struct MediaRow: View {
    let title: String
    let items: [MediaItem]
    var badgeProvider: (MediaItem) -> String? = { _ in nil }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHeader(title: title)

            ScrollView(.horizontal, showsIndicators: false) {
                LazyHStack(spacing: 12) {
                    ForEach(items) { item in
                        NavigationLink(value: MediaRoute(mediaID: item.id)) {
                            PosterCard(item: item, badge: badgeProvider(item))
                                .frame(width: 118)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 2)
            }
        }
    }
}

/// 模块标题行。
struct SectionHeader: View {
    let title: String

    var body: some View {
        HStack {
            Text(title)
                .font(.title3.weight(.semibold))
            Spacer()
        }
        .padding(.horizontal, 16)
    }
}

/// 继续观看大卡片（Infuse / Apple TV 风格）。
struct ContinueWatchingCard: View {
    let progress: WatchProgress
    var onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            VStack(alignment: .leading, spacing: 8) {
                ZStack {
                    CachedImage(url: progress.backdropURL ?? progress.posterURL) {
                        Rectangle().fill(.quaternary.opacity(0.5))
                    }
                    .aspectRatio(16 / 9, contentMode: .fill)
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))

                    Image(systemName: "play.circle.fill")
                        .font(.system(size: 42))
                        .foregroundStyle(.white.opacity(0.92))
                        .shadow(radius: 6)
                }
                .overlay(alignment: .bottom) {
                    GeometryReader { proxy in
                        ZStack(alignment: .leading) {
                            Capsule().fill(.white.opacity(0.3))
                            Capsule().fill(.tint)
                                .frame(width: proxy.size.width * progress.percent)
                        }
                    }
                    .frame(height: 3)
                    .padding(.horizontal, 10)
                    .padding(.bottom, 8)
                }

                VStack(alignment: .leading, spacing: 2) {
                    Text(progress.mediaTitle)
                        .font(.footnote.weight(.semibold))
                        .lineLimit(1)
                    HStack(spacing: 6) {
                        Text(progress.kind == .movie
                            ? "\(progress.episodeTitle)"
                            : "第\(progress.episodeIndex)集")
                        Text("\(progress.position.clockString) / \(progress.duration.clockString)")
                        Text(progress.percentText)
                            .foregroundStyle(.tint)
                    }
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                }
            }
            .frame(width: 230)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

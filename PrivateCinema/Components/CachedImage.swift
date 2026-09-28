import SwiftUI

/// 磁盘 + 内存缓存的图片视图。全项目图片加载统一入口。
struct CachedImage<Placeholder: View>: View {
    let url: URL?
    @ViewBuilder var placeholder: () -> Placeholder

    @State private var image: UIImage?
    @State private var failed = false

    var body: some View {
        Group {
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
            } else if failed {
                placeholder()
            } else {
                placeholder()
                    .overlay {
                        ProgressView().controlSize(.mini)
                    }
            }
        }
        .task(id: url) {
            failed = false
            image = await ImageLoader.shared.image(for: url)
            failed = (image == nil)
        }
    }
}

/// 海报视图（2:3）。
struct PosterImage: View {
    let url: URL?
    var width: CGFloat? = nil
    var height: CGFloat? = nil
    var cornerRadius: CGFloat = 12

    var body: some View {
        CachedImage(url: url) {
            ZStack {
                Rectangle().fill(.quaternary.opacity(0.5))
                Image(systemName: "film")
                    .foregroundStyle(.secondary)
            }
        }
        .aspectRatio(2 / 3, contentMode: .fit)
        .frame(width: width, height: height)
        .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
    }
}

/// 横幅背景图（16:9）。
struct BackdropImage: View {
    let url: URL?
    var cornerRadius: CGFloat = 12

    var body: some View {
        CachedImage(url: url) {
            ZStack {
                Rectangle().fill(.quaternary.opacity(0.5))
                Image(systemName: "photo")
                    .foregroundStyle(.secondary)
            }
        }
        .aspectRatio(16 / 9, contentMode: .fill)
        .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
    }
}

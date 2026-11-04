import SwiftUI

/// 磁盘 + 内存缓存的图片视图。全项目图片加载统一入口。
public struct CachedImage<Placeholder: View>: View {
    /// 跨模块构造入口（memberwise init 对 public struct 仍是 internal）。
    public init(url: URL?, @ViewBuilder placeholder: @escaping () -> Placeholder) {
        self.url = url
        self.placeholder = placeholder
    }

    public let url: URL?
    @ViewBuilder public var placeholder: () -> Placeholder

    @State private var image: UIImage?
    @State private var failed = false

    public var body: some View {
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
public struct PosterImage: View {
    /// 跨模块构造入口。
    public init(url: URL?, width: CGFloat? = nil, height: CGFloat? = nil, cornerRadius: CGFloat = 12) {
        self.url = url
        self.width = width
        self.height = height
        self.cornerRadius = cornerRadius
    }

    public let url: URL?
    public var width: CGFloat? = nil
    public var height: CGFloat? = nil
    public var cornerRadius: CGFloat = 12

    public var body: some View {
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
public struct BackdropImage: View {
    /// 跨模块构造入口。
    public init(url: URL?, cornerRadius: CGFloat = 12) {
        self.url = url
        self.cornerRadius = cornerRadius
    }

    public let url: URL?
    public var cornerRadius: CGFloat = 12

    public var body: some View {
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

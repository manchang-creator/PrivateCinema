import CryptoKit
import Foundation
import UIKit

/// 图片加载器：内存缓存 + 磁盘缓存 + 后台下载。
/// 所有页面通过 `CachedImage` / `PosterImage` 使用它，不直接写 AsyncImage。
actor ImageLoader {
    static let shared = ImageLoader()

    private let memoryCache = NSCache<NSString, UIImage>()
    private let diskDirectory: URL

    private init() {
        let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        diskDirectory = caches.appendingPathComponent("ImageCache", isDirectory: true)
        try? FileManager.default.createDirectory(at: diskDirectory, withIntermediateDirectories: true)
        memoryCache.countLimit = 300
    }

    func image(for url: URL?) async -> UIImage? {
        guard let url else { return nil }
        let key = Self.cacheKey(for: url)

        if let cached = memoryCache.object(forKey: key as NSString) {
            return cached
        }

        let diskURL = diskDirectory.appendingPathComponent(key)
        if let data = try? Data(contentsOf: diskURL),
           let image = UIImage(data: data) {
            memoryCache.setObject(image, forKey: key as NSString)
            return image
        }

        do {
            let (data, response) = try await URLSession.shared.data(from: url)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200,
                  let image = UIImage(data: data) else {
                return nil
            }
            memoryCache.setObject(image, forKey: key as NSString)
            try? data.write(to: diskURL, options: .atomic)
            return image
        } catch {
            return nil
        }
    }

    func clearCache() async {
        memoryCache.removeAllObjects()
        try? FileManager.default.removeItem(at: diskDirectory)
        try? FileManager.default.createDirectory(at: diskDirectory, withIntermediateDirectories: true)
    }

    var diskCacheSize: Int {
        (try? FileManager.default.contentsOfDirectory(at: diskDirectory, includingPropertiesForKeys: [.fileSizeKey]))?
            .reduce(0) { sum, url in
                sum + (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0)
            } ?? 0
    }

    private static func cacheKey(for url: URL) -> String {
        let digest = SHA256.hash(data: Data(url.absoluteString.utf8))
        return digest.map { String(format: "%02x", $0) }.joined()
    }
}

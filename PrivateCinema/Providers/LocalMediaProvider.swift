import AVFoundation
import Foundation

/// 本地媒体库 Provider：扫描 App 文档目录下的 `MediaLibrary` 文件夹，
/// 将其中的视频文件（mp4 / m4v / mov）作为电影条目呈现。
/// 把文件通过"文件"App 或 iTunes 文件共享放入该目录即可在片库看到。
struct LocalMediaProvider: MediaProvider {

    let info = ProviderInfo(
        id: "local",
        name: "本机媒体库",
        kind: .local,
        description: "扫描本机 Documents/MediaLibrary 目录"
    )

    static var mediaDirectory: URL {
        let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let dir = documents.appendingPathComponent("MediaLibrary", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    private static let extensions = ["mp4", "m4v", "mov"]

    private struct LocalFile {
        let url: URL
        let name: String
    }

    private func scanFiles() -> [LocalFile] {
        let contents = (try? FileManager.default.contentsOfDirectory(
            at: Self.mediaDirectory,
            includingPropertiesForKeys: [.isRegularFileKey]
        )) ?? []
        return contents
            .filter { Self.extensions.contains($0.pathExtension.lowercased()) }
            .map { LocalFile(url: $0, name: $0.deletingPathExtension().lastPathComponent) }
            .sorted { $0.name < $1.name }
    }

    private func item(for file: LocalFile, index: Int) -> MediaItem {
        MediaItem(
            id: "local-\(index)-\(file.name)",
            title: file.name,
            kind: .movie,
            year: Calendar.current.component(.year, from: (try? file.url.resourceValues(forKeys: [.creationDateKey]).creationDate) ?? .now),
            area: "本地",
            language: "未知",
            genres: ["本地文件"],
            rating: 0,
            durationMinutes: 0,
            overview: "本地视频文件：\(file.url.lastPathComponent)",
            posterURL: nil,
            backdropURL: nil,
            remark: "本地",
            isFinished: true,
            specs: MediaSpecs(),
            stillImageURLs: [],
            updatedAt: (try? file.url.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .now
        )
    }

    private func episode(for file: LocalFile, index: Int) -> Episode {
        Episode(
            id: "local-\(index)-\(file.name)#ep1",
            mediaId: "local-\(index)-\(file.name)",
            seasonIndex: 1,
            index: 1,
            title: file.name,
            duration: 0,
            stillURL: nil,
            remark: "本地"
        )
    }

    // MARK: - MediaProvider

    func home() async throws -> HomeData {
        let files = scanFiles()
        guard !files.isEmpty else { return HomeData(sections: []) }
        let items = files.enumerated().map { item(for: $0.element, index: $0.offset) }
        return HomeData(sections: [HomeSection(id: "local", title: "本机视频", items: items)])
    }

    func search(keyword: String, filters: SearchFilters) async throws -> [MediaItem] {
        let files = scanFiles()
        let items = files.enumerated().map { item(for: $0.element, index: $0.offset) }
        guard !keyword.isEmpty else { return items }
        return items.filter { $0.title.localizedCaseInsensitiveContains(keyword) }
    }

    func catalog(kind: MediaKind?, page: Int, pageSize: Int) async throws -> [MediaItem] {
        guard page == 1 else { return [] }
        let files = scanFiles()
        return files.enumerated().map { item(for: $0.element, index: $0.offset) }
    }

    func detail(id: String) async throws -> MediaDetail {
        let files = scanFiles()
        for (index, file) in files.enumerated() where "local-\(index)-\(file.name)" == id {
            let episode = episode(for: file, index: index)
            return MediaDetail(
                item: item(for: file, index: index),
                seasons: [Season(id: id + "-s1", mediaId: id, index: 1, name: "第1季")],
                episodesBySeason: [1: [episode]],
                related: []
            )
        }
        throw AppError.notFound
    }

    func episodes(id: String) async throws -> [Episode] {
        let files = scanFiles()
        for (index, file) in files.enumerated() where "local-\(index)-\(file.name)" == id {
            return [episode(for: file, index: index)]
        }
        throw AppError.notFound
    }

    func playInfo(episodeId: String) async throws -> PlayInfo {
        let files = scanFiles()
        for (index, file) in files.enumerated() {
            let episode = episode(for: file, index: index)
            if episode.id == episodeId {
                return PlayInfo(episodeId: episodeId, url: file.url, urlKind: .file)
            }
        }
        throw AppError.notFound
    }
}

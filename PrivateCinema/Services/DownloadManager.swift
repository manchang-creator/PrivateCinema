import Foundation
import SwiftData

/// 下载引擎抽象：接入真实下载（HTTP / WebDAV）时实现该协议并注入 DownloadManager。
/// 引擎吃字节、报字节：从 sourceURL 下载写入 destinationURL，从 resumeBytes 断点续传，
/// 每次 IO 后上报（已收字节, 总字节）。取消通过任务取消传递（抛 CancellationError）。
protocol DownloadEngine: AnyObject {
    func download(
        sourceURL: URL,
        destinationURL: URL,
        resumeBytes: Int64,
        reportProgress: @escaping @Sendable (Int64, Int64) -> Void
    ) async throws
}

/// 模拟下载引擎：用于演示任务流转与进度 UI（无真实网络 IO）。
final class MockDownloadEngine: DownloadEngine {
    func download(
        sourceURL: URL,
        destinationURL: URL,
        resumeBytes: Int64,
        reportProgress: @escaping @Sendable (Int64, Int64) -> Void
    ) async throws {
        let total: Int64 = 10_000_000
        var received = resumeBytes
        while received < total {
            try await Task.sleep(nanoseconds: 120_000_000)
            received = min(total, received + total / 50)
            reportProgress(received, total)
        }
    }
}

enum DownloadState: String, Codable {
    case waiting
    case downloading
    case paused
    case completed
    case failed
}

/// 下载任务领域模型。
struct DownloadTask: Identifiable, Hashable {
    var id: String
    var mediaId: String
    var mediaTitle: String
    var episodeId: String
    var episodeTitle: String
    /// 下载源地址（HTTP 直链 / 本地文件地址）。
    var sourceURL: URL?
    var posterURL: URL?
    var state: DownloadState
    /// 已接收字节数（引擎字节语义的唯一事实源，progress 由此换算）。
    var receivedBytes: Int64
    var totalBytes: Int64
    var createdAt: Date

    /// 0...1；总字节未知时保持 0。
    var progress: Double {
        guard totalBytes > 0 else { return 0 }
        return min(1, Double(receivedBytes) / Double(totalBytes))
    }
}

/// 下载管理器。
/// 任务生命周期、持久化与进度 UI 完整；字节下载由 DownloadEngine 协议承接
/// （生产注入 HTTPDownloadEngine，演示用 MockDownloadEngine），UI 无需改动。
@MainActor
@Observable
final class DownloadManager {

    private let repository: DownloadRepository
    /// 引擎可替换：单测注入 Stub，接入真实下载时替换实现。
    var engine: DownloadEngine
    private(set) var tasks: [DownloadTask] = []
    private var runningTasks: [String: Task<Void, Never>] = [:]

    init(context: ModelContext, engine: DownloadEngine? = nil) {
        self.repository = DownloadRepository(context: context)
        self.engine = engine ?? MockDownloadEngine()
        tasks = repository.all().map { $0.domain }
        resumeWaitingTasks()
    }

    // MARK: - Public

    /// 入队一个下载任务。sourceURL 为空时任务无法启动（保持 waiting，仅占位）。
    func add(media: MediaItem, episode: Episode, sourceURL: URL? = nil) {
        guard !tasks.contains(where: { $0.episodeId == episode.id }) else { return }
        let task = DownloadTask(
            id: episode.id,
            mediaId: media.id,
            mediaTitle: media.title,
            episodeId: episode.id,
            episodeTitle: episode.displayTitle,
            sourceURL: sourceURL,
            posterURL: media.posterURL,
            state: .waiting,
            receivedBytes: 0,
            totalBytes: 0,
            createdAt: .now
        )
        tasks.append(task)
        repository.upsert(task)
        startIfPossible()
    }

    func add(media: MediaItem, episodes: [Episode], sourceURL: URL? = nil) {
        for episode in episodes {
            add(media: media, episode: episode, sourceURL: sourceURL)
        }
    }

    func pause(_ task: DownloadTask) {
        runningTasks[task.id]?.cancel()
        runningTasks[task.id] = nil
        update(task.id) {
            $0.state = $0.progress >= 1 ? .completed : .paused
        }
    }

    func resume(_ task: DownloadTask) {
        update(task.id) { $0.state = .waiting }
        startIfPossible()
    }

    func remove(_ task: DownloadTask) {
        runningTasks[task.id]?.cancel()
        runningTasks[task.id] = nil
        tasks.removeAll { $0.id == task.id }
        repository.delete(taskId: task.id)
    }

    func clearCompleted() {
        for task in tasks where task.state == .completed {
            repository.delete(taskId: task.id)
        }
        tasks.removeAll { $0.state == .completed }
    }

    func state(ofEpisode episodeId: String) -> DownloadState? {
        tasks.first { $0.episodeId == episodeId }?.state
    }

    // MARK: - Private

    private func update(_ id: String, _ mutation: (inout DownloadTask) -> Void) {
        guard let index = tasks.firstIndex(where: { $0.id == id }) else { return }
        mutation(&tasks[index])
        repository.upsert(tasks[index])
    }

    private func startIfPossible() {
        // 跳过无源地址的占位任务，避免串行队列被堵死
        guard let waiting = tasks.first(where: { $0.state == .waiting && $0.sourceURL != nil }) else { return }
        guard runningTasks[waiting.id] == nil else { return }
        update(waiting.id) { $0.state = .downloading }
        let taskID = waiting.id
        let task = Task { [weak self] in
            _ = await self?.run(taskID: taskID)
        }
        runningTasks[taskID] = task
    }

    private func run(taskID: String) async {
        defer { runningTasks[taskID] = nil }
        guard let task = tasks.first(where: { $0.id == taskID }),
              let sourceURL = task.sourceURL else { return }
        let destinationURL = Self.destinationURL(
            for: taskID,
            sourceExtension: sourceURL.pathExtension
        )
        do {
            try await engine.download(
                sourceURL: sourceURL,
                destinationURL: destinationURL,
                resumeBytes: task.receivedBytes,
                reportProgress: { [weak self] received, total in
                    Task { @MainActor [weak self] in
                        self?.update(taskID) {
                            $0.receivedBytes = max($0.receivedBytes, received)
                            if total > 0 { $0.totalBytes = total }
                        }
                    }
                }
            )
            update(taskID) {
                if $0.totalBytes > 0 { $0.receivedBytes = $0.totalBytes }
                $0.state = .completed
            }
            startIfPossible()
        } catch is CancellationError {
            update(taskID) { $0.state = $0.progress >= 1 ? .completed : .paused }
        } catch {
            update(taskID) { $0.state = .failed }
        }
    }

    /// 目标文件路径：Documents/Downloads/{episodeId}.{源扩展名}；无扩展名回退 mp4。
    private static func destinationURL(for episodeId: String, sourceExtension: String) -> URL {
        let ext = sourceExtension.isEmpty ? "mp4" : sourceExtension
        let downloads = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Downloads", isDirectory: true)
        try? FileManager.default.createDirectory(at: downloads, withIntermediateDirectories: true)
        return downloads.appendingPathComponent("\(episodeId).\(ext)")
    }

    private func resumeWaitingTasks() {
        for task in tasks where task.state == .downloading {
            update(task.id) { $0.state = .waiting }
        }
    }
}

extension DownloadTaskRecord {
    var domain: DownloadTask {
        DownloadTask(
            id: taskId,
            mediaId: mediaId,
            mediaTitle: mediaTitle,
            episodeId: episodeId,
            episodeTitle: episodeTitle,
            sourceURL: sourceURL.flatMap(URL.init(string:)),
            posterURL: posterPath.flatMap(URL.init(string:)),
            state: DownloadState(rawValue: stateRaw) ?? .paused,
            receivedBytes: receivedBytes,
            totalBytes: totalBytes,
            createdAt: createdAt
        )
    }
}

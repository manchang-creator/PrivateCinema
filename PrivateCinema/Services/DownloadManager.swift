import Foundation
import SwiftData

/// 下载引擎抽象：接入真实下载（HTTP / WebDAV）时实现该协议并注入 DownloadManager。
protocol DownloadEngine: AnyObject {
    func download(url: URL, reportProgress: @escaping @Sendable (Double) -> Void) async throws
}

/// 模拟下载引擎：用于 P0/P1 阶段演示任务流转与进度 UI。
final class MockDownloadEngine: DownloadEngine {
    func download(url: URL, reportProgress: @escaping @Sendable (Double) -> Void) async throws {
        for step in 1...50 {
            try await Task.sleep(nanoseconds: 120_000_000)
            reportProgress(Double(step) / 50.0)
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
    var posterURL: URL?
    var state: DownloadState
    /// 0...1
    var progress: Double
    var totalBytes: Int64
    var createdAt: Date
}

/// 下载管理器。
/// P2 现状：任务生命周期、持久化与进度 UI 完整；真实字节下载由
/// DownloadEngine 协议承接，当前使用模拟引擎（MockDownloadEngine），
/// 接入 WebDAV / HTTP 直链时替换实现即可，UI 无需改动。
@MainActor
@Observable
final class DownloadManager {

    private let repository: DownloadRepository
    private var engine: DownloadEngine
    private(set) var tasks: [DownloadTask] = []
    private var runningTasks: [String: Task<Void, Never>] = [:]

    init(context: ModelContext, engine: DownloadEngine? = nil) {
        self.repository = DownloadRepository(context: context)
        self.engine = engine ?? MockDownloadEngine()
        tasks = repository.all().map { $0.domain }
        resumeWaitingTasks()
    }

    // MARK: - Public

    func add(media: MediaItem, episode: Episode) {
        guard !tasks.contains(where: { $0.episodeId == episode.id }) else { return }
        let task = DownloadTask(
            id: episode.id,
            mediaId: media.id,
            mediaTitle: media.title,
            episodeId: episode.id,
            episodeTitle: episode.displayTitle,
            posterURL: media.posterURL,
            state: .waiting,
            progress: 0,
            totalBytes: 0,
            createdAt: .now
        )
        tasks.append(task)
        repository.upsert(task)
        startIfPossible()
    }

    func add(media: MediaItem, episodes: [Episode]) {
        for episode in episodes {
            add(media: media, episode: episode)
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
        guard let waiting = tasks.first(where: { $0.state == .waiting }) else { return }
        guard runningTasks[waiting.id] == nil else { return }
        update(waiting.id) { $0.state = .downloading }
        let taskID = waiting.id
        let task = Task { [weak self] in
            await self?.run(taskID: taskID)
        }
        runningTasks[taskID] = task
    }

    private func run(taskID: String) async {
        defer { runningTasks[taskID] = nil }
        update(taskID) { $0.state = .downloading }
        // 模拟下载：真实引擎接入后替换此段。
        for _ in 0..<50 {
            guard !Task.isCancelled else {
                update(taskID) { $0.state = .paused }
                return
            }
            try? await Task.sleep(nanoseconds: 120_000_000)
            update(taskID) {
                $0.progress = min(1, $0.progress + 0.02)
            }
        }
        update(taskID) {
            $0.progress = 1
            $0.state = .completed
        }
        startIfPossible()
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
            posterURL: posterPath.flatMap(URL.init(string:)),
            state: DownloadState(rawValue: stateRaw) ?? .paused,
            progress: progress,
            totalBytes: totalBytes,
            createdAt: createdAt
        )
    }
}

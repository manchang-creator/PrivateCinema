import Foundation

/// HTTP 直链下载引擎：URLSession 流式写盘，HTTP Range 断点续传。
/// 上报（已收字节, 总字节）；4xx/5xx 抛 AppError；任务取消 → CancellationError。
final class HTTPDownloadEngine: NSObject, DownloadEngine, @unchecked Sendable {

    private let session: URLSession

    /// - Parameter urlProtocolClass: 测试注入 URLProtocol stub（生产传 nil 用默认配置）。
    init(urlProtocolClass: AnyClass? = nil) {
        let configuration = URLSessionConfiguration.default
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        if let urlProtocolClass {
            configuration.protocolClasses = [urlProtocolClass]
        }
        self.session = URLSession(configuration: configuration, delegate: nil, delegateQueue: nil)
    }

    // MARK: - DownloadEngine

    func download(
        sourceURL: URL,
        destinationURL: URL,
        resumeBytes: Int64,
        reportProgress: @escaping @Sendable (Int64, Int64) -> Void
    ) async throws {
        var request = URLRequest(url: sourceURL)
        if resumeBytes > 0 {
            request.setValue("bytes=\(resumeBytes)-", forHTTPHeaderField: "Range")
        }

        let task = session.dataTask(with: request)
        // 桥接对象持有写盘句柄与终态信号；task.delegate 强持有 bridge。
        // 进度在 delegate 回调线程直接上报（闭包 @Sendable，Manager 侧自行切主线程）。
        let bridge = DownloadEventBridge(
            destination: destinationURL,
            resumeBytes: resumeBytes,
            reportProgress: reportProgress
        )
        task.delegate = bridge

        // 取消传导：外层 Task 被取消（暂停）时取消 URLSession 任务，
        // 否则挂起等待不响应取消，暂停会一直吊到服务器传完
        try await withTaskCancellationHandler {
            task.resume()
            if let error = await bridge.waitForTerminalError() {
                throw error
            }
            // URLSession 取消（NSURLErrorCancelled）在桥接里被过滤为成功，
            // 这里补上取消检查：暂停场景必须以 CancellationError 收场
            try Task.checkCancellation()
        } onCancel: {
            task.cancel()
        }
    }
}

// MARK: - 事件桥接

/// URLSession task delegate 桥：把回调式 API 转成 async 终态。
/// 以追加模式写目标文件；续传时从断点偏移续写。
private final class DownloadEventBridge: NSObject, URLSessionDataDelegate, @unchecked Sendable {

    private let destination: URL
    private let resumeBytes: Int64
    private let reportProgress: @Sendable (Int64, Int64) -> Void

    private let lock = NSLock()
    private var fileHandle: FileHandle?
    private var received = Int64(0)
    private var expectedTotal = Int64(-1)
    private var stateError: Error?
    private var finishedContinuation: CheckedContinuation<Void, Never>?
    private var hasFinished = false

    init(
        destination: URL,
        resumeBytes: Int64,
        reportProgress: @escaping @Sendable (Int64, Int64) -> Void
    ) {
        self.destination = destination
        self.resumeBytes = resumeBytes
        self.reportProgress = reportProgress
    }

    /// 挂起等待终态；返回终态错误（成功为 nil）。
    /// 注册与触发都有锁保护：先到先得，后到立即返回。
    func waitForTerminalError() async -> Error? {
        await withCheckedContinuation { (pending: CheckedContinuation<Void, Never>) in
            let alreadyDone = lock.withLock { () -> Bool in
                if hasFinished { return true }
                finishedContinuation = pending
                return false
            }
            if alreadyDone { pending.resume() }
        }
        return lock.withLock { stateError }
    }

    // MARK: URLSessionDataDelegate

    func urlSession(
        _ session: URLSession,
        dataTask: URLSessionDataTask,
        didReceive response: URLResponse,
        completionHandler: @escaping (URLSession.ResponseDisposition) -> Void
    ) {
        let http = response as? HTTPURLResponse
        let status = http?.statusCode ?? 0

        guard (200..<300).contains(status) else {
            lock.withLock {
                stateError = status == 401 || status == 403
                    ? AppError.unauthorized
                : status == 404
                    ? AppError.notFound
                : AppError.network("HTTP \(status)")
            }
            completionHandler(.cancel)
            finish()
            return
        }

        // 续传协商失败（请求了 Range 但服务端回 200 全量）→ 覆盖旧文件从头写
        let resuming = resumeBytes > 0 && status == 206
        received = resuming ? resumeBytes : 0
        if !resuming, FileManager.default.fileExists(atPath: destination.path) {
            try? FileManager.default.removeItem(at: destination)
        }

        if let length = http?.expectedContentLength, length > 0 {
            expectedTotal = resuming ? Int64(length) + resumeBytes : Int64(length)
        } else if let range = http?.value(forHTTPHeaderField: "Content-Range"),
                  let remoteTotal = range.split(separator: "/").last.flatMap({ Int($0) }) {
            // 总长未知时的兜底：Content-Range: bytes 5-19/20
            expectedTotal = Int64(remoteTotal)
        }
        reportProgress(received, expectedTotal)
        completionHandler(.allow)
    }

    func urlSession(
        _ session: URLSession,
        dataTask: URLSessionDataTask,
        didReceive data: Data
    ) {
        do {
            if fileHandle == nil {
                if !FileManager.default.fileExists(atPath: destination.path) {
                    FileManager.default.createFile(atPath: destination.path, contents: nil)
                }
                let handle = try FileHandle(forWritingTo: destination)
                // 全量下载清空旧内容；续传从断点偏移续写
                if received == 0 {
                    try handle.truncate(atOffset: 0)
                }
                try handle.seek(toOffset: UInt64(received))
                fileHandle = handle
            }
            try fileHandle?.write(contentsOf: data)
            received += Int64(data.count)
            reportProgress(received, expectedTotal)
        } catch {
            lock.withLock {
                stateError = AppError.unknown("写入失败：\(error.localizedDescription)")
            }
            dataTask.cancel()
            finish()
        }
    }

    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        didCompleteWithError error: Error?
    ) {
        if let error, (error as NSError?)?.code != NSURLErrorCancelled {
            lock.withLock { stateError = AppError.from(error) }
        }
        try? fileHandle?.close()
        lock.withLock { fileHandle = nil }
        finish()
    }

    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest,
        completionHandler: @escaping (URLRequest?) -> Void
    ) {
        completionHandler(request)
    }

    // MARK: - Private

    private func finish() {
        let pending: CheckedContinuation<Void, Never>? = lock.withLock {
            guard !hasFinished else { return nil }
            hasFinished = true
            let pending = finishedContinuation
            finishedContinuation = nil
            return pending
        }
        pending?.resume()
    }
}

import XCTest
@testable import PrivateCinema

/// HTTPDownloadEngine 字节行为测试（URLProtocol stub，不依赖真实网络）。
final class HTTPDownloadEngineTests: XCTestCase {

    /// 可编程 URLProtocol：按注册的响应序列逐个应答，记录收到的请求。
    private final class StubURLProtocol: URLProtocol {
        static let queue = DispatchQueue(label: "stub.protocol")
        /// 每个请求依次消费一个响应（支持重定向/续传的多次请求场景）。
        static var responses: [(status: Int, headers: [String: String], body: Data)] = []
        static var requests: [URLRequest] = []

        static func reset(
            _ responses: [(status: Int, headers: [String: String], body: Data)]
        ) {
            queue.sync {
                Self.responses = responses
                requests = []
            }
        }

        override class func canInit(with request: URLRequest) -> Bool { true }
        override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

        override func startLoading() {
            Self.queue.sync {
                Self.requests.append(request)
            }
            let (status, headers, body) = Self.queue.sync {
                Self.responses.isEmpty
                    ? (200, [:], Data())
                    : Self.responses.removeFirst()
            }
            let response = HTTPURLResponse(
                url: request.url!,
                statusCode: status,
                httpVersion: "HTTP/1.1",
                headerFields: headers
            )!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: body)
            client?.urlProtocolDidFinishLoading(self)
        }

        override func stopLoading() {}
    }

    private var engine: HTTPDownloadEngine!
    private var destination: URL!

    override func setUp() {
        super.setUp()
        engine = HTTPDownloadEngine(urlProtocolClass: StubURLProtocol.self)
        destination = FileManager.default.temporaryDirectory
            .appendingPathComponent("engine-test-\(UUID().uuidString).mp4")
    }

    override func tearDown() {
        try? FileManager.default.removeItem(at: destination)
        engine = nil
        super.tearDown()
    }

    private let source = URL(string: "https://example.com/video.mp4")!

    // MARK: - RED-2

    func testDownload_完整下载并上报字节进度() async throws {
        let payload = Data("hello download world".utf8)
        StubURLProtocol.reset([(200, ["Content-Length": "\(payload.count)"], payload)])

        var reports: [(Int64, Int64)] = []
        try await engine.download(
            sourceURL: source,
            destinationURL: destination,
            resumeBytes: 0
        ) { received, total in
            reports.append((received, total))
        }

        XCTAssertEqual(try Data(contentsOf: destination), payload)
        XCTAssertEqual(reports.last?.0, Int64(payload.count))
        XCTAssertEqual(reports.last?.1, Int64(payload.count))
    }

    // MARK: - RED-3

    func testResume_带Range请求_从断点续写() async throws {
        // 预置断点前已落盘 5 字节
        try Data("hello".utf8).write(to: destination)
        let payload = Data("hello download world".utf8)
        StubURLProtocol.reset([
            (206, ["Content-Range": "bytes 5-19/20"], payload.dropFirst(5))
        ])

        var receivedRange: Int64?
        try await engine.download(
            sourceURL: source,
            destinationURL: destination,
            resumeBytes: 5
        ) { received, total in
            receivedRange = received
        }

        XCTAssertEqual(try Data(contentsOf: destination), payload)
        XCTAssertEqual(receivedRange, 20)
        // 引擎应向源发起了带 Range 头的请求
        let request = StubURLProtocol.requests.first
        XCTAssertEqual(request?.value(forHTTPHeaderField: "Range"), "bytes=5-")
    }

    // MARK: - RED-4

    func testServerGone_4xx时抛业务错误且不吞() async throws {
        StubURLProtocol.reset([(404, [:], Data())])

        do {
            try await engine.download(
                sourceURL: source,
                destinationURL: destination,
                resumeBytes: 0
            ) { _, _ in }
            XCTFail("4xx 应抛错而不是静默成功")
        } catch let error as AppError {
            guard case .notFound = error else {
                XCTFail("期望 notFound 错误，实际：\(error)")
                return
            }
        }
    }

    // MARK: - RED-5

    func testMismatch_断点与服务端不一致时从头下载() async throws {
        // 服务端不支持 Range → 返回 200 全量，应覆盖旧文件从头写
        let payload = Data("full content".utf8)
        StubURLProtocol.reset([(200, ["Content-Length": "\(payload.count)"], payload)])
        try Data("stale data".utf8).write(to: destination)

        try await engine.download(
            sourceURL: source,
            destinationURL: destination,
            resumeBytes: 10
        ) { _, _ in }

        XCTAssertEqual(try Data(contentsOf: destination), payload)
    }
}

import Foundation
import SwiftData

/// 媒体源管理：配置 CRUD + 连接测试 + 敏感信息落 Keychain。
@MainActor
@Observable
final class MediaSourceStore {
    private let repository: MediaSourceRepository
    private let keychain: KeychainStore

    private(set) var sources: [MediaSourceInfo] = []
    private(set) var statuses: [String: MediaSourceInfo.ConnectionStatus] = [:]

    init(context: ModelContext, keychain: KeychainStore) {
        self.repository = MediaSourceRepository(context: context)
        self.keychain = keychain
        reload()
    }

    func reload() {
        sources = repository.all().map { $0.domain }
    }

    func secretKey(for sourceId: String) -> String {
        "source.secret.\(sourceId)"
    }

    func secret(for sourceId: String) -> String? {
        keychain.string(forKey: secretKey(for: sourceId))
    }

    func save(_ info: MediaSourceInfo, secret: String?) {
        repository.upsert(info)
        keychain.setString(secret, forKey: secretKey(for: info.id))
        reload()
    }

    func delete(sourceId: String) {
        repository.delete(sourceId: sourceId)
        keychain.setString(nil, forKey: secretKey(for: sourceId))
        statuses[sourceId] = nil
        reload()
    }

    func toggleEnabled(_ source: MediaSourceInfo) {
        var updated = source
        updated.enabled.toggle()
        repository.upsert(updated)
        reload()
    }

    /// 连接测试：对 baseURL 发起 HEAD 请求，5 秒超时。
    func testConnection(_ source: MediaSourceInfo) async {
        statuses[source.id] = .testing
        guard let url = URL(string: source.baseURL), url.host != nil else {
            statuses[source.id] = .failed("地址无效")
            return
        }
        var request = URLRequest(url: url)
        request.httpMethod = "HEAD"
        request.timeoutInterval = 5
        do {
            let (_, response) = try await URLSession.shared.data(for: request)
            if let http = response as? HTTPURLResponse, (200..<400).contains(http.statusCode) {
                statuses[source.id] = .connected
            } else {
                statuses[source.id] = .failed("服务无响应")
            }
        } catch {
            statuses[source.id] = .failed("无法连接")
        }
    }
}

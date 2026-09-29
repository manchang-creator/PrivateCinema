import CryptoKit
import Foundation

/// kanju 上游 API 客户端。
///
/// 上游前端对所有 `/v1/` 请求附加 HMAC-SHA256 签名头：
/// `signature = HMAC(secret, "{METHOD}\n{path}{query}\n{timestamp}\n{nonce}")`
/// 本客户端复现该签名，并在多个镜像域名间自动容灾。
struct KanjuAPIClient {

    static let secret = "557d0e4ae929f438da6bd84412374e6086b8af09b3fed54bf22601d5bf8c54a0"

    /// 域名会不定期轮换，失效时补充新镜像即可。
    static let baseCandidates = [
        "https://kanju1.com",
        "https://kanju.ai",
    ]

    enum KanjuTransportError: Error {
        case unreachable
    }

    static let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return decoder
    }()

    // MARK: - 签名

    private func signedHeaders(method: String, pathAndQuery: String) -> [String: String] {
        let timestamp = String(Int(Date().timeIntervalSince1970 * 1000))
        let nonce = (0..<16).map { _ in UInt8.random(in: 0...255) }
            .map { String(format: "%02x", $0) }
            .joined()
        let message = "\(method)\n\(pathAndQuery)\n\(timestamp)\n\(nonce)"
        let key = SymmetricKey(data: Data(Self.secret.utf8))
        let mac = HMAC<SHA256>.authenticationCode(for: Data(message.utf8), using: key)
        let signature = mac.map { String(format: "%02x", $0) }.joined()
        return [
            "x-ai-movie-timestamp": timestamp,
            "x-ai-movie-nonce": nonce,
            "x-ai-movie-signature": signature,
        ]
    }

    // MARK: - 请求

    private func rawRequest(
        _ pathAndQuery: String,
        method: String = "GET",
        body: Data? = nil
    ) async throws -> Data {
        let headers = signedHeaders(method: method, pathAndQuery: pathAndQuery)
        var lastError: Error = KanjuTransportError.unreachable

        for base in Self.baseCandidates {
            guard let url = URL(string: base + pathAndQuery) else { continue }
            var request = URLRequest(url: url)
            request.httpMethod = method
            request.timeoutInterval = 20
            request.setValue("application/json", forHTTPHeaderField: "Accept")
            request.setValue(
                "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)",
                forHTTPHeaderField: "User-Agent"
            )
            for (key, value) in headers {
                request.setValue(value, forHTTPHeaderField: key)
            }
            if let body {
                request.httpBody = body
                request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            }

            do {
                let (data, response) = try await URLSession.shared.data(for: request)
                guard let http = response as? HTTPURLResponse else {
                    throw AppError.provider("非 HTTP 响应")
                }
                // 4xx 属于业务性错误（如线路失效），换域名无意义，直接上抛
                if (400..<500).contains(http.statusCode) {
                    throw AppError.provider("上游返回 \(http.statusCode)")
                }
                if (500..<600).contains(http.statusCode) {
                    lastError = AppError.provider("上游返回 \(http.statusCode)")
                    continue
                }
                return data
            } catch let error as AppError {
                throw error
            } catch {
                lastError = error // 网络层错误 → 换下一个域名
            }
        }
        throw AppError.from(lastError)
    }

    func get<T: Decodable>(_ pathAndQuery: String, as type: T.Type) async throws -> T {
        let data = try await rawRequest(pathAndQuery)
        do {
            return try Self.decoder.decode(T.self, from: data)
        } catch {
            throw AppError.decode(String(describing: error))
        }
    }

    func post<T: Decodable>(_ pathAndQuery: String, json: some Encodable, as type: T.Type) async throws -> T {
        let body = try JSONEncoder().encode(json)
        let data = try await rawRequest(pathAndQuery, method: "POST", body: body)
        do {
            return try Self.decoder.decode(T.self, from: data)
        } catch {
            throw AppError.decode(String(describing: error))
        }
    }
}

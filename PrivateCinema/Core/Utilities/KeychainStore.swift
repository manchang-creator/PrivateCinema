import Foundation
import Security

/// 极简 Keychain 封装：保存设备 ID 与媒体源密码 / Token。
struct KeychainStore {
    let service: String

    enum KeychainError: Error {
        case unexpectedStatus(OSStatus)
    }

    func setString(_ value: String?, forKey key: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
        ]
        if let value {
            let data = Data(value.utf8)
            let attributes: [String: Any] = [
                kSecValueData as String: data,
                kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock,
            ]
            let status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
            if status == errSecItemNotFound {
                var addQuery = query
                addQuery.merge(attributes) { _, new in new }
                SecItemAdd(addQuery as CFDictionary, nil)
            }
        } else {
            SecItemDelete(query as CFDictionary)
        }
    }

    func string(forKey key: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess, let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }
}

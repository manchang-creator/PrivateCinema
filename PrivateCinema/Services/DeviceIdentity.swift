import Foundation

/// 设备标识：首次启动生成并写入 Keychain，弹幕用户身份使用。
struct DeviceIdentity {
    let keychain: KeychainStore
    private let userIdKey = "device.user.id"
    private let nameKey = "device.user.name"

    init(keychain: KeychainStore) {
        self.keychain = keychain
    }

    /// 稳定设备用户 ID。
    var userId: String {
        if let existing = keychain.string(forKey: userIdKey) {
            return existing
        }
        let fresh = "user-" + UUID().uuidString.lowercased()
        keychain.setString(fresh, forKey: userIdKey)
        return fresh
    }

    /// 弹幕昵称（本地生成，可在设置中修改）。
    var displayName: String {
        if let existing = keychain.string(forKey: nameKey) {
            return existing
        }
        let adjectives = ["轻盈", "温柔", "沉静", "明亮", "晚风", "山雾", "白昼", "薄荷"]
        let animals = ["海雀", "山雀", "麋鹿", "狐", "鲸", "信天翁", "兔", "猫"]
        let name = (adjectives + animals).randomElement()! + animals.randomElement()!
        keychain.setString(name, forKey: nameKey)
        return name
    }

    func rename(_ name: String) {
        keychain.setString(name, forKey: nameKey)
    }
}

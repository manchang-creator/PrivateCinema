import Foundation
import SwiftData

extension ModelContext {
    /// 保存并在失败时输出日志。
    /// 持久化写入失败意味着数据将无声丢失，必须留痕，禁止静默吞掉。
    func saveOrLog() {
        do {
            try save()
        } catch {
            print("[Persistence] 保存失败: \(error)")
        }
    }
}

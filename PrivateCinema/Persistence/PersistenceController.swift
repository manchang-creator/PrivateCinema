import Foundation
import SwiftData

/// 持久化容器管理。
struct PersistenceController {
    static let shared = PersistenceController()

    let container: ModelContainer

    /// SwiftData 模型清单，新增 Record 后在这里注册。
    static let schemaModels: [any PersistentModel.Type] = [
        WatchProgressRecord.self,
        FavoriteRecord.self,
        DanmakuRecord.self,
        MediaSourceRecord.self,
        DownloadTaskRecord.self,
    ]

    init(inMemory: Bool = false) {
        let configuration = ModelConfiguration(isStoredInMemoryOnly: inMemory)
        do {
            container = try ModelContainer(
                for: Self.schemaModels,
                configurations: [configuration]
            )
        } catch {
            // 个人应用兜底：持久层失败时退化为内存模式，保证 App 可用。
            let fallback = ModelConfiguration(isStoredInMemoryOnly: true)
            container = (try? ModelContainer(
                for: Self.schemaModels,
                configurations: [fallback]
            )) ?? Self.emptyContainer()
        }
    }

    /// 极端情况下（容器创建彻底失败）的最终兜底。
    private static func emptyContainer() -> ModelContainer {
        let fallback = ModelConfiguration(isStoredInMemoryOnly: true)
        return try! ModelContainer(for: Self.schemaModels, configurations: [fallback])
    }

    /// 未来接入 iCloud 同步：为对应 Record 提供
    /// `ModelConfiguration(cloudKitDatabase: .automatic)` 并开启 entitle 案头即可。
}

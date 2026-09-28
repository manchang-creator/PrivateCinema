import SwiftUI
import SwiftData

@main
struct PrivateCinemaApp: App {

    @State private var environment: AppEnvironment

    init() {
        let controller = PersistenceController.shared
        _environment = State(initialValue: AppEnvironment(container: controller.container))
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(environment)
                .modelContainer(environment.container)
        }
    }
}

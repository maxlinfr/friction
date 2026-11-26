import SwiftUI

@main
struct FrictionApp: App {
    init() {
        FrictionSettings.registerDefaults()
    }

    var body: some Scene {
        WindowGroup {
            BrowserView()
                .background(Color(uiColor: .systemBackground))
        }
    }
}

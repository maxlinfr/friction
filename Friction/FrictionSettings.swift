import Foundation

/// Settings live in the iOS Settings app (Settings > Friction), so the app
/// itself has zero UI of its own: it is just Instagram, slightly worse.
enum FrictionSettings {
    static let intensityKey = "intensity"
    static let debugKey = "debug"

    static func registerDefaults() {
        UserDefaults.standard.register(defaults: [
            intensityKey: 1.0,
            debugKey: false,
        ])
    }

    /// 0 = off, 0.6 = light, 1.0 = normal, 1.6 = strong
    static var intensity: Double { UserDefaults.standard.double(forKey: intensityKey) }
    static var debug: Bool { UserDefaults.standard.bool(forKey: debugKey) }

    /// Runs before friction.js so the engine picks up the current settings.
    static func configScript() -> String {
        "window.__FRICTION_CONFIG__ = { intensity: \(intensity), debug: \(debug) };"
    }

    static var engineSource: String? {
        guard let url = Bundle.main.url(forResource: "friction", withExtension: "js") else { return nil }
        return try? String(contentsOf: url, encoding: .utf8)
    }
}

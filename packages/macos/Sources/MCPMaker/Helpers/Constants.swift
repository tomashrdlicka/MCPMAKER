import Foundation

enum Constants {
    // Engine
    static let enginePort = 7433
    static let engineBaseURL = "http://localhost:\(enginePort)"
    static let engineHealthEndpoint = "\(engineBaseURL)/health"

    // Chrome CDP
    static let chromeDebugPort = 9222
    static let cdpBaseURL = "http://127.0.0.1:\(chromeDebugPort)"

    // Cloud proxy
    static let proxyBaseURL = "https://api.mcpmaker.com"
    static let proxyClaudeURL = "\(proxyBaseURL)/v1/claude"

    // Tier limits (per month)
    enum TierLimits {
        static let freeRecordings = 5
        static let freePlaybacks = 20
        static let freeAnalyses = 5

        static let proRecordings = 50
        static let proPlaybacks = 500
        static let proAnalyses = 50

        // Max tier: unlimited (enforced server-side)
    }

    // Chrome paths
    static let chromeSearchPaths = [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
    ]

    // Timing
    static let cdpPollIntervalMs = 250
    static let engineHealthCheckIntervalS: TimeInterval = 2.0
    static let lotusBloomDurationS: TimeInterval = 1.0
    static let lotusSuccessDurationS: TimeInterval = 2.0
    static let pipAutoDismissS: TimeInterval = 3.0

    // App identifiers
    static let appBundleId = "com.mcpmaker.app"
    static let keychainService = "com.mcpmaker.app"
}

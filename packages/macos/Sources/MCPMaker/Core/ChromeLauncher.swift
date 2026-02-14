import Foundation

enum ChromeLauncher {
    static let searchPaths = Constants.chromeSearchPaths

    static func findChrome() -> String? {
        for path in searchPaths {
            if FileManager.default.isExecutableFile(atPath: path) {
                return path
            }
        }
        return nil
    }

    @discardableResult
    static func launch(url: String, debugPort: Int = Constants.chromeDebugPort) throws -> Process {
        guard let chromePath = findChrome() else {
            throw ChromeLauncherError.chromeNotFound
        }

        // Create a temporary user-data-dir so the recording Chrome session
        // is isolated from the user's regular Chrome profile.
        let tempDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("mcpmaker-chrome-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)

        let process = Process()
        process.executableURL = URL(fileURLWithPath: chromePath)
        process.arguments = [
            "--remote-debugging-port=\(debugPort)",
            "--no-first-run",
            "--no-default-browser-check",
            "--user-data-dir=\(tempDir.path)",
            url,
        ]

        // Suppress Chrome's stdout/stderr
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice

        try process.run()
        return process
    }

    static func isDebugPortOpen(port: Int = Constants.chromeDebugPort) async -> Bool {
        let url = URL(string: "http://127.0.0.1:\(port)/json/version")!
        do {
            let (_, response) = try await URLSession.shared.data(from: url)
            return (response as? HTTPURLResponse)?.statusCode == 200
        } catch {
            return false
        }
    }

    /// Waits for the Chrome debug port to become available, with a timeout.
    static func waitForDebugPort(port: Int = Constants.chromeDebugPort, timeoutSeconds: Int = 10) async throws {
        let deadline = Date().addingTimeInterval(TimeInterval(timeoutSeconds))
        while Date() < deadline {
            if await isDebugPortOpen(port: port) {
                return
            }
            try await Task.sleep(nanoseconds: 300_000_000) // 300ms
        }
        throw ChromeLauncherError.debugPortTimeout
    }
}

enum ChromeLauncherError: LocalizedError {
    case chromeNotFound
    case debugPortTimeout

    var errorDescription: String? {
        switch self {
        case .chromeNotFound:
            return "Google Chrome was not found. Please install Chrome or set its location in Settings."
        case .debugPortTimeout:
            return "Chrome took too long to start. Please try again."
        }
    }
}

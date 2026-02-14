import Foundation

/// Manages the bundled Node.js engine as a subprocess.
@MainActor
class EngineProcess: ObservableObject {
    @Published var status: EngineStatus = .starting

    private var process: Process?
    private var healthCheckTask: Task<Void, Never>?

    /// Start the bundled engine subprocess.
    func start() {
        guard process == nil else { return }
        status = .starting

        // Look for the bundled engine in the app's resources
        guard let engineDir = Bundle.main.resourceURL?.appendingPathComponent("engine") else {
            print("Engine bundle not found in app resources")
            status = .error
            return
        }

        let indexPath = engineDir.appendingPathComponent("dist").appendingPathComponent("index.js")
        guard FileManager.default.fileExists(atPath: indexPath.path) else {
            print("Engine index.js not found at \(indexPath.path)")
            status = .error
            return
        }

        // Find node binary (bundled or system)
        let nodePath = findNodeBinary()
        guard let nodePath else {
            print("Node.js not found")
            status = .error
            return
        }

        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: nodePath)
        proc.arguments = [indexPath.path]
        proc.currentDirectoryURL = engineDir

        var env = ProcessInfo.processInfo.environment
        env["PORT"] = "\(Constants.enginePort)"
        // Route Claude calls through the proxy
        env["CLAUDE_PROXY_URL"] = Constants.proxyClaudeURL
        proc.environment = env

        proc.standardOutput = FileHandle.nullDevice
        proc.standardError = FileHandle.nullDevice

        proc.terminationHandler = { [weak self] _ in
            Task { @MainActor in
                self?.status = .stopped
                self?.process = nil
            }
        }

        do {
            try proc.run()
            process = proc
            startHealthCheck()
        } catch {
            print("Failed to start engine: \(error.localizedDescription)")
            status = .error
        }
    }

    /// Stop the engine subprocess.
    func stop() {
        healthCheckTask?.cancel()
        healthCheckTask = nil
        process?.terminate()
        process = nil
        status = .stopped
    }

    // MARK: - Private

    private func startHealthCheck() {
        healthCheckTask = Task { [weak self] in
            // Poll until the engine's health endpoint responds
            let url = URL(string: Constants.engineHealthEndpoint)!
            for _ in 0..<30 { // up to ~60 seconds
                guard !Task.isCancelled else { return }
                do {
                    let (_, response) = try await URLSession.shared.data(from: url)
                    if (response as? HTTPURLResponse)?.statusCode == 200 {
                        await MainActor.run {
                            self?.status = .ready
                        }
                        return
                    }
                } catch {
                    // Not ready yet
                }
                try? await Task.sleep(nanoseconds: UInt64(Constants.engineHealthCheckIntervalS * 1_000_000_000))
            }

            await MainActor.run {
                self?.status = .error
            }
        }
    }

    private func findNodeBinary() -> String? {
        // Check bundled node first
        if let bundled = Bundle.main.resourceURL?.appendingPathComponent("node"),
           FileManager.default.isExecutableFile(atPath: bundled.path) {
            return bundled.path
        }

        // Fallback to system node
        let systemPaths = [
            "/usr/local/bin/node",
            "/opt/homebrew/bin/node",
            "/usr/bin/node",
        ]

        for path in systemPaths {
            if FileManager.default.isExecutableFile(atPath: path) {
                return path
            }
        }

        // Try `which node`
        let which = Process()
        which.executableURL = URL(fileURLWithPath: "/usr/bin/which")
        which.arguments = ["node"]
        let pipe = Pipe()
        which.standardOutput = pipe
        try? which.run()
        which.waitUntilExit()

        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        let path = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines)
        if let path, !path.isEmpty, FileManager.default.isExecutableFile(atPath: path) {
            return path
        }

        return nil
    }
}

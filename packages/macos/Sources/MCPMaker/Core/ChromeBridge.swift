import Foundation

actor ChromeBridge {
    private var webSocket: URLSessionWebSocketTask?
    private var session: URLSession?
    private var messageId = 0
    private var pending: [Int: CheckedContinuation<CDPResponse, Error>] = [:]
    private var eventHandlers: [(CDPEvent) -> Void] = []
    private var receiveTask: Task<Void, Never>?

    var isConnected: Bool { webSocket != nil }

    // MARK: - Connection

    func connect(port: Int = 9222) async throws {
        let versionURL = URL(string: "http://127.0.0.1:\(port)/json/version")!
        let (data, _) = try await URLSession.shared.data(from: versionURL)
        let versionInfo = try JSONDecoder().decode(CDPVersionInfo.self, from: data)

        guard let wsURL = URL(string: versionInfo.webSocketDebuggerUrl) else {
            throw ChromeBridgeError.invalidWebSocketURL
        }

        session = URLSession(configuration: .default)
        let ws = session!.webSocketTask(with: wsURL)
        ws.resume()
        webSocket = ws

        receiveTask = Task { [weak self] in
            await self?.receiveLoop()
        }
    }

    func connectToTarget(port: Int = 9222, targetId: String? = nil) async throws {
        let targetsURL = URL(string: "http://127.0.0.1:\(port)/json")!
        let (data, _) = try await URLSession.shared.data(from: targetsURL)
        let targets = try JSONDecoder().decode([CDPTargetInfo].self, from: data)

        let target: CDPTargetInfo?
        if let targetId {
            target = targets.first { $0.id == targetId }
        } else {
            target = targets.first { $0.type == "page" }
        }

        guard let target, let wsURLString = target.webSocketDebuggerUrl,
              let wsURL = URL(string: wsURLString) else {
            throw ChromeBridgeError.noTargetFound
        }

        session = URLSession(configuration: .default)
        let ws = session!.webSocketTask(with: wsURL)
        ws.resume()
        webSocket = ws

        receiveTask = Task { [weak self] in
            await self?.receiveLoop()
        }
    }

    func disconnect() {
        receiveTask?.cancel()
        receiveTask = nil
        webSocket?.cancel(with: .normalClosure, reason: nil)
        webSocket = nil
        session?.invalidateAndCancel()
        session = nil

        // Fail all pending continuations
        for (_, continuation) in pending {
            continuation.resume(throwing: ChromeBridgeError.disconnected)
        }
        pending.removeAll()
        eventHandlers.removeAll()
    }

    // MARK: - Sending Commands

    func send(method: String, params: [String: Any]? = nil) async throws -> CDPResponse {
        guard let ws = webSocket else {
            throw ChromeBridgeError.notConnected
        }

        messageId += 1
        let id = messageId

        let request = CDPRequest(id: id, method: method, params: params)
        let data = try JSONEncoder().encode(request)
        let message = URLSessionWebSocketTask.Message.data(data)

        try await ws.send(message)

        return try await withCheckedThrowingContinuation { continuation in
            pending[id] = continuation
        }
    }

    // MARK: - Convenience Methods

    func evaluate(_ js: String, returnByValue: Bool = true) async throws -> String {
        let params: [String: Any] = [
            "expression": js,
            "returnByValue": returnByValue,
        ]
        let response = try await send(method: "Runtime.evaluate", params: params)

        if let error = response.error {
            throw ChromeBridgeError.cdpError(error.code, error.message)
        }

        // Extract string value from result
        if let result = response.result?["result"]?.value as? [String: Any],
           let value = result["value"] {
            if let stringVal = value as? String {
                return stringVal
            }
            let data = try JSONSerialization.data(withJSONObject: value)
            return String(data: data, encoding: .utf8) ?? ""
        }

        return ""
    }

    func captureScreenshot() async throws -> Data {
        let response = try await send(method: "Page.captureScreenshot", params: ["format": "png"])

        if let error = response.error {
            throw ChromeBridgeError.cdpError(error.code, error.message)
        }

        guard let base64String = response.result?["data"]?.value as? String,
              let imageData = Data(base64Encoded: base64String) else {
            throw ChromeBridgeError.screenshotFailed
        }

        return imageData
    }

    func enableDomain(_ domain: String) async throws {
        _ = try await send(method: "\(domain).enable")
    }

    func injectScript(_ script: String) async throws {
        let params: [String: Any] = [
            "source": script,
        ]
        _ = try await send(method: "Page.addScriptToEvaluateOnNewDocument", params: params)
        // Also evaluate immediately on the current page
        _ = try await send(method: "Runtime.evaluate", params: [
            "expression": script,
            "returnByValue": false,
        ])
    }

    // MARK: - Event Handling

    func onEvent(_ handler: @escaping (CDPEvent) -> Void) {
        eventHandlers.append(handler)
    }

    // MARK: - Receive Loop

    private func receiveLoop() async {
        guard let ws = webSocket else { return }

        while !Task.isCancelled {
            do {
                let message = try await ws.receive()
                switch message {
                case .data(let data):
                    handleMessage(data)
                case .string(let text):
                    if let data = text.data(using: .utf8) {
                        handleMessage(data)
                    }
                @unknown default:
                    break
                }
            } catch {
                // WebSocket closed or errored
                break
            }
        }
    }

    private func handleMessage(_ data: Data) {
        guard let response = try? JSONDecoder().decode(CDPResponse.self, from: data) else {
            return
        }

        if response.isEvent {
            let event = CDPEvent(method: response.method!, params: response.params)
            for handler in eventHandlers {
                handler(event)
            }
        } else if let id = response.id, let continuation = pending.removeValue(forKey: id) {
            continuation.resume(returning: response)
        }
    }
}

// MARK: - Errors

enum ChromeBridgeError: LocalizedError {
    case invalidWebSocketURL
    case noTargetFound
    case notConnected
    case disconnected
    case cdpError(Int, String)
    case screenshotFailed
    case evaluationFailed(String)

    var errorDescription: String? {
        switch self {
        case .invalidWebSocketURL:
            return "Chrome returned an invalid WebSocket URL"
        case .noTargetFound:
            return "No browser page found to connect to"
        case .notConnected:
            return "Not connected to Chrome. Start a recording or playback first."
        case .disconnected:
            return "Connection to Chrome was lost"
        case .cdpError(let code, let message):
            return "Chrome DevTools error (\(code)): \(message)"
        case .screenshotFailed:
            return "Failed to capture screenshot from Chrome"
        case .evaluationFailed(let reason):
            return "JavaScript evaluation failed: \(reason)"
        }
    }
}

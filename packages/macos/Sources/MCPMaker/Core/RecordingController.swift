import Foundation

/// Orchestrates a recording session: launches Chrome, connects CDP,
/// injects the content script, and polls for captured DOM events.
@MainActor
class RecordingController: ObservableObject {
    private let engineClient: EngineClient
    private var bridge: ChromeBridge?
    private var chromeProcess: Process?
    private var domEvents: [DOMEvent] = []
    private var networkEvents: [NetworkEvent] = []
    private var pendingNetworkRequests: [String: PartialNetworkEvent] = [:]
    private var pollTask: Task<Void, Never>?
    private var startTime: Date?
    private var startURL: String = ""

    @Published var eventCount = 0

    init(engineClient: EngineClient) {
        self.engineClient = engineClient
    }

    /// Start a recording session at the given URL.
    func start(url: String) async throws -> ChromeBridge {
        startURL = url
        startTime = Date()
        domEvents = []
        networkEvents = []
        pendingNetworkRequests = [:]
        eventCount = 0

        // Launch Chrome
        try ChromeLauncher.launch(url: url)
        try await ChromeLauncher.waitForDebugPort()

        // Connect CDP
        let cdp = ChromeBridge()
        bridge = cdp
        try await cdp.connectToTarget()

        // Enable CDP domains
        try await cdp.enableDomain("Page")
        try await cdp.enableDomain("Network")
        try await cdp.enableDomain("Runtime")

        // Subscribe to network events
        await cdp.onEvent { [weak self] event in
            Task { @MainActor in
                self?.handleCDPEvent(event)
            }
        }

        // Inject content script
        if let scriptURL = Bundle.main.url(forResource: "content-script", withExtension: "js"),
           let script = try? String(contentsOf: scriptURL) {
            try await cdp.injectScript(script)
        }

        // Start polling for DOM events from the injected script
        pollTask = Task { [weak self] in
            await self?.pollLoop()
        }

        return cdp
    }

    /// Stop recording and return the captured session.
    func stop() async throws -> Session {
        pollTask?.cancel()
        pollTask = nil

        // Flush remaining events from the page
        if let cdp = bridge {
            await flushEvents(from: cdp)
        }

        let session = Session(
            id: UUID().uuidString,
            workflowName: "Untitled Workflow",
            url: startURL,
            startedAt: startTime?.timeIntervalSince1970 ?? Date().timeIntervalSince1970,
            endedAt: Date().timeIntervalSince1970,
            domEvents: domEvents,
            networkEvents: networkEvents,
            correlations: buildCorrelations()
        )

        // Send session to engine for analysis
        do {
            _ = try await engineClient.createSession(session)
        } catch {
            // Engine might not be running; session is still valid locally
            print("Failed to send session to engine: \(error.localizedDescription)")
        }

        return session
    }

    /// Disconnect from Chrome (but don't close the browser).
    func cleanup() async {
        pollTask?.cancel()
        pollTask = nil
        if let cdp = bridge {
            await cdp.disconnect()
        }
        bridge = nil
    }

    // MARK: - Private

    private func pollLoop() async {
        guard let cdp = bridge else { return }

        while !Task.isCancelled {
            await flushEvents(from: cdp)
            try? await Task.sleep(nanoseconds: UInt64(Constants.cdpPollIntervalMs) * 1_000_000)
        }
    }

    private func flushEvents(from cdp: ChromeBridge) async {
        do {
            let json = try await cdp.evaluate("JSON.stringify(window.__mcpmaker_events.splice(0))")
            guard !json.isEmpty, json != "[]" else { return }

            if let data = json.data(using: .utf8),
               let events = try? JSONDecoder().decode([DOMEvent].self, from: data) {
                domEvents.append(contentsOf: events)
                eventCount = domEvents.count
            }
        } catch {
            // Evaluation may fail if page is navigating
        }
    }

    private func handleCDPEvent(_ event: CDPEvent) {
        switch event.method {
        case "Network.requestWillBeSent":
            handleNetworkRequest(event.params)
        case "Network.responseReceived":
            handleNetworkResponse(event.params)
        default:
            break
        }
    }

    private func handleNetworkRequest(_ params: [String: Any]) {
        guard let requestId = params["requestId"] as? String,
              let request = params["request"] as? [String: Any],
              let url = request["url"] as? String,
              let method = request["method"] as? String else { return }

        // Filter tracking and static assets
        if isTrackingOrStatic(url: url) { return }

        let headers = (request["headers"] as? [String: String]) ?? [:]
        let postData = request["postData"] as? String
        let timestamp = (params["timestamp"] as? Double) ?? Date().timeIntervalSince1970

        pendingNetworkRequests[requestId] = PartialNetworkEvent(
            timestamp: timestamp * 1000, // Convert to ms
            url: url,
            method: method,
            requestHeaders: headers,
            requestBody: postData
        )
    }

    private func handleNetworkResponse(_ params: [String: Any]) {
        guard let requestId = params["requestId"] as? String,
              var pending = pendingNetworkRequests.removeValue(forKey: requestId),
              let response = params["response"] as? [String: Any] else { return }

        let status = (response["status"] as? Int) ?? 0
        let headers = (response["headers"] as? [String: String]) ?? [:]

        let networkEvent = NetworkEvent(
            timestamp: pending.timestamp,
            url: pending.url,
            method: pending.method,
            requestHeaders: pending.requestHeaders,
            requestBody: pending.requestBody,
            responseStatus: status,
            responseHeaders: headers,
            responseBody: nil,
            initiator: "network"
        )

        networkEvents.append(networkEvent)
    }

    private func buildCorrelations() -> [Correlation] {
        var correlations: [Correlation] = []
        let timeWindow: Double = 2000 // ms

        for (domIndex, domEvent) in domEvents.enumerated() {
            var matchedNetworkIndices: [Int] = []

            for (netIndex, netEvent) in networkEvents.enumerated() {
                let gap = netEvent.timestamp - domEvent.timestamp
                if gap >= 0 && gap <= timeWindow {
                    matchedNetworkIndices.append(netIndex)
                }
            }

            if !matchedNetworkIndices.isEmpty {
                correlations.append(Correlation(
                    domEventIndex: domIndex,
                    networkEventIndices: matchedNetworkIndices,
                    timeGap: matchedNetworkIndices.isEmpty ? 0 :
                        networkEvents[matchedNetworkIndices[0]].timestamp - domEvent.timestamp
                ))
            }
        }

        return correlations
    }

    private func isTrackingOrStatic(url: String) -> Bool {
        let trackingDomains = [
            "google-analytics.com", "googletagmanager.com", "segment.io",
            "mixpanel.com", "hotjar.com", "sentry.io", "facebook.net",
            "doubleclick.net", "amplitude.com",
        ]
        let staticExtensions = [".css", ".js", ".png", ".jpg", ".gif", ".svg", ".woff", ".woff2", ".ico"]

        let lowered = url.lowercased()
        for domain in trackingDomains {
            if lowered.contains(domain) { return true }
        }
        for ext in staticExtensions {
            if lowered.hasSuffix(ext) { return true }
        }
        return false
    }
}

private struct PartialNetworkEvent {
    let timestamp: Double
    let url: String
    let method: String
    let requestHeaders: [String: String]
    let requestBody: String?
}

import Foundation

/// Executes a workflow step-by-step via CDP, driving Chrome deterministically.
@MainActor
class PlaybackController: ObservableObject {
    private let bridge: ChromeBridge
    private let engineClient: EngineClient
    private var playbackTask: Task<Void, Never>?

    @Published var state: PlaybackState = PlaybackState(
        status: .idle, currentStep: 0, totalSteps: 0, completedSteps: []
    )

    init(bridge: ChromeBridge, engineClient: EngineClient) {
        self.bridge = bridge
        self.engineClient = engineClient
    }

    /// Start deterministic playback of a workflow.
    func play(workflow: Workflow, parameters: [String: String]) async {
        guard let definition = workflow.definition else {
            state = PlaybackState(status: .error, currentStep: 0, totalSteps: 0, completedSteps: [],
                                  error: "Workflow has no definition. Record and analyze it first.")
            return
        }

        state = PlaybackState(
            status: .running,
            currentStep: 0,
            totalSteps: definition.steps.count,
            completedSteps: []
        )

        playbackTask = Task { [weak self] in
            await self?.executeSteps(definition: definition, parameters: parameters)
        }
    }

    func stop() {
        playbackTask?.cancel()
        playbackTask = nil
        state.status = .completed
    }

    // MARK: - Private

    private func executeSteps(definition: WorkflowDefinition, parameters: [String: String]) async {
        for step in definition.steps {
            guard !Task.isCancelled else { break }

            state.currentStep = step.order - 1

            do {
                try await executeStep(step, parameters: parameters)
                state.completedSteps.append(step.order - 1)
            } catch {
                state.status = .error
                state.error = error.localizedDescription
                return
            }

            // Brief pause between steps for page to settle
            try? await Task.sleep(nanoseconds: 500_000_000)
        }

        if !Task.isCancelled {
            state.status = .completed
        }
    }

    private func executeStep(_ step: WorkflowStep, parameters: [String: String]) async throws {
        guard let domAction = step.domAction else {
            // API-only step, skip in deterministic playback
            return
        }

        // Substitute parameters in value
        var value = domAction.value
        if let paramRef = domAction.parameterRef, let paramValue = parameters[paramRef] {
            value = paramValue
        }

        let actionJSON: [String: Any] = [
            "type": domAction.type.rawValue,
            "selector": domAction.selector,
            "fallbackSelectors": domAction.fallbackSelectors,
            "ariaLabel": domAction.ariaLabel as Any,
            "textContent": domAction.textContent as Any,
            "value": value as Any,
        ].compactMapValues { $0 }

        let jsonData = try JSONSerialization.data(withJSONObject: actionJSON)
        let jsonString = String(data: jsonData, encoding: .utf8) ?? "{}"

        let resultJSON = try await bridge.evaluate(
            "JSON.stringify(window.__mcpmaker_execute('\(jsonString.escapedForJS)'))"
        )

        guard let resultData = resultJSON.data(using: .utf8) else {
            throw PlaybackError.invalidResult
        }

        struct ActionResult: Decodable {
            let success: Bool
            let error: String?
        }

        let result = try JSONDecoder().decode(ActionResult.self, from: resultData)
        if !result.success {
            throw PlaybackError.stepFailed(step.description, result.error ?? "Unknown error")
        }
    }
}

enum PlaybackError: LocalizedError {
    case invalidResult
    case stepFailed(String, String)

    var errorDescription: String? {
        switch self {
        case .invalidResult:
            return "Received an invalid response from the browser"
        case .stepFailed(let step, let reason):
            return "Step '\(step)' failed: \(reason)"
        }
    }
}

// MARK: - String Extension for JS Escaping

extension String {
    var escapedForJS: String {
        self.replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "'", with: "\\'")
            .replacingOccurrences(of: "\"", with: "\\\"")
            .replacingOccurrences(of: "\n", with: "\\n")
            .replacingOccurrences(of: "\r", with: "\\r")
    }
}

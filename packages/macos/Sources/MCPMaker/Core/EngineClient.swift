import Foundation

/// HTTP client for the local Node.js engine running on localhost.
struct EngineClient {
    private let baseURL: URL
    private let session: URLSession

    init(baseURL: URL = URL(string: Constants.engineBaseURL)!) {
        self.baseURL = baseURL
        self.session = URLSession.shared
    }

    // MARK: - Health

    func isAvailable() async -> Bool {
        let url = baseURL.appendingPathComponent("health")
        do {
            let (_, response) = try await session.data(from: url)
            return (response as? HTTPURLResponse)?.statusCode == 200
        } catch {
            return false
        }
    }

    // MARK: - Sessions

    func createSession(_ sessionData: Session) async throws -> CreateSessionResponse {
        let url = baseURL.appendingPathComponent("sessions")
        let body = CreateSessionRequest(session: sessionData)
        return try await post(url: url, body: body)
    }

    // MARK: - Analysis

    func analyze(workflowId: String, sessionIds: [String]) async throws -> AnalyzeResponse {
        let url = baseURL.appendingPathComponent("analyze")
        let body = AnalyzeRequest(workflowId: workflowId, sessionIds: sessionIds)
        return try await post(url: url, body: body)
    }

    // MARK: - Workflows

    func getWorkflow(id: String) async throws -> WorkflowDefinition {
        let url = baseURL.appendingPathComponent("workflows/\(id)")
        return try await get(url: url)
    }

    // MARK: - Playback

    func getPlaybackIntent(workflowId: String, parameters: [String: String]) async throws -> String {
        let url = baseURL.appendingPathComponent("playback/intent")
        struct IntentRequest: Encodable {
            let workflowId: String
            let parameters: [String: String]
        }
        struct IntentResponse: Decodable {
            let intent: String
        }
        let response: IntentResponse = try await post(
            url: url,
            body: IntentRequest(workflowId: workflowId, parameters: parameters)
        )
        return response.intent
    }

    func getPlaybackInsights(workflowId: String) async throws -> [String] {
        let url = baseURL.appendingPathComponent("playback/insights/\(workflowId)")
        struct InsightsResponse: Decodable {
            let insights: [String]
        }
        let response: InsightsResponse = try await get(url: url)
        return response.insights
    }

    // MARK: - Private HTTP Helpers

    private func get<T: Decodable>(url: URL) async throws -> T {
        let (data, response) = try await session.data(from: url)

        guard let http = response as? HTTPURLResponse else {
            throw EngineClientError.invalidResponse
        }
        guard (200...299).contains(http.statusCode) else {
            let body = String(data: data, encoding: .utf8) ?? ""
            throw EngineClientError.httpError(http.statusCode, body)
        }

        return try JSONDecoder().decode(T.self, from: data)
    }

    private func post<B: Encodable, T: Decodable>(url: URL, body: B) async throws -> T {
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(body)

        let (data, response) = try await session.data(for: request)

        guard let http = response as? HTTPURLResponse else {
            throw EngineClientError.invalidResponse
        }
        guard (200...299).contains(http.statusCode) else {
            let body = String(data: data, encoding: .utf8) ?? ""
            throw EngineClientError.httpError(http.statusCode, body)
        }

        return try JSONDecoder().decode(T.self, from: data)
    }
}

// MARK: - Request/Response Types (mirroring engine API)

struct CreateSessionRequest: Encodable {
    let session: Session
}

struct CreateSessionResponse: Decodable {
    let id: String
    let workflowName: String
}

struct AnalyzeRequest: Encodable {
    let workflowId: String
    let sessionIds: [String]
}

struct AnalyzeResponse: Decodable {
    let workflowId: String
    let definition: WorkflowDefinition
    let confidence: WorkflowDefinition.Confidence
}

// MARK: - Errors

enum EngineClientError: LocalizedError {
    case invalidResponse
    case httpError(Int, String)

    var errorDescription: String? {
        switch self {
        case .invalidResponse:
            return "The engine returned an unexpected response"
        case .httpError(let code, let body):
            return "Engine request failed (HTTP \(code)): \(body.prefix(200))"
        }
    }
}

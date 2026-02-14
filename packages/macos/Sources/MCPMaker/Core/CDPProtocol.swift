import Foundation

// MARK: - CDP Message Types

struct CDPRequest: Encodable {
    let id: Int
    let method: String
    let params: [String: AnyCodable]?

    init(id: Int, method: String, params: [String: Any]? = nil) {
        self.id = id
        self.method = method
        self.params = params?.mapValues { AnyCodable($0) }
    }
}

struct CDPResponse: Decodable {
    let id: Int?
    let result: [String: AnyCodable]?
    let error: CDPError?
    let method: String?
    let params: [String: AnyCodable]?

    var isEvent: Bool { method != nil && id == nil }
}

struct CDPError: Decodable {
    let code: Int
    let message: String
}

// MARK: - CDP Event

struct CDPEvent {
    let method: String
    let params: [String: Any]

    init(method: String, params: [String: AnyCodable]?) {
        self.method = method
        self.params = params?.mapValues(\.value) ?? [:]
    }
}

// MARK: - CDP Version Info

struct CDPVersionInfo: Decodable {
    let webSocketDebuggerUrl: String
    let browser: String?

    enum CodingKeys: String, CodingKey {
        case webSocketDebuggerUrl = "webSocketDebuggerUrl"
        case browser = "Browser"
    }
}

// MARK: - CDP Target Info

struct CDPTargetInfo: Decodable {
    let id: String
    let type: String
    let title: String
    let url: String
    let webSocketDebuggerUrl: String?
}

// MARK: - Page.captureScreenshot result

struct ScreenshotResult: Decodable {
    let data: String // base64 encoded
}

// MARK: - Runtime.evaluate result

struct EvaluateResult: Decodable {
    let result: EvalValue?

    struct EvalValue: Decodable {
        let type: String?
        let value: AnyCodable?
        let description: String?
    }
}

// MARK: - Network domain events

struct NetworkRequestWillBeSent: Decodable {
    let requestId: String
    let request: NetworkRequestData
    let timestamp: Double
    let type: String?

    struct NetworkRequestData: Decodable {
        let url: String
        let method: String
        let headers: [String: String]
        let postData: String?
    }
}

struct NetworkResponseReceived: Decodable {
    let requestId: String
    let response: NetworkResponseData
    let timestamp: Double

    struct NetworkResponseData: Decodable {
        let url: String
        let status: Int
        let headers: [String: String]
    }
}

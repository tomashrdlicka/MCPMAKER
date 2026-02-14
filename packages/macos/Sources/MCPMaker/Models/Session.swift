import Foundation

struct Session: Codable, Identifiable {
    let id: String
    let workflowName: String
    let url: String
    let startedAt: Double
    let endedAt: Double
    var domEvents: [DOMEvent]
    var networkEvents: [NetworkEvent]
    var correlations: [Correlation]
}

struct DOMEvent: Codable {
    let timestamp: Double
    let type: DOMEventType
    let selector: String
    let elementContext: String
    var value: String?
    var windowId: Int?
    var tabId: Int?
    var inputType: String?
    var tagName: String?
    var attributes: [String: String]?
    var innerText: String?
    var ariaLabel: String?
    var formLabels: [String]?
    var pageTitle: String?
    var pageUrl: String?

    enum DOMEventType: String, Codable {
        case click, input, change, submit, navigate, keydown
    }
}

struct NetworkEvent: Codable {
    let timestamp: Double
    let url: String
    let method: String
    let requestHeaders: [String: String]
    var requestBody: String?
    let responseStatus: Int
    let responseHeaders: [String: String]
    var responseBody: String?
    let initiator: String
    var windowId: Int?
    var tabId: Int?
    var resourceType: String?
}

struct Correlation: Codable {
    let domEventIndex: Int
    let networkEventIndices: [Int]
    let timeGap: Double
}

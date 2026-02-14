import XCTest
@testable import MCPMaker

final class EngineClientTests: XCTestCase {

    // MARK: - Request Encoding

    func test_createSessionRequest_encodesCorrectly() throws {
        let session = Session(
            id: "sess-1",
            workflowName: "Test Workflow",
            url: "https://example.com",
            startedAt: 1700000000,
            endedAt: 1700000060,
            domEvents: [
                DOMEvent(
                    timestamp: 1700000010,
                    type: .click,
                    selector: "#submit-btn",
                    elementContext: "<button> | text: \"Submit\""
                )
            ],
            networkEvents: [],
            correlations: []
        )

        let request = CreateSessionRequest(session: session)
        let data = try JSONEncoder().encode(request)
        let json = try JSONSerialization.jsonObject(with: data) as! [String: Any]

        let sessionJSON = json["session"] as! [String: Any]
        XCTAssertEqual(sessionJSON["id"] as? String, "sess-1")
        XCTAssertEqual(sessionJSON["workflowName"] as? String, "Test Workflow")
        XCTAssertEqual(sessionJSON["url"] as? String, "https://example.com")

        let events = sessionJSON["domEvents"] as! [[String: Any]]
        XCTAssertEqual(events.count, 1)
        XCTAssertEqual(events[0]["type"] as? String, "click")
        XCTAssertEqual(events[0]["selector"] as? String, "#submit-btn")
    }

    func test_analyzeRequest_encodesCorrectly() throws {
        let request = AnalyzeRequest(workflowId: "wf-1", sessionIds: ["sess-1", "sess-2"])
        let data = try JSONEncoder().encode(request)
        let json = try JSONSerialization.jsonObject(with: data) as! [String: Any]

        XCTAssertEqual(json["workflowId"] as? String, "wf-1")
        let ids = json["sessionIds"] as! [String]
        XCTAssertEqual(ids, ["sess-1", "sess-2"])
    }

    // MARK: - Response Decoding

    func test_createSessionResponse_decodes() throws {
        let json = """
        {"id": "sess-abc", "workflowName": "Login Flow"}
        """
        let data = json.data(using: .utf8)!
        let response = try JSONDecoder().decode(CreateSessionResponse.self, from: data)

        XCTAssertEqual(response.id, "sess-abc")
        XCTAssertEqual(response.workflowName, "Login Flow")
    }

    func test_analyzeResponse_decodesMinimal() throws {
        let json = """
        {
            "workflowId": "wf-1",
            "confidence": "high",
            "definition": {
                "name": "Search Flow",
                "description": "Search for items",
                "confidence": "high",
                "steps": [],
                "parameters": [],
                "returns": {"description": "Search results", "fields": []},
                "auth": {"type": "cookie", "credentialFields": []},
                "baseUrl": "https://example.com",
                "recordingCount": 1,
                "lastRecorded": "2024-01-01T00:00:00Z"
            }
        }
        """
        let data = json.data(using: .utf8)!
        let response = try JSONDecoder().decode(AnalyzeResponse.self, from: data)

        XCTAssertEqual(response.workflowId, "wf-1")
        XCTAssertEqual(response.confidence, .high)
        XCTAssertEqual(response.definition.name, "Search Flow")
        XCTAssertEqual(response.definition.baseUrl, "https://example.com")
    }
}

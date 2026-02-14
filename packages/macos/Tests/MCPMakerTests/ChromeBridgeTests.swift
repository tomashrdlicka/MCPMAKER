import XCTest
@testable import MCPMaker

final class ChromeBridgeTests: XCTestCase {

    // MARK: - CDP Request Encoding

    func test_cdpRequest_encodesCorrectly() throws {
        let request = CDPRequest(id: 1, method: "Page.navigate", params: ["url": "https://example.com"])
        let data = try JSONEncoder().encode(request)
        let json = try JSONSerialization.jsonObject(with: data) as! [String: Any]

        XCTAssertEqual(json["id"] as? Int, 1)
        XCTAssertEqual(json["method"] as? String, "Page.navigate")

        let params = json["params"] as? [String: Any]
        XCTAssertEqual(params?["url"] as? String, "https://example.com")
    }

    func test_cdpRequest_encodesWithoutParams() throws {
        let request = CDPRequest(id: 5, method: "Page.enable")
        let data = try JSONEncoder().encode(request)
        let json = try JSONSerialization.jsonObject(with: data) as! [String: Any]

        XCTAssertEqual(json["id"] as? Int, 5)
        XCTAssertEqual(json["method"] as? String, "Page.enable")
    }

    // MARK: - CDP Response Decoding

    func test_cdpResponse_decodesResultMessage() throws {
        let json = """
        {"id": 1, "result": {"frameId": "abc123"}}
        """
        let data = json.data(using: .utf8)!
        let response = try JSONDecoder().decode(CDPResponse.self, from: data)

        XCTAssertEqual(response.id, 1)
        XCTAssertFalse(response.isEvent)
        XCTAssertNil(response.error)
        XCTAssertNotNil(response.result)
    }

    func test_cdpResponse_decodesEventMessage() throws {
        let json = """
        {"method": "Network.requestWillBeSent", "params": {"requestId": "req1", "timestamp": 12345.0}}
        """
        let data = json.data(using: .utf8)!
        let response = try JSONDecoder().decode(CDPResponse.self, from: data)

        XCTAssertNil(response.id)
        XCTAssertTrue(response.isEvent)
        XCTAssertEqual(response.method, "Network.requestWillBeSent")
    }

    func test_cdpResponse_decodesErrorMessage() throws {
        let json = """
        {"id": 3, "error": {"code": -32601, "message": "Method not found"}}
        """
        let data = json.data(using: .utf8)!
        let response = try JSONDecoder().decode(CDPResponse.self, from: data)

        XCTAssertEqual(response.id, 3)
        XCTAssertEqual(response.error?.code, -32601)
        XCTAssertEqual(response.error?.message, "Method not found")
    }

    // MARK: - CDP Version Info

    func test_cdpVersionInfo_decodes() throws {
        let json = """
        {
            "Browser": "Chrome/120.0.6099.109",
            "Protocol-Version": "1.3",
            "User-Agent": "...",
            "V8-Version": "12.0.267.17",
            "WebKit-Version": "537.36",
            "webSocketDebuggerUrl": "ws://127.0.0.1:9222/devtools/browser/abc"
        }
        """
        let data = json.data(using: .utf8)!
        let info = try JSONDecoder().decode(CDPVersionInfo.self, from: data)

        XCTAssertEqual(info.webSocketDebuggerUrl, "ws://127.0.0.1:9222/devtools/browser/abc")
        XCTAssertEqual(info.browser, "Chrome/120.0.6099.109")
    }

    // MARK: - CDP Target Info

    func test_cdpTargetInfo_decodes() throws {
        let json = """
        [
            {
                "id": "target1",
                "type": "page",
                "title": "Test Page",
                "url": "https://example.com",
                "webSocketDebuggerUrl": "ws://127.0.0.1:9222/devtools/page/target1"
            }
        ]
        """
        let data = json.data(using: .utf8)!
        let targets = try JSONDecoder().decode([CDPTargetInfo].self, from: data)

        XCTAssertEqual(targets.count, 1)
        XCTAssertEqual(targets[0].id, "target1")
        XCTAssertEqual(targets[0].type, "page")
        XCTAssertEqual(targets[0].title, "Test Page")
    }

    // MARK: - CDP Event Construction

    func test_cdpEvent_constructsFromResponse() throws {
        let json = """
        {"method": "Page.loadEventFired", "params": {"timestamp": 99.5}}
        """
        let data = json.data(using: .utf8)!
        let response = try JSONDecoder().decode(CDPResponse.self, from: data)
        let event = CDPEvent(method: response.method!, params: response.params)

        XCTAssertEqual(event.method, "Page.loadEventFired")
        XCTAssertEqual(event.params["timestamp"] as? Double, 99.5)
    }

    // MARK: - String JS Escaping

    func test_string_escapesForJS() {
        XCTAssertEqual("hello".escapedForJS, "hello")
        XCTAssertEqual("it's".escapedForJS, "it\\'s")
        XCTAssertEqual("line\nbreak".escapedForJS, "line\\nbreak")
        XCTAssertEqual("back\\slash".escapedForJS, "back\\\\slash")
        XCTAssertEqual("say \"hi\"".escapedForJS, "say \\\"hi\\\"")
    }
}

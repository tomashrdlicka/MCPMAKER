import XCTest
@testable import MCPMaker

final class ModelTests: XCTestCase {

    // MARK: - AnyCodable Round-Trip

    func test_anyCodable_string_roundTrip() throws {
        let original = AnyCodable("hello")
        let data = try JSONEncoder().encode(original)
        let decoded = try JSONDecoder().decode(AnyCodable.self, from: data)
        XCTAssertEqual(decoded.value as? String, "hello")
    }

    func test_anyCodable_int_roundTrip() throws {
        let original = AnyCodable(42)
        let data = try JSONEncoder().encode(original)
        let decoded = try JSONDecoder().decode(AnyCodable.self, from: data)
        XCTAssertEqual(decoded.value as? Int, 42)
    }

    func test_anyCodable_bool_roundTrip() throws {
        let original = AnyCodable(true)
        let data = try JSONEncoder().encode(original)
        let decoded = try JSONDecoder().decode(AnyCodable.self, from: data)
        XCTAssertEqual(decoded.value as? Bool, true)
    }

    func test_anyCodable_double_roundTrip() throws {
        let original = AnyCodable(3.14)
        let data = try JSONEncoder().encode(original)
        let decoded = try JSONDecoder().decode(AnyCodable.self, from: data)
        XCTAssertEqual(decoded.value as? Double, 3.14)
    }

    // MARK: - DOMEvent Codable

    func test_domEvent_roundTrip() throws {
        let event = DOMEvent(
            timestamp: 1700000000,
            type: .click,
            selector: "#btn",
            elementContext: "<button> | text: \"OK\"",
            value: nil,
            tagName: "button",
            ariaLabel: "OK"
        )

        let data = try JSONEncoder().encode(event)
        let decoded = try JSONDecoder().decode(DOMEvent.self, from: data)

        XCTAssertEqual(decoded.timestamp, event.timestamp)
        XCTAssertEqual(decoded.type, .click)
        XCTAssertEqual(decoded.selector, "#btn")
        XCTAssertEqual(decoded.tagName, "button")
        XCTAssertEqual(decoded.ariaLabel, "OK")
    }

    func test_domEvent_allTypes() throws {
        let types: [DOMEvent.DOMEventType] = [.click, .input, .change, .submit, .navigate, .keydown]
        for type in types {
            let event = DOMEvent(timestamp: 0, type: type, selector: "body", elementContext: "test")
            let data = try JSONEncoder().encode(event)
            let decoded = try JSONDecoder().decode(DOMEvent.self, from: data)
            XCTAssertEqual(decoded.type, type, "Failed round-trip for type: \(type)")
        }
    }

    // MARK: - NetworkEvent Codable

    func test_networkEvent_roundTrip() throws {
        let event = NetworkEvent(
            timestamp: 1700000000,
            url: "https://api.example.com/users",
            method: "GET",
            requestHeaders: ["Accept": "application/json"],
            responseStatus: 200,
            responseHeaders: ["Content-Type": "application/json"],
            initiator: "script"
        )

        let data = try JSONEncoder().encode(event)
        let decoded = try JSONDecoder().decode(NetworkEvent.self, from: data)

        XCTAssertEqual(decoded.url, "https://api.example.com/users")
        XCTAssertEqual(decoded.method, "GET")
        XCTAssertEqual(decoded.responseStatus, 200)
        XCTAssertEqual(decoded.requestHeaders["Accept"], "application/json")
    }

    // MARK: - Session Codable

    func test_session_roundTrip() throws {
        let session = Session(
            id: "sess-1",
            workflowName: "Test",
            url: "https://example.com",
            startedAt: 1700000000,
            endedAt: 1700000060,
            domEvents: [
                DOMEvent(timestamp: 1700000010, type: .click, selector: "#btn", elementContext: "test")
            ],
            networkEvents: [
                NetworkEvent(
                    timestamp: 1700000011,
                    url: "https://api.example.com/action",
                    method: "POST",
                    requestHeaders: [:],
                    responseStatus: 201,
                    responseHeaders: [:],
                    initiator: "xhr"
                )
            ],
            correlations: [
                Correlation(domEventIndex: 0, networkEventIndices: [0], timeGap: 1)
            ]
        )

        let data = try JSONEncoder().encode(session)
        let decoded = try JSONDecoder().decode(Session.self, from: data)

        XCTAssertEqual(decoded.id, "sess-1")
        XCTAssertEqual(decoded.domEvents.count, 1)
        XCTAssertEqual(decoded.networkEvents.count, 1)
        XCTAssertEqual(decoded.correlations.count, 1)
        XCTAssertEqual(decoded.correlations[0].domEventIndex, 0)
    }

    // MARK: - Workflow Codable

    func test_workflow_roundTrip() throws {
        let workflow = Workflow(
            id: "wf-1",
            name: "Search Spotify",
            sitePattern: "open.spotify.com",
            sessions: ["sess-1"],
            definition: nil,
            createdAt: "2024-01-01T00:00:00Z",
            updatedAt: "2024-01-01T00:00:00Z"
        )

        let data = try JSONEncoder().encode(workflow)
        let decoded = try JSONDecoder().decode(Workflow.self, from: data)

        XCTAssertEqual(decoded.id, "wf-1")
        XCTAssertEqual(decoded.name, "Search Spotify")
        XCTAssertEqual(decoded.sitePattern, "open.spotify.com")
        XCTAssertEqual(decoded.sessions, ["sess-1"])
        XCTAssertNil(decoded.definition)
    }

    // MARK: - WorkflowDefinition Codable

    func test_workflowDefinition_roundTrip() throws {
        let definition = WorkflowDefinition(
            name: "Search",
            description: "Search for items",
            confidence: .high,
            steps: [
                WorkflowStep(
                    order: 1,
                    description: "Click search box",
                    domAction: DOMAction(
                        type: .click,
                        selector: "#search",
                        fallbackSelectors: [".search-input"],
                        ariaLabel: "Search",
                        textContent: nil,
                        value: nil,
                        parameterRef: nil
                    ),
                    request: StepRequest(
                        method: "GET",
                        pathTemplate: "/api/search?q={{query}}",
                        headers: ["Accept": "application/json"]
                    ),
                    inputMappings: [],
                    response: StepResponse(
                        expectedStatus: 200,
                        extractFields: [
                            FieldExtraction(name: "results", jsonPath: "$.items", type: "array", description: "Search results")
                        ]
                    )
                )
            ],
            parameters: [
                ParameterDef(
                    name: "query",
                    type: .string,
                    required: true,
                    description: "Search query",
                    example: "jazz",
                    usedIn: [
                        ParameterUsage(step: 1, location: .query, key: "q")
                    ]
                )
            ],
            returns: ReturnDef(
                description: "Search results",
                fields: [
                    ReturnField(
                        name: "items",
                        type: "array",
                        description: "Matching items",
                        source: ReturnFieldSource(step: 1, jsonPath: "$.items")
                    )
                ]
            ),
            auth: AuthPattern(type: .cookie, credentialFields: []),
            baseUrl: "https://example.com",
            recordingCount: 1,
            lastRecorded: "2024-01-01T00:00:00Z"
        )

        let data = try JSONEncoder().encode(definition)
        let decoded = try JSONDecoder().decode(WorkflowDefinition.self, from: data)

        XCTAssertEqual(decoded.name, "Search")
        XCTAssertEqual(decoded.confidence, .high)
        XCTAssertEqual(decoded.steps.count, 1)
        XCTAssertEqual(decoded.steps[0].domAction?.type, .click)
        XCTAssertEqual(decoded.parameters.count, 1)
        XCTAssertEqual(decoded.parameters[0].name, "query")
        XCTAssertEqual(decoded.parameters[0].type, .string)
        XCTAssertEqual(decoded.auth.type, .cookie)
    }

    // MARK: - UserAccount Codable

    func test_userAccount_roundTrip() throws {
        let account = UserAccount(
            id: "user-1",
            email: "test@example.com",
            tier: .pro,
            usage: UserAccount.Usage(
                recordingsThisMonth: 10,
                playbacksThisMonth: 50,
                analysesThisMonth: 5,
                periodStart: "2024-01-01",
                periodEnd: "2024-02-01"
            )
        )

        let data = try JSONEncoder().encode(account)
        let decoded = try JSONDecoder().decode(UserAccount.self, from: data)

        XCTAssertEqual(decoded.id, "user-1")
        XCTAssertEqual(decoded.email, "test@example.com")
        XCTAssertEqual(decoded.tier, .pro)
        XCTAssertEqual(decoded.usage.recordingsThisMonth, 10)
    }

    func test_userAccount_allTiers() throws {
        for tier in [UserAccount.Tier.free, .pro, .max] {
            let account = UserAccount(
                id: "u", email: "e", tier: tier,
                usage: .init(recordingsThisMonth: 0, playbacksThisMonth: 0, analysesThisMonth: 0, periodStart: "", periodEnd: "")
            )
            let data = try JSONEncoder().encode(account)
            let decoded = try JSONDecoder().decode(UserAccount.self, from: data)
            XCTAssertEqual(decoded.tier, tier)
        }
    }

    // MARK: - AuthResponse Codable

    func test_authResponse_decodes() throws {
        let json = """
        {
            "token": "jwt-token-here",
            "refreshToken": "refresh-token-here",
            "account": {
                "id": "user-1",
                "email": "test@example.com",
                "tier": "free",
                "usage": {
                    "recordingsThisMonth": 0,
                    "playbacksThisMonth": 0,
                    "analysesThisMonth": 0,
                    "periodStart": "2024-01-01",
                    "periodEnd": "2024-02-01"
                }
            }
        }
        """
        let data = json.data(using: .utf8)!
        let response = try JSONDecoder().decode(AuthResponse.self, from: data)

        XCTAssertEqual(response.token, "jwt-token-here")
        XCTAssertEqual(response.refreshToken, "refresh-token-here")
        XCTAssertEqual(response.account.email, "test@example.com")
        XCTAssertEqual(response.account.tier, .free)
    }

    // MARK: - PlaybackState Codable

    func test_playbackState_roundTrip() throws {
        let state = PlaybackState(
            status: .running,
            currentStep: 2,
            totalSteps: 5,
            completedSteps: [0, 1],
            error: nil
        )

        let data = try JSONEncoder().encode(state)
        let decoded = try JSONDecoder().decode(PlaybackState.self, from: data)

        XCTAssertEqual(decoded.status, .running)
        XCTAssertEqual(decoded.currentStep, 2)
        XCTAssertEqual(decoded.totalSteps, 5)
        XCTAssertEqual(decoded.completedSteps, [0, 1])
    }

    // MARK: - Workflow Hashable/Equatable

    func test_workflow_equality_byId() {
        let w1 = Workflow(id: "same", name: "A", sitePattern: "a.com", sessions: [], createdAt: "", updatedAt: "")
        let w2 = Workflow(id: "same", name: "B", sitePattern: "b.com", sessions: ["s1"], createdAt: "", updatedAt: "")
        XCTAssertEqual(w1, w2)
    }

    func test_workflow_inequality_differentId() {
        let w1 = Workflow(id: "id1", name: "A", sitePattern: "a.com", sessions: [], createdAt: "", updatedAt: "")
        let w2 = Workflow(id: "id2", name: "A", sitePattern: "a.com", sessions: [], createdAt: "", updatedAt: "")
        XCTAssertNotEqual(w1, w2)
    }
}

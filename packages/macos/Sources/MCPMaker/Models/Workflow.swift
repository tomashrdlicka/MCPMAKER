import Foundation

struct Workflow: Codable, Identifiable, Hashable {
    let id: String
    var name: String
    let sitePattern: String
    var sessions: [String]
    var definition: WorkflowDefinition?
    var mcpServerPath: String?
    var mcpServerStatus: MCPServerStatus?
    let createdAt: String
    var updatedAt: String

    enum MCPServerStatus: String, Codable {
        case stopped, running, error
    }

    func hash(into hasher: inout Hasher) {
        hasher.combine(id)
    }

    static func == (lhs: Workflow, rhs: Workflow) -> Bool {
        lhs.id == rhs.id
    }
}

struct WorkflowDefinition: Codable {
    let name: String
    let description: String
    let confidence: Confidence
    let steps: [WorkflowStep]
    let parameters: [ParameterDef]
    let returns: ReturnDef
    let auth: AuthPattern
    let baseUrl: String
    let recordingCount: Int
    let lastRecorded: String

    enum Confidence: String, Codable {
        case high, medium, low
    }
}

struct WorkflowStep: Codable, Identifiable {
    var id: Int { order }
    let order: Int
    let description: String
    let domAction: DOMAction?
    let request: StepRequest
    let inputMappings: [StepInputMapping]
    let response: StepResponse
    let dependsOn: Int?
    let isLoopStep: Bool?
    let loopCondition: LoopCondition?
    let opensPopup: Bool?
    let popupActions: [WorkflowStep]?
}

struct DOMAction: Codable {
    let type: DOMActionType
    let selector: String
    let fallbackSelectors: [String]
    let ariaLabel: String?
    let textContent: String?
    let value: String?
    let parameterRef: String?

    enum DOMActionType: String, Codable {
        case click, input, change, submit, navigate, keydown
    }
}

struct StepRequest: Codable {
    let method: String
    let pathTemplate: String
    let headers: [String: String]
    let bodyTemplate: String?
    let queryTemplate: [String: String]?
}

struct StepInputMapping: Codable {
    let sourceStep: Int
    let sourceJsonPath: String
    let targetLocation: TargetLocation
    let targetKey: String
    let description: String

    enum TargetLocation: String, Codable {
        case path, query, body, header
    }
}

struct StepResponse: Codable {
    let expectedStatus: Int
    let extractFields: [FieldExtraction]
}

struct FieldExtraction: Codable {
    let name: String
    let jsonPath: String
    let type: String
    let description: String
}

struct LoopCondition: Codable {
    let type: LoopConditionType
    let selector: String?
    let jsonPath: String?
    let expectedValue: String?

    enum LoopConditionType: String, Codable {
        case elementAbsent = "element_absent"
        case elementPresent = "element_present"
        case apiResponseMatch = "api_response_match"
    }
}

struct ParameterDef: Codable, Identifiable {
    var id: String { name }
    let name: String
    let type: ParamType
    let required: Bool
    let description: String
    let example: String
    let usedIn: [ParameterUsage]

    enum ParamType: String, Codable {
        case string, number, boolean
    }
}

struct ParameterUsage: Codable {
    let step: Int
    let location: StepInputMapping.TargetLocation
    let key: String
}

struct ReturnDef: Codable {
    let description: String
    let fields: [ReturnField]
}

struct ReturnField: Codable {
    let name: String
    let type: String
    let description: String
    let source: ReturnFieldSource
}

struct ReturnFieldSource: Codable {
    let step: Int
    let jsonPath: String
}

struct AuthPattern: Codable {
    let type: AuthType
    let credentialFields: [CredentialField]

    enum AuthType: String, Codable {
        case cookie, bearer, apiKey = "api_key", custom
    }
}

struct CredentialField: Codable {
    let name: String
    let description: String
    let location: CredentialLocation

    enum CredentialLocation: String, Codable {
        case header, cookie, query
    }
}

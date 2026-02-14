import Foundation

enum PlaybackStatus: String, Codable {
    case idle, starting, running, paused, completed, error
}

struct PlaybackState: Codable {
    var status: PlaybackStatus
    var currentStep: Int
    var totalSteps: Int
    var completedSteps: [Int]
    var error: String?
    var result: [String: AnyCodable]?
}

struct PlaybackParams: Codable {
    let workflowId: String
    let parameters: [String: AnyCodable]
}

/// Type-erased Codable wrapper for heterogeneous JSON values.
struct AnyCodable: Codable, Hashable {
    let value: Any

    init(_ value: Any) {
        self.value = value
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            value = NSNull()
        } else if let bool = try? container.decode(Bool.self) {
            value = bool
        } else if let int = try? container.decode(Int.self) {
            value = int
        } else if let double = try? container.decode(Double.self) {
            value = double
        } else if let string = try? container.decode(String.self) {
            value = string
        } else if let array = try? container.decode([AnyCodable].self) {
            value = array.map(\.value)
        } else if let dict = try? container.decode([String: AnyCodable].self) {
            value = dict.mapValues(\.value)
        } else {
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Unsupported type")
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch value {
        case is NSNull:
            try container.encodeNil()
        case let bool as Bool:
            try container.encode(bool)
        case let int as Int:
            try container.encode(int)
        case let double as Double:
            try container.encode(double)
        case let string as String:
            try container.encode(string)
        case let array as [Any]:
            try container.encode(array.map { AnyCodable($0) })
        case let dict as [String: Any]:
            try container.encode(dict.mapValues { AnyCodable($0) })
        default:
            throw EncodingError.invalidValue(value, .init(codingPath: encoder.codingPath, debugDescription: "Unsupported type"))
        }
    }

    func hash(into hasher: inout Hasher) {
        if let s = value as? String { hasher.combine(s) }
        else if let i = value as? Int { hasher.combine(i) }
        else if let d = value as? Double { hasher.combine(d) }
        else if let b = value as? Bool { hasher.combine(b) }
        else { hasher.combine(0) }
    }

    static func == (lhs: AnyCodable, rhs: AnyCodable) -> Bool {
        switch (lhs.value, rhs.value) {
        case let (l as String, r as String): return l == r
        case let (l as Int, r as Int): return l == r
        case let (l as Double, r as Double): return l == r
        case let (l as Bool, r as Bool): return l == r
        case (is NSNull, is NSNull): return true
        default: return false
        }
    }
}

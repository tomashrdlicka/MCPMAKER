import Foundation

enum RecordingState: String {
    case idle
    case starting
    case recording
    case stopping
}

enum EngineStatus: String {
    case starting
    case ready
    case error
    case stopped
}

enum LotusState: String {
    case idle
    case breathing
    case bloom
    case success
}

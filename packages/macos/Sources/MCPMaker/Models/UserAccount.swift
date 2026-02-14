import Foundation

struct UserAccount: Codable {
    let id: String
    let email: String
    var tier: Tier
    var usage: Usage

    enum Tier: String, Codable {
        case free, pro, max
    }

    struct Usage: Codable {
        var recordingsThisMonth: Int
        var playbacksThisMonth: Int
        var analysesThisMonth: Int
        let periodStart: String
        let periodEnd: String
    }
}

struct AuthResponse: Codable {
    let token: String
    let refreshToken: String
    let account: UserAccount
}

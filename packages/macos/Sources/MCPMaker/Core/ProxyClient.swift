import Foundation

/// HTTPS client for the cloud auth/billing proxy at api.mcpmaker.com.
struct ProxyClient {
    let baseURL: URL

    init(baseURL: URL = URL(string: Constants.proxyBaseURL)!) {
        self.baseURL = baseURL
    }

    // MARK: - Auth

    func signUp(email: String, password: String) async throws -> AuthResponse {
        let url = baseURL.appendingPathComponent("v1/auth/signup")
        let body = AuthRequest(email: email, password: password)
        let response: AuthResponse = try await post(url: url, body: body, authenticated: false)

        // Persist tokens
        KeychainHelper.authToken = response.token
        KeychainHelper.refreshToken = response.refreshToken

        return response
    }

    func signIn(email: String, password: String) async throws -> AuthResponse {
        let url = baseURL.appendingPathComponent("v1/auth/signin")
        let body = AuthRequest(email: email, password: password)
        let response: AuthResponse = try await post(url: url, body: body, authenticated: false)

        KeychainHelper.authToken = response.token
        KeychainHelper.refreshToken = response.refreshToken

        return response
    }

    func getAccount() async throws -> UserAccount {
        let url = baseURL.appendingPathComponent("v1/account")
        return try await get(url: url)
    }

    func refreshToken() async throws -> AuthResponse {
        guard let token = KeychainHelper.refreshToken else {
            throw ProxyClientError.notAuthenticated
        }

        let url = baseURL.appendingPathComponent("v1/auth/refresh")
        let body = RefreshRequest(refreshToken: token)
        let response: AuthResponse = try await post(url: url, body: body, authenticated: false)

        KeychainHelper.authToken = response.token
        KeychainHelper.refreshToken = response.refreshToken

        return response
    }

    func signOut() {
        KeychainHelper.authToken = nil
        KeychainHelper.refreshToken = nil
    }

    // MARK: - Private

    private func get<T: Decodable>(url: URL) async throws -> T {
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        try addAuth(to: &request)

        let (data, response) = try await URLSession.shared.data(for: request)
        return try handleResponse(data: data, response: response)
    }

    private func post<B: Encodable, T: Decodable>(
        url: URL, body: B, authenticated: Bool = true
    ) async throws -> T {
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(body)

        if authenticated {
            try addAuth(to: &request)
        }

        let (data, response) = try await URLSession.shared.data(for: request)
        return try handleResponse(data: data, response: response)
    }

    private func addAuth(to request: inout URLRequest) throws {
        guard let token = KeychainHelper.authToken else {
            throw ProxyClientError.notAuthenticated
        }
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    }

    private func handleResponse<T: Decodable>(data: Data, response: URLResponse) throws -> T {
        guard let http = response as? HTTPURLResponse else {
            throw ProxyClientError.invalidResponse
        }

        if http.statusCode == 401 {
            throw ProxyClientError.notAuthenticated
        }

        guard (200...299).contains(http.statusCode) else {
            let body = String(data: data, encoding: .utf8) ?? ""
            throw ProxyClientError.httpError(http.statusCode, body)
        }

        return try JSONDecoder().decode(T.self, from: data)
    }
}

// MARK: - Request Types

private struct AuthRequest: Encodable {
    let email: String
    let password: String
}

private struct RefreshRequest: Encodable {
    let refreshToken: String
}

// MARK: - Errors

enum ProxyClientError: LocalizedError {
    case notAuthenticated
    case invalidResponse
    case httpError(Int, String)

    var errorDescription: String? {
        switch self {
        case .notAuthenticated:
            return "Please sign in to continue"
        case .invalidResponse:
            return "The server returned an unexpected response"
        case .httpError(let code, let body):
            if code == 429 {
                return "You've reached your usage limit for this billing period. Upgrade your plan to continue."
            }
            return "Server error (HTTP \(code)): \(body.prefix(200))"
        }
    }
}

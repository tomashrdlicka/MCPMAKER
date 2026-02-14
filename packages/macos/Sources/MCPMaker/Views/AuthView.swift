import SwiftUI

/// Sign in / create account sheet.
struct AuthView: View {
    @EnvironmentObject private var appState: AppState
    @Environment(\.dismiss) private var dismiss

    @State private var isSignUp = false
    @State private var email = ""
    @State private var password = ""
    @State private var confirmPassword = ""
    @State private var isLoading = false
    @State private var errorMessage: String?

    var body: some View {
        VStack(spacing: 20) {
            LotusView(state: .idle, size: 48)

            Text(isSignUp ? "Create Account" : "Sign In")
                .font(.title2.bold())

            Text("Record and replay web workflows with AI")
                .font(.callout)
                .foregroundStyle(.secondary)

            VStack(spacing: 12) {
                TextField("Email", text: $email)
                    .textFieldStyle(.roundedBorder)
                    .textContentType(.emailAddress)

                SecureField("Password", text: $password)
                    .textFieldStyle(.roundedBorder)
                    .textContentType(isSignUp ? .newPassword : .password)

                if isSignUp {
                    SecureField("Confirm Password", text: $confirmPassword)
                        .textFieldStyle(.roundedBorder)
                        .textContentType(.newPassword)
                }
            }

            if let error = errorMessage {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .multilineTextAlignment(.center)
            }

            Button {
                Task { await submit() }
            } label: {
                if isLoading {
                    ProgressView()
                        .controlSize(.small)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 8)
                } else {
                    Text(isSignUp ? "Create Account" : "Sign In")
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 8)
                }
            }
            .buttonStyle(GlassButtonStyle(isProminent: true))
            .disabled(isLoading || email.isEmpty || password.isEmpty)
            .keyboardShortcut(.defaultAction)

            Button(isSignUp ? "Already have an account? Sign In" : "Need an account? Create one") {
                isSignUp.toggle()
                errorMessage = nil
            }
            .buttonStyle(.plain)
            .font(.caption)
            .foregroundStyle(.secondary)

            Button("Cancel") {
                dismiss()
            }
            .buttonStyle(.plain)
            .font(.caption)
            .foregroundStyle(.tertiary)
        }
        .padding(24)
        .frame(width: 360)
    }

    private func submit() async {
        errorMessage = nil
        isLoading = true
        defer { isLoading = false }

        if isSignUp {
            guard password == confirmPassword else {
                errorMessage = "Passwords do not match"
                return
            }
            guard password.count >= 8 else {
                errorMessage = "Password must be at least 8 characters"
                return
            }
        }

        do {
            if isSignUp {
                try await appState.signUp(email: email, password: password)
            } else {
                try await appState.signIn(email: email, password: password)
            }
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

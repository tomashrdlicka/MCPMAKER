import SwiftUI

/// URL input sheet shown before recording starts.
struct RecordPromptView: View {
    @EnvironmentObject private var appState: AppState
    @State private var url: String = ""
    @State private var isValidURL = true
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 20) {
            LotusView(state: .idle, size: 40)

            Text("Start Recording")
                .font(.title3.bold())

            Text("Enter the URL where the workflow begins")
                .font(.callout)
                .foregroundStyle(.secondary)

            VStack(alignment: .leading, spacing: 4) {
                TextField("Where should we start?", text: $url)
                    .textFieldStyle(.roundedBorder)
                    .onSubmit { startRecording() }

                if !isValidURL {
                    Text("Please enter a valid URL (e.g. https://example.com)")
                        .font(.caption)
                        .foregroundStyle(.red)
                }
            }

            HStack(spacing: 12) {
                Button("Cancel") {
                    dismiss()
                }
                .buttonStyle(GlassButtonStyle())
                .keyboardShortcut(.cancelAction)

                Button("Record") {
                    startRecording()
                }
                .buttonStyle(GlassButtonStyle(isProminent: true))
                .keyboardShortcut(.defaultAction)
                .disabled(url.isEmpty)
            }
        }
        .padding(24)
        .frame(width: 400)
        .glassEffect(cornerRadius: 16)
    }

    private func startRecording() {
        var normalizedURL = url.trimmingCharacters(in: .whitespacesAndNewlines)

        // Auto-add https:// if missing
        if !normalizedURL.hasPrefix("http://") && !normalizedURL.hasPrefix("https://") {
            normalizedURL = "https://\(normalizedURL)"
        }

        guard URL(string: normalizedURL) != nil else {
            isValidURL = false
            return
        }

        isValidURL = true
        dismiss()
        Task { await appState.startRecording(url: normalizedURL) }
    }
}

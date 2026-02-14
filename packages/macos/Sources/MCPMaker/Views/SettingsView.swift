import SwiftUI

/// App preferences window.
struct SettingsView: View {
    @EnvironmentObject private var appState: AppState
    @AppStorage("chromePath") private var customChromePath: String = ""
    @AppStorage("recordingHotkey") private var recordingHotkey: String = "Cmd+Shift+R"

    var body: some View {
        TabView {
            generalTab
                .tabItem {
                    Label("General", systemImage: "gear")
                }

            accountTab
                .tabItem {
                    Label("Account", systemImage: "person.circle")
                }

            aboutTab
                .tabItem {
                    Label("About", systemImage: "info.circle")
                }
        }
        .frame(width: 450, height: 300)
    }

    // MARK: - General

    private var generalTab: some View {
        Form {
            Section("Chrome") {
                LabeledContent("Path") {
                    HStack {
                        TextField("Auto-detected", text: $customChromePath)
                            .textFieldStyle(.roundedBorder)

                        Button("Browse") {
                            browseForChrome()
                        }
                    }
                }

                if let detected = ChromeLauncher.findChrome() {
                    LabeledContent("Detected") {
                        Text(detected)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }

            Section("Engine") {
                LabeledContent("Status") {
                    HStack(spacing: 6) {
                        Circle()
                            .fill(engineStatusColor)
                            .frame(width: 8, height: 8)
                        Text(appState.engineStatus.rawValue)
                    }
                }

                LabeledContent("Port") {
                    Text("\(Constants.enginePort)")
                        .foregroundStyle(.secondary)
                }
            }
        }
        .formStyle(.grouped)
        .padding()
    }

    // MARK: - Account

    private var accountTab: some View {
        Form {
            if let account = appState.account {
                Section("Profile") {
                    LabeledContent("Email") { Text(account.email) }
                    LabeledContent("Plan") {
                        Text(account.tier.rawValue.capitalized)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 2)
                            .background(.purple.opacity(0.15))
                            .foregroundStyle(.purple)
                            .clipShape(Capsule())
                    }
                }

                Section("Usage This Month") {
                    LabeledContent("Recordings") {
                        Text("\(account.usage.recordingsThisMonth)")
                    }
                    LabeledContent("Playbacks") {
                        Text("\(account.usage.playbacksThisMonth)")
                    }
                    LabeledContent("Analyses") {
                        Text("\(account.usage.analysesThisMonth)")
                    }
                }

                Section {
                    Button("Sign Out") {
                        appState.signOut()
                    }
                    .foregroundStyle(.red)
                }
            } else {
                VStack(spacing: 12) {
                    Text("Not signed in")
                        .foregroundStyle(.secondary)
                    Button("Sign In") {
                        appState.showAuthWindow = true
                    }
                    .buttonStyle(GlassButtonStyle(isProminent: true))
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .formStyle(.grouped)
        .padding()
    }

    // MARK: - About

    private var aboutTab: some View {
        VStack(spacing: 16) {
            LotusView(state: .idle, size: 48)

            Text("MCPMaker")
                .font(.title2.bold())

            Text("Record once. Press play.")
                .font(.callout)
                .foregroundStyle(.secondary)

            Text("Version 0.1.0")
                .font(.caption)
                .foregroundStyle(.tertiary)

            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding()
    }

    // MARK: - Helpers

    private var engineStatusColor: Color {
        switch appState.engineStatus {
        case .ready: return .green
        case .starting: return .orange
        case .error: return .red
        case .stopped: return .gray
        }
    }

    private func browseForChrome() {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false
        panel.canChooseFiles = true
        panel.allowedContentTypes = [.unixExecutable]
        panel.message = "Select the Google Chrome executable"

        if panel.runModal() == .OK, let url = panel.url {
            customChromePath = url.path
        }
    }
}

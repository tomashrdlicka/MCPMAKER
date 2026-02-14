import SwiftUI

/// Rich menubar dropdown content shown when clicking the lotus icon.
struct MenuBarView: View {
    @EnvironmentObject private var appState: AppState

    var body: some View {
        VStack(spacing: 0) {
            if !appState.isAuthenticated {
                authPrompt
            } else if appState.recordingState == .recording {
                recordingView
            } else if case .completed = appState.playbackStatus, appState.lastCapturedWorkflow != nil {
                WorkflowCapturedView()
            } else {
                mainMenu
            }
        }
        .frame(width: 300)
        .padding(12)
        .glassEffect(cornerRadius: 12)
    }

    // MARK: - Auth Prompt

    private var authPrompt: some View {
        VStack(spacing: 12) {
            LotusView(state: .idle, size: 40)
            Text("MCPMaker")
                .font(.headline)
            Text("Sign in to start recording workflows")
                .font(.caption)
                .foregroundStyle(.secondary)

            Button("Sign In") {
                appState.showAuthWindow = true
            }
            .buttonStyle(GlassButtonStyle(isProminent: true))
        }
        .padding(.vertical, 8)
    }

    // MARK: - Recording View

    private var recordingView: some View {
        VStack(spacing: 12) {
            LotusView(state: .breathing, size: 32)

            Text("Recording...")
                .font(.headline)

            Text("\(appState.recordingEventCount) events captured")
                .font(.caption)
                .foregroundStyle(.secondary)

            Button("Stop Recording") {
                Task { await appState.stopRecording() }
            }
            .buttonStyle(GlassButtonStyle(isProminent: true))
            .keyboardShortcut("r", modifiers: [.command, .shift])
        }
        .padding(.vertical, 8)
    }

    // MARK: - Main Menu

    private var mainMenu: some View {
        VStack(spacing: 8) {
            // Record button
            Button {
                appState.showRecordPrompt = true
            } label: {
                HStack {
                    Image(systemName: "record.circle")
                        .foregroundStyle(.red)
                    Text("Record")
                    Spacer()
                    Text("Cmd+Shift+R")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
            }
            .buttonStyle(.plain)
            .padding(.vertical, 4)

            Divider()

            // Recent workflows
            if appState.workflows.isEmpty {
                Text("No workflows yet")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding(.vertical, 8)
            } else {
                ForEach(appState.workflows.prefix(5)) { workflow in
                    WorkflowMenuRow(workflow: workflow)
                }

                if appState.workflows.count > 5 {
                    Button("See all...") {
                        appState.showMainWindow = true
                    }
                    .buttonStyle(.plain)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                }
            }

            Divider()

            // Bottom actions
            Button {
                appState.showMainWindow = true
            } label: {
                HStack {
                    Image(systemName: "list.bullet.rectangle")
                    Text("Manage Workflows")
                    Spacer()
                    Text("Cmd+1")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
            }
            .buttonStyle(.plain)
            .padding(.vertical, 2)

            Button {
                appState.showSettings = true
            } label: {
                HStack {
                    Image(systemName: "gear")
                    Text("Settings")
                    Spacer()
                }
            }
            .buttonStyle(.plain)
            .padding(.vertical, 2)

            Divider()

            HStack {
                Text(appState.account?.email ?? "")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
                Spacer()
                Button("Sign Out") {
                    appState.signOut()
                }
                .buttonStyle(.plain)
                .font(.caption2)
                .foregroundStyle(.secondary)
            }
        }
    }
}

/// Single workflow row in the menubar dropdown.
private struct WorkflowMenuRow: View {
    let workflow: Workflow
    @EnvironmentObject private var appState: AppState

    var body: some View {
        Button {
            appState.selectedWorkflow = workflow
            appState.showMainWindow = true
        } label: {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(workflow.name)
                        .font(.callout)
                        .lineLimit(1)
                    Text(workflow.sitePattern)
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
                Spacer()
                Button {
                    Task { await appState.playWorkflow(workflow) }
                } label: {
                    Image(systemName: "play.fill")
                        .font(.caption)
                }
                .buttonStyle(GlassButtonStyle())
            }
        }
        .buttonStyle(.plain)
        .padding(.vertical, 2)
    }
}

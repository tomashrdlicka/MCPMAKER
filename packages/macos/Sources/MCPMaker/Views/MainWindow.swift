import SwiftUI

/// Main application window with NavigationSplitView layout.
struct MainWindow: View {
    @EnvironmentObject private var appState: AppState

    var body: some View {
        NavigationSplitView {
            SidebarView()
        } detail: {
            if let workflow = appState.selectedWorkflow {
                WorkflowDetailView(workflow: workflow)
            } else {
                emptyState
            }
        }
        .frame(minWidth: 700, minHeight: 450)
        .background(.ultraThinMaterial)
        .sheet(isPresented: $appState.showRecordPrompt) {
            RecordPromptView()
        }
        .sheet(isPresented: $appState.showAuthWindow) {
            AuthView()
        }
    }

    private var emptyState: some View {
        VStack(spacing: 16) {
            LotusView(state: .idle, size: 60)

            Text("No workflow selected")
                .font(.title3)
                .foregroundStyle(.secondary)

            Text("Select a workflow from the sidebar or record a new one")
                .font(.caption)
                .foregroundStyle(.tertiary)

            Button("Record New Workflow") {
                appState.showRecordPrompt = true
            }
            .buttonStyle(GlassButtonStyle(isProminent: true))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

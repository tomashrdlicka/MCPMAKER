import SwiftUI

/// Post-recording success card shown in the menubar dropdown.
struct WorkflowCapturedView: View {
    @EnvironmentObject private var appState: AppState
    @State private var editedName: String = ""

    var body: some View {
        VStack(spacing: 16) {
            LotusView(state: .success, size: 40)

            Text("Workflow captured")
                .font(.headline)

            if let workflow = appState.lastCapturedWorkflow {
                VStack(spacing: 8) {
                    TextField("Workflow name", text: $editedName)
                        .textFieldStyle(.roundedBorder)
                        .multilineTextAlignment(.center)
                        .onSubmit {
                            appState.renameWorkflow(workflow, to: editedName)
                        }

                    Text("\(workflow.sessions.count) session(s) - \(workflow.definition?.steps.count ?? 0) steps")
                        .font(.caption)
                        .foregroundStyle(.secondary)

                    Button {
                        Task { await appState.playWorkflow(workflow) }
                    } label: {
                        HStack {
                            LotusShape(openAmount: 0.8)
                                .fill(.white)
                                .frame(width: 14, height: 14)
                            Text("Play")
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 8)
                    }
                    .buttonStyle(GlassButtonStyle(isProminent: true))
                }
            }

            Button("Done") {
                appState.lastCapturedWorkflow = nil
            }
            .buttonStyle(GlassButtonStyle())
        }
        .padding(.vertical, 8)
        .onAppear {
            editedName = appState.lastCapturedWorkflow?.name ?? "Untitled Workflow"
        }
    }
}

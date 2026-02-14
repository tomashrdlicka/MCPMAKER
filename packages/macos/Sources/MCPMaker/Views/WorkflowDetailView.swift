import SwiftUI

/// Detail view for a selected workflow: steps, parameters, and play button.
struct WorkflowDetailView: View {
    let workflow: Workflow
    @EnvironmentObject private var appState: AppState
    @State private var isEditing = false
    @State private var editedName: String = ""
    @State private var parameterValues: [String: String] = [:]
    @State private var showDeleteConfirmation = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                header
                if let definition = workflow.definition {
                    parametersSection(definition.parameters)
                    playButton
                    stepsSection(definition.steps)
                    metadataSection(definition)
                } else {
                    noDefinitionView
                }
            }
            .padding(24)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .onAppear {
            editedName = workflow.name
            // Pre-fill parameter examples
            if let params = workflow.definition?.parameters {
                for param in params where parameterValues[param.name] == nil {
                    parameterValues[param.name] = ""
                }
            }
        }
        .alert("Delete Workflow?", isPresented: $showDeleteConfirmation) {
            Button("Delete", role: .destructive) {
                appState.deleteWorkflow(workflow)
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This will permanently remove '\(workflow.name)' and its recordings.")
        }
    }

    // MARK: - Header

    private var header: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 4) {
                if isEditing {
                    TextField("Workflow name", text: $editedName)
                        .textFieldStyle(.plain)
                        .font(.title2.bold())
                        .onSubmit {
                            appState.renameWorkflow(workflow, to: editedName)
                            isEditing = false
                        }
                } else {
                    Text(workflow.name)
                        .font(.title2.bold())
                        .onTapGesture(count: 2) { isEditing = true }
                }

                Text(workflow.sitePattern)
                    .font(.callout)
                    .foregroundStyle(.secondary)

                if let description = workflow.definition?.description {
                    Text(description)
                        .font(.body)
                        .foregroundStyle(.secondary)
                        .padding(.top, 4)
                }
            }

            Spacer()

            Menu {
                Button("Rename") { isEditing = true }
                Divider()
                Button("Delete", role: .destructive) {
                    showDeleteConfirmation = true
                }
            } label: {
                Image(systemName: "ellipsis.circle")
                    .font(.title3)
            }
            .menuStyle(.borderlessButton)
            .frame(width: 30)
        }
    }

    // MARK: - Parameters

    @ViewBuilder
    private func parametersSection(_ parameters: [ParameterDef]) -> some View {
        if !parameters.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                Text("Parameters")
                    .font(.headline)

                ParameterFormView(parameters: parameters, values: $parameterValues)
            }
        }
    }

    // MARK: - Play Button

    private var playButton: some View {
        Button {
            Task { await appState.playWorkflow(workflow, parameters: parameterValues) }
        } label: {
            HStack {
                LotusShape(openAmount: 0.8)
                    .fill(.white)
                    .frame(width: 16, height: 16)
                Text("Play")
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 10)
        }
        .buttonStyle(GlassButtonStyle(isProminent: true))
    }

    // MARK: - Steps

    private func stepsSection(_ steps: [WorkflowStep]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Steps")
                .font(.headline)

            ForEach(steps) { step in
                HStack(alignment: .top, spacing: 10) {
                    Text("\(step.order)")
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(.secondary)
                        .frame(width: 20, alignment: .trailing)

                    VStack(alignment: .leading, spacing: 2) {
                        Text(step.description)
                            .font(.callout)

                        if let action = step.domAction {
                            HStack(spacing: 4) {
                                Text(action.type.rawValue)
                                    .font(.caption2)
                                    .padding(.horizontal, 6)
                                    .padding(.vertical, 1)
                                    .background(.fill.tertiary)
                                    .clipShape(Capsule())

                                if let label = action.ariaLabel ?? action.textContent {
                                    Text(label)
                                        .font(.caption2)
                                        .foregroundStyle(.tertiary)
                                        .lineLimit(1)
                                }
                            }
                        }
                    }

                    Spacer()
                }
                .padding(.vertical, 4)
            }
        }
    }

    // MARK: - Metadata

    private func metadataSection(_ definition: WorkflowDefinition) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Details")
                .font(.headline)

            Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 4) {
                GridRow {
                    Text("Base URL")
                        .foregroundStyle(.secondary)
                    Text(definition.baseUrl)
                }
                GridRow {
                    Text("Confidence")
                        .foregroundStyle(.secondary)
                    Text(definition.confidence.rawValue)
                }
                GridRow {
                    Text("Recordings")
                        .foregroundStyle(.secondary)
                    Text("\(definition.recordingCount)")
                }
                GridRow {
                    Text("Auth")
                        .foregroundStyle(.secondary)
                    Text(definition.auth.type.rawValue)
                }
            }
            .font(.callout)
        }
    }

    // MARK: - No Definition

    private var noDefinitionView: some View {
        VStack(spacing: 12) {
            Image(systemName: "wand.and.stars")
                .font(.largeTitle)
                .foregroundStyle(.secondary)

            Text("Workflow not yet analyzed")
                .font(.callout)
                .foregroundStyle(.secondary)

            Text("Record this workflow again to trigger analysis, or record additional sessions for better accuracy.")
                .font(.caption)
                .foregroundStyle(.tertiary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 30)
    }
}

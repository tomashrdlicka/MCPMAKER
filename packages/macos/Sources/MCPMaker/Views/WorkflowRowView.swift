import SwiftUI

/// Single workflow row displayed in the sidebar list.
struct WorkflowRowView: View {
    let workflow: Workflow

    var body: some View {
        HStack(spacing: 10) {
            // Status indicator
            Circle()
                .fill(statusColor)
                .frame(width: 8, height: 8)

            VStack(alignment: .leading, spacing: 2) {
                Text(workflow.name)
                    .font(.callout)
                    .lineLimit(1)

                HStack(spacing: 4) {
                    if let definition = workflow.definition {
                        Text("\(definition.steps.count) steps")
                            .font(.caption2)
                            .foregroundStyle(.secondary)

                        if !definition.parameters.isEmpty {
                            Text("- \(definition.parameters.count) params")
                                .font(.caption2)
                                .foregroundStyle(.tertiary)
                        }
                    } else {
                        Text("Not analyzed")
                            .font(.caption2)
                            .foregroundStyle(.orange)
                    }
                }
            }

            Spacer()

            // Confidence badge
            if let confidence = workflow.definition?.confidence {
                Text(confidence.rawValue)
                    .font(.caption2)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(confidenceColor(confidence).opacity(0.15))
                    .foregroundStyle(confidenceColor(confidence))
                    .clipShape(Capsule())
            }
        }
        .padding(.vertical, 2)
    }

    private var statusColor: Color {
        if workflow.definition != nil {
            return .green
        }
        return .orange
    }

    private func confidenceColor(_ confidence: WorkflowDefinition.Confidence) -> Color {
        switch confidence {
        case .high: return .green
        case .medium: return .orange
        case .low: return .red
        }
    }
}

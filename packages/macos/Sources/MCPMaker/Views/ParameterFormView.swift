import SwiftUI

/// Inline parameter input form shown before playback.
struct ParameterFormView: View {
    let parameters: [ParameterDef]
    @Binding var values: [String: String]

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(parameters) { param in
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 4) {
                        Text(param.name)
                            .font(.callout.bold())
                        if param.required {
                            Text("*")
                                .foregroundStyle(.red)
                        }
                    }

                    if !param.description.isEmpty {
                        Text(param.description)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }

                    parameterInput(for: param)
                }
            }
        }
    }

    @ViewBuilder
    private func parameterInput(for param: ParameterDef) -> some View {
        switch param.type {
        case .boolean:
            Toggle(
                "",
                isOn: Binding(
                    get: { values[param.name] == "true" },
                    set: { values[param.name] = $0 ? "true" : "false" }
                )
            )
            .labelsHidden()

        case .number:
            TextField(param.example, text: binding(for: param.name))
                .textFieldStyle(.roundedBorder)

        case .string:
            TextField(param.example, text: binding(for: param.name))
                .textFieldStyle(.roundedBorder)
        }
    }

    private func binding(for key: String) -> Binding<String> {
        Binding(
            get: { values[key] ?? "" },
            set: { values[key] = $0 }
        )
    }
}

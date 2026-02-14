import SwiftUI

/// Sidebar showing workflow list grouped by site domain.
struct SidebarView: View {
    @EnvironmentObject private var appState: AppState
    @State private var searchText = ""

    private var filteredWorkflows: [Workflow] {
        if searchText.isEmpty {
            return appState.workflows
        }
        let query = searchText.lowercased()
        return appState.workflows.filter {
            $0.name.lowercased().contains(query) ||
            $0.sitePattern.lowercased().contains(query)
        }
    }

    private var groupedWorkflows: [(String, [Workflow])] {
        let grouped = Dictionary(grouping: filteredWorkflows) { $0.sitePattern }
        return grouped.sorted { $0.key < $1.key }
    }

    var body: some View {
        List(selection: Binding(
            get: { appState.selectedWorkflow },
            set: { appState.selectedWorkflow = $0 }
        )) {
            ForEach(groupedWorkflows, id: \.0) { domain, workflows in
                Section(domain) {
                    ForEach(workflows) { workflow in
                        WorkflowRowView(workflow: workflow)
                            .tag(workflow)
                            .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                                Button(role: .destructive) {
                                    appState.deleteWorkflow(workflow)
                                } label: {
                                    Label("Delete", systemImage: "trash")
                                }
                            }
                    }
                }
            }
        }
        .listStyle(.sidebar)
        .searchable(text: $searchText, prompt: "Search workflows")
        .toolbar {
            ToolbarItem {
                Button {
                    appState.showRecordPrompt = true
                } label: {
                    Label("Record", systemImage: "record.circle")
                }
            }
        }
        .navigationTitle("Workflows")
    }
}

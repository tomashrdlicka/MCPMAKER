import SwiftUI

/// Floating glass panel showing playback progress (picture-in-picture style).
/// Displayed as a separate NSPanel positioned at the bottom-right of the screen.
struct PiPPanelView: View {
    @EnvironmentObject private var appState: AppState
    @State private var autoDismissTask: Task<Void, Never>?

    var body: some View {
        VStack(spacing: 10) {
            HStack {
                LotusView(state: lotusState, size: 20)

                VStack(alignment: .leading, spacing: 2) {
                    Text(statusText)
                        .font(.callout.bold())
                        .lineLimit(1)

                    if !appState.playbackStepName.isEmpty {
                        Text(appState.playbackStepName)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                }

                Spacer()

                if appState.playbackStatus == .running {
                    Button {
                        appState.stopPlayback()
                    } label: {
                        Image(systemName: "stop.fill")
                            .font(.caption)
                    }
                    .buttonStyle(GlassButtonStyle())
                }
            }

            // Progress dots
            if appState.playbackTotalSteps > 0 {
                HStack(spacing: 4) {
                    ForEach(0..<appState.playbackTotalSteps, id: \.self) { index in
                        Circle()
                            .fill(dotColor(for: index))
                            .frame(width: 6, height: 6)
                    }
                }
            }

            // Error state
            if appState.playbackStatus == .error {
                HStack(spacing: 8) {
                    Button("Retry") {
                        Task { await appState.retryPlayback() }
                    }
                    .buttonStyle(GlassButtonStyle(isProminent: true))

                    Button("Stop") {
                        appState.stopPlayback()
                    }
                    .buttonStyle(GlassButtonStyle())
                }
            }
        }
        .padding(14)
        .frame(width: 260)
        .glassEffect(cornerRadius: 12)
        .onChange(of: appState.playbackStatus) { _, newStatus in
            if newStatus == .completed {
                scheduleAutoDismiss()
            }
        }
    }

    private var lotusState: LotusState {
        switch appState.playbackStatus {
        case .running: return .breathing
        case .completed: return .success
        case .error: return .idle
        default: return .idle
        }
    }

    private var statusText: String {
        switch appState.playbackStatus {
        case .starting: return "Starting..."
        case .running: return "Step \(appState.playbackCurrentStep + 1) of \(appState.playbackTotalSteps)"
        case .completed: return "Complete"
        case .error: return "Failed"
        case .paused: return "Paused"
        default: return "Idle"
        }
    }

    private func dotColor(for index: Int) -> Color {
        if index < appState.playbackCurrentStep {
            return .green
        } else if index == appState.playbackCurrentStep && appState.playbackStatus == .running {
            return .blue
        } else if appState.playbackStatus == .error && index == appState.playbackCurrentStep {
            return .red
        }
        return .gray.opacity(0.3)
    }

    private func scheduleAutoDismiss() {
        autoDismissTask?.cancel()
        autoDismissTask = Task {
            try? await Task.sleep(nanoseconds: UInt64(Constants.pipAutoDismissS * 1_000_000_000))
            if !Task.isCancelled {
                appState.showPiPPanel = false
            }
        }
    }
}

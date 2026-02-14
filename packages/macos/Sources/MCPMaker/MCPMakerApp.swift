import SwiftUI

@main
struct MCPMakerApp: App {
    @StateObject private var appState = AppState()

    var body: some Scene {
        // Menubar icon with rich dropdown
        MenuBarExtra {
            MenuBarView()
                .environmentObject(appState)
        } label: {
            LotusMenuBarIcon(state: appState.lotusState)
        }
        .menuBarExtraStyle(.window)

        // Main workflow management window
        WindowGroup("MCPMaker") {
            MainWindow()
                .environmentObject(appState)
                .onAppear { registerGlobalHotkeys() }
        }
        .defaultSize(width: 900, height: 600)
        .windowStyle(.hiddenTitleBar)
        .commands {
            CommandGroup(replacing: .newItem) {
                Button("Record Workflow") {
                    appState.showRecordPrompt = true
                }
                .keyboardShortcut("r", modifiers: [.command, .shift])
            }

            CommandGroup(after: .windowArrangement) {
                Button("Manage Workflows") {
                    appState.showMainWindow = true
                }
                .keyboardShortcut("1", modifiers: .command)
            }
        }

        // Settings window
        Settings {
            SettingsView()
                .environmentObject(appState)
        }

        // PiP panel (floating playback progress)
        WindowGroup("Playback", id: "pip") {
            PiPPanelView()
                .environmentObject(appState)
        }
        .windowStyle(.hiddenTitleBar)
        .windowResizability(.contentSize)
        .defaultPosition(.bottomTrailing)
    }

    /// Register global keyboard shortcuts via NSEvent monitoring.
    private func registerGlobalHotkeys() {
        NSEvent.addGlobalMonitorForEvents(matching: .keyDown) { event in
            // Cmd+Shift+R: Toggle recording
            if event.modifierFlags.contains([.command, .shift]) && event.keyCode == 15 { // 15 = 'r'
                Task { @MainActor in
                    if appState.recordingState == .recording {
                        await appState.stopRecording()
                    } else if appState.recordingState == .idle {
                        appState.showRecordPrompt = true
                    }
                }
            }
        }
    }
}

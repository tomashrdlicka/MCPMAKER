import SwiftUI
import Combine

/// Central observable state for the entire app.
@MainActor
class AppState: ObservableObject {
    // MARK: - Auth

    @Published var account: UserAccount?
    @Published var isAuthenticated = false

    // MARK: - Lotus Visual State

    @Published var lotusState: LotusState = .idle

    // MARK: - Workflows

    @Published var workflows: [Workflow] = []
    @Published var selectedWorkflow: Workflow?
    @Published var lastCapturedWorkflow: Workflow?

    // MARK: - Recording

    @Published var recordingState: RecordingState = .idle
    @Published var recordingEventCount = 0

    // MARK: - Playback

    @Published var playbackStatus: PlaybackStatus = .idle
    @Published var playbackCurrentStep = 0
    @Published var playbackTotalSteps = 0
    @Published var playbackStepName = ""

    // MARK: - Engine

    @Published var engineStatus: EngineStatus = .starting

    // MARK: - UI State

    @Published var showRecordPrompt = false
    @Published var showAuthWindow = false
    @Published var showMainWindow = false
    @Published var showSettings = false
    @Published var showPiPPanel = false

    // MARK: - Controllers

    let engineProcess = EngineProcess()
    let engineClient = EngineClient()
    let proxyClient = ProxyClient()
    var chromeBridge: ChromeBridge?
    var recordingController: RecordingController?
    var playbackController: PlaybackController?

    private var cancellables = Set<AnyCancellable>()

    // MARK: - Initialization

    init() {
        // Restore auth state
        if KeychainHelper.authToken != nil {
            isAuthenticated = true
            Task { await refreshAccount() }
        }

        // Observe engine status
        engineProcess.$status
            .receive(on: RunLoop.main)
            .assign(to: &$engineStatus)

        // Start the engine
        engineProcess.start()

        // Load workflows from disk
        loadWorkflows()

        // Request notification permission
        AppNotifications.requestPermission()
        AppNotifications.registerCategories()
    }

    // MARK: - Auth Actions

    func signIn(email: String, password: String) async throws {
        let response = try await proxyClient.signIn(email: email, password: password)
        account = response.account
        isAuthenticated = true
    }

    func signUp(email: String, password: String) async throws {
        let response = try await proxyClient.signUp(email: email, password: password)
        account = response.account
        isAuthenticated = true
    }

    func signOut() {
        proxyClient.signOut()
        account = nil
        isAuthenticated = false
    }

    private func refreshAccount() async {
        do {
            account = try await proxyClient.getAccount()
        } catch {
            // Token might be expired, try refresh
            do {
                let response = try await proxyClient.refreshToken()
                account = response.account
            } catch {
                // Refresh failed, user needs to sign in again
                signOut()
            }
        }
    }

    // MARK: - Recording Actions

    func startRecording(url: String) async {
        guard recordingState == .idle else { return }

        recordingState = .starting
        lotusState = .breathing

        let controller = RecordingController(engineClient: engineClient)
        recordingController = controller

        // Observe event count
        controller.$eventCount
            .receive(on: RunLoop.main)
            .assign(to: &$recordingEventCount)

        do {
            chromeBridge = try await controller.start(url: url)
            recordingState = .recording
        } catch {
            recordingState = .idle
            lotusState = .idle
            print("Recording failed to start: \(error.localizedDescription)")
        }
    }

    func stopRecording() async {
        guard recordingState == .recording, let controller = recordingController else { return }

        recordingState = .stopping
        lotusState = .bloom

        do {
            let session = try await controller.stop()

            // Create/update workflow from session
            let workflow = createWorkflowFromSession(session)
            workflows.insert(workflow, at: 0)
            lastCapturedWorkflow = workflow
            saveWorkflows()

            // Notify
            AppNotifications.workflowCaptured(
                name: workflow.name,
                stepCount: workflow.definition?.steps.count ?? session.domEvents.count
            )

            // Trigger analysis in background
            Task {
                await analyzeWorkflow(workflow)
            }

            // Transition lotus to success
            lotusState = .success
            try? await Task.sleep(nanoseconds: UInt64(Constants.lotusSuccessDurationS * 1_000_000_000))
            lotusState = .idle
        } catch {
            lotusState = .idle
            print("Failed to stop recording: \(error.localizedDescription)")
        }

        recordingState = .idle
        await controller.cleanup()
        recordingController = nil
    }

    // MARK: - Playback Actions

    func playWorkflow(_ workflow: Workflow, parameters: [String: String] = [:]) async {
        guard playbackStatus == .idle else { return }
        guard workflow.definition != nil else { return }

        playbackStatus = .starting
        showPiPPanel = true

        do {
            // Launch Chrome and connect
            try ChromeLauncher.launch(url: workflow.definition?.baseUrl ?? workflow.sitePattern)
            try await ChromeLauncher.waitForDebugPort()

            let bridge = ChromeBridge()
            try await bridge.connectToTarget()
            chromeBridge = bridge

            // Inject content script
            if let scriptURL = Bundle.main.url(forResource: "content-script", withExtension: "js"),
               let script = try? String(contentsOf: scriptURL) {
                try await bridge.injectScript(script)
            }

            let controller = PlaybackController(bridge: bridge, engineClient: engineClient)
            playbackController = controller

            // Observe playback state
            controller.$state
                .receive(on: RunLoop.main)
                .sink { [weak self] state in
                    self?.playbackStatus = state.status
                    self?.playbackCurrentStep = state.currentStep
                    self?.playbackTotalSteps = state.totalSteps
                }
                .store(in: &cancellables)

            await controller.play(workflow: workflow, parameters: parameters)

            // Notify on completion
            let success = playbackStatus == .completed
            AppNotifications.playbackComplete(name: workflow.name, success: success)
        } catch {
            playbackStatus = .error
            print("Playback failed: \(error.localizedDescription)")
        }
    }

    func stopPlayback() {
        playbackController?.stop()
        playbackController = nil
        playbackStatus = .idle
        showPiPPanel = false

        Task {
            if let bridge = chromeBridge {
                await bridge.disconnect()
            }
            chromeBridge = nil
        }
    }

    func retryPlayback() async {
        guard let workflow = selectedWorkflow else { return }
        stopPlayback()
        try? await Task.sleep(nanoseconds: 500_000_000)
        await playWorkflow(workflow)
    }

    // MARK: - Workflow Management

    func deleteWorkflow(_ workflow: Workflow) {
        workflows.removeAll { $0.id == workflow.id }
        if selectedWorkflow?.id == workflow.id {
            selectedWorkflow = nil
        }
        saveWorkflows()
    }

    func renameWorkflow(_ workflow: Workflow, to name: String) {
        guard let index = workflows.firstIndex(where: { $0.id == workflow.id }) else { return }
        workflows[index].name = name
        if selectedWorkflow?.id == workflow.id {
            selectedWorkflow = workflows[index]
        }
        saveWorkflows()
    }

    // MARK: - Private Helpers

    private func createWorkflowFromSession(_ session: Session) -> Workflow {
        let urlHost = URL(string: session.url)?.host ?? session.url
        return Workflow(
            id: UUID().uuidString,
            name: session.workflowName,
            sitePattern: urlHost,
            sessions: [session.id],
            definition: nil,
            createdAt: ISO8601DateFormatter().string(from: Date()),
            updatedAt: ISO8601DateFormatter().string(from: Date())
        )
    }

    private func analyzeWorkflow(_ workflow: Workflow) async {
        guard await engineClient.isAvailable() else { return }

        do {
            let response = try await engineClient.analyze(
                workflowId: workflow.id,
                sessionIds: workflow.sessions
            )

            if let index = workflows.firstIndex(where: { $0.id == workflow.id }) {
                workflows[index].definition = response.definition
                workflows[index].updatedAt = ISO8601DateFormatter().string(from: Date())
                saveWorkflows()

                if lastCapturedWorkflow?.id == workflow.id {
                    lastCapturedWorkflow = workflows[index]
                }
                if selectedWorkflow?.id == workflow.id {
                    selectedWorkflow = workflows[index]
                }
            }
        } catch {
            print("Analysis failed: \(error.localizedDescription)")
        }
    }

    // MARK: - Persistence

    private var workflowsFileURL: URL {
        let appSupport = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        let dir = appSupport.appendingPathComponent("MCPMaker")
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("workflows.json")
    }

    private func saveWorkflows() {
        do {
            let data = try JSONEncoder().encode(workflows)
            try data.write(to: workflowsFileURL, options: .atomic)
        } catch {
            print("Failed to save workflows: \(error.localizedDescription)")
        }
    }

    private func loadWorkflows() {
        guard FileManager.default.fileExists(atPath: workflowsFileURL.path) else { return }
        do {
            let data = try Data(contentsOf: workflowsFileURL)
            workflows = try JSONDecoder().decode([Workflow].self, from: data)
        } catch {
            print("Failed to load workflows: \(error.localizedDescription)")
        }
    }
}

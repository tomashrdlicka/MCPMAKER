import Foundation
import UserNotifications

enum AppNotifications {
    static func requestPermission() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { granted, error in
            if let error {
                print("Notification permission error: \(error.localizedDescription)")
            }
        }
    }

    static func workflowCaptured(name: String, stepCount: Int) {
        let content = UNMutableNotificationContent()
        content.title = "Workflow captured"
        content.body = "\(name) - \(stepCount) steps"
        content.sound = .default
        content.categoryIdentifier = "WORKFLOW_CAPTURED"

        let request = UNNotificationRequest(
            identifier: "workflow-captured-\(UUID().uuidString)",
            content: content,
            trigger: nil
        )

        UNUserNotificationCenter.current().add(request)
    }

    static func playbackComplete(name: String, success: Bool) {
        let content = UNMutableNotificationContent()
        content.title = success ? "Playback complete" : "Playback failed"
        content.body = name
        content.sound = .default

        let request = UNNotificationRequest(
            identifier: "playback-\(UUID().uuidString)",
            content: content,
            trigger: nil
        )

        UNUserNotificationCenter.current().add(request)
    }

    static func registerCategories() {
        let playAction = UNNotificationAction(
            identifier: "PLAY_ACTION",
            title: "Play",
            options: .foreground
        )

        let capturedCategory = UNNotificationCategory(
            identifier: "WORKFLOW_CAPTURED",
            actions: [playAction],
            intentIdentifiers: []
        )

        UNUserNotificationCenter.current().setNotificationCategories([capturedCategory])
    }
}

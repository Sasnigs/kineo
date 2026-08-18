import KineoCore

#if canImport(UserNotifications)
import Foundation
import UserNotifications

public actor SystemReminderScheduler: ReminderScheduling {
    private static let requestIdentifier = "kineo.daily-check-in"
    private static let notificationTitle = "Kineo"
    private static let notificationBody = "Your Kineo check-in is ready."
    private static let minutesPerHour = 60

    private let center: UNUserNotificationCenter

    public init(center: UNUserNotificationCenter = .current()) {
        self.center = center
    }

    public func authorizationStatus() async -> ReminderAuthorization {
        let settings = await center.notificationSettings()
        return Self.authorization(from: settings.authorizationStatus)
    }

    public func requestAuthorization() async throws(ReminderServiceError) -> ReminderAuthorization {
        do {
            _ = try await center.requestAuthorization(options: [.alert, .sound])
            return await authorizationStatus()
        } catch {
            throw .unavailable
        }
    }

    public func replaceDailyReminder(
        window: ReminderWindow,
        timeZoneID: NonEmptyString
    ) async throws(ReminderServiceError) {
        let status = await authorizationStatus()
        guard status == .authorized || status == .provisional else {
            throw .unavailable
        }
        guard let timeZone = TimeZone(identifier: timeZoneID.rawValue) else {
            throw .schedulingFailed
        }
        center.removePendingNotificationRequests(withIdentifiers: [Self.requestIdentifier])
        var components = DateComponents()
        components.calendar = Calendar(identifier: .gregorian)
        components.timeZone = timeZone
        components.hour = window.startMinutes / Self.minutesPerHour
        components.minute = window.startMinutes % Self.minutesPerHour
        let content = UNMutableNotificationContent()
        content.title = Self.notificationTitle
        content.body = Self.notificationBody
        content.sound = .default
        content.userInfo = ["route": "today"]
        let request = UNNotificationRequest(
            identifier: Self.requestIdentifier,
            content: content,
            trigger: UNCalendarNotificationTrigger(dateMatching: components, repeats: true)
        )
        do {
            try await center.add(request)
        } catch {
            throw .schedulingFailed
        }
    }

    public func cancelAll() async throws(ReminderServiceError) {
        center.removePendingNotificationRequests(withIdentifiers: [Self.requestIdentifier])
    }

    private static func authorization(
        from status: UNAuthorizationStatus
    ) -> ReminderAuthorization {
        switch status {
        case .notDetermined:
            .notDetermined
        case .denied:
            .denied
        case .authorized, .ephemeral:
            .authorized
        case .provisional:
            .provisional
        @unknown default:
            .denied
        }
    }
}
#else
public actor SystemReminderScheduler: ReminderScheduling {
    public init() {}
    public func authorizationStatus() async -> ReminderAuthorization { .denied }
    public func requestAuthorization() async throws(ReminderServiceError) -> ReminderAuthorization {
        throw .unavailable
    }
    public func replaceDailyReminder(
        window: ReminderWindow,
        timeZoneID: NonEmptyString
    ) async throws(ReminderServiceError) {
        throw .unavailable
    }
    public func cancelAll() async throws(ReminderServiceError) {}
}
#endif

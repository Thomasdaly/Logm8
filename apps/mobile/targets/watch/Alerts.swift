import Foundation
import UserNotifications
import WatchKit

/// Haptic alerts before a limit (SPEC §5: 60/30/15/5 min, then "limit reached").
///
/// Scheduled on the watch itself from the phone's last `limitAtMs`, so they still fire if the phone is in a
/// pocket, locked or out of Bluetooth range. Every new context replaces the whole schedule; resting clears it.
enum Alerts {
  private static let prefix = "logm8.limit."

  static func requestPermission() {
    UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { _, _ in }
  }

  static func reschedule(for ctx: WatchContext, now: Date = Date()) {
    let center = UNUserNotificationCenter.current()
    center.getPendingNotificationRequests { pending in
      let ours = pending.map(\.identifier).filter { $0.hasPrefix(prefix) }
      center.removePendingNotificationRequests(withIdentifiers: ours)
      guard ctx.state == "work", let limitAt = ctx.limitAt else { return }
      for minutes in ctx.alertMinutes {
        let fireAt = limitAt.addingTimeInterval(TimeInterval(-minutes * 60))
        let delay = fireAt.timeIntervalSince(now)
        guard delay > 1 else { continue }
        let content = UNMutableNotificationContent()
        content.title = minutes == 0 ? "Limit reached" : "\(minutes) min to rest"
        content.body = minutes == 0 ? "You must rest now. \(ctx.limitLabel)" : ctx.limitLabel
        content.sound = minutes <= 5 ? .defaultCritical : .default
        content.interruptionLevel = .timeSensitive
        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: delay, repeats: false)
        center.add(UNNotificationRequest(identifier: "\(prefix)\(minutes)", content: content, trigger: trigger))
      }
    }
  }

}

/// Shows alerts (with their haptic) even while the watch app is on screen.
final class AlertPresenter: NSObject, UNUserNotificationCenterDelegate {
  static let shared = AlertPresenter()

  func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
    WKInterfaceDevice.current().play(.notification)
    return [.banner, .sound]
  }
}

import SwiftUI
import UserNotifications

@main
struct LogM8WatchApp: App {
  init() {
    UNUserNotificationCenter.current().delegate = AlertPresenter.shared
    Alerts.requestPermission()
    PhoneLink.shared.activate()
  }

  var body: some Scene {
    WindowGroup {
      ContentView().environmentObject(PhoneLink.shared)
    }
  }
}

import Foundation
import WatchConnectivity

/// Watch side of the link. The watch keeps no log: it only shows what the phone sent and forwards presses.
@MainActor
final class PhoneLink: NSObject, ObservableObject {
  static let shared = PhoneLink()

  @Published private(set) var context: WatchContext?
  @Published private(set) var reachable = false
  @Published private(set) var busy = false
  @Published var lastMessage: String?

  private static let storeKey = "logm8.lastContext"

  override init() {
    super.init()
    if let data = UserDefaults.standard.data(forKey: Self.storeKey),
       let ctx = try? JSONDecoder().decode(WatchContext.self, from: data) {
      context = ctx
    }
  }

  func activate() {
    guard WCSession.isSupported() else { return }
    WCSession.default.delegate = self
    WCSession.default.activate()
  }

  func startWork() { send(action: "start_work") }

  func startRest(_ place: String) { send(action: "start_rest", restLocation: place) }

  private func send(action: String, restLocation: String? = nil) {
    let s = WCSession.default
    guard s.activationState == .activated, s.isReachable else {
      lastMessage = "Phone not reachable. Use the phone."
      return
    }
    busy = true
    lastMessage = nil
    let id = UUID().uuidString
    let json = WatchProtocol.command(id: id, action: action, restLocation: restLocation)
    s.sendMessage(["json": json], replyHandler: { reply in
      let text = reply["json"] as? String
      Task { @MainActor in self.handleReply(text) }
    }, errorHandler: { _ in
      Task { @MainActor in
        self.busy = false
        self.lastMessage = "Not sent. Check the phone."
      }
    })
  }

  private func handleReply(_ json: String?) {
    busy = false
    guard let data = json?.data(using: .utf8), let reply = try? JSONDecoder().decode(WatchReply.self, from: data) else {
      lastMessage = "Unexpected answer. Check the phone."
      return
    }
    if reply.ok, let ctx = reply.context {
      apply(ctx)
      lastMessage = ctx.state == "work" ? "Work started" : "Rest started"
    } else {
      lastMessage = reply.message ?? "Not recorded."
    }
  }

  fileprivate func apply(_ ctx: WatchContext) {
    guard ctx.v == WatchProtocol.version else {
      lastMessage = "Update LogM8 on phone and watch."
      return
    }
    if let current = context, current.sentAtMs > ctx.sentAtMs { return }
    context = ctx
    if let data = try? JSONEncoder().encode(ctx) { UserDefaults.standard.set(data, forKey: Self.storeKey) }
    Alerts.reschedule(for: ctx)
  }

  fileprivate func setReachable(_ r: Bool) { reachable = r }
}

extension PhoneLink: WCSessionDelegate {
  nonisolated func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
    let json = session.receivedApplicationContext["json"] as? String
    let reachable = session.isReachable
    Task { @MainActor in
      self.setReachable(reachable)
      if let ctx = Self.decode(json) { self.apply(ctx) }
    }
  }

  nonisolated func sessionReachabilityDidChange(_ session: WCSession) {
    let reachable = session.isReachable
    Task { @MainActor in self.setReachable(reachable) }
  }

  nonisolated func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
    let json = applicationContext["json"] as? String
    Task { @MainActor in
      if let ctx = Self.decode(json) { self.apply(ctx) }
    }
  }

  nonisolated private static func decode(_ json: String?) -> WatchContext? {
    guard let data = json?.data(using: .utf8) else { return nil }
    return try? JSONDecoder().decode(WatchContext.self, from: data)
  }
}

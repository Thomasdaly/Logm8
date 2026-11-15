import ExpoModulesCore
import WatchConnectivity

/// Phone side of the Apple Watch link.
///
/// The watch sends button presses with `sendMessage` (live only, with a reply). Each one is forwarded to JS as an
/// `onCommand` event; JS validates it, records it through the same controller path as the phone buttons, and
/// answers with `reply(requestId, json)`. Nothing is recorded here. If JS does not answer in time the watch is
/// told to use the phone, so a press is never silently lost or applied late.
///
/// State for the watch goes through `updateApplicationContext` (latest wins, delivered when the watch wakes).
public class LogM8WatchModule: Module {
  private let session = WatchSessionBridge.shared

  public func definition() -> ModuleDefinition {
    Name("LogM8Watch")

    Events("onCommand")

    OnCreate {
      self.session.onCommand = { [weak self] requestId, json in
        self?.sendEvent("onCommand", ["requestId": requestId, "json": json])
      }
      self.session.activate()
    }

    OnDestroy {
      self.session.onCommand = nil
    }

    Function("isSupported") { () -> Bool in
      WCSession.isSupported()
    }

    Function("updateContext") { (json: String) in
      self.session.updateContext(json: json)
    }

    Function("reply") { (requestId: String, json: String) in
      self.session.reply(requestId: requestId, json: json)
    }
  }
}

final class WatchSessionBridge: NSObject, WCSessionDelegate {
  static let shared = WatchSessionBridge()

  /// How long the watch waits for the phone app to answer a press.
  private static let replyTimeout: TimeInterval = 8

  var onCommand: ((String, String) -> Void)?

  private let queue = DispatchQueue(label: "au.logm8.watch.bridge")
  private var pending: [String: ([String: Any]) -> Void] = [:]
  private var latestContext: String?

  func activate() {
    guard WCSession.isSupported() else { return }
    let s = WCSession.default
    if s.delegate == nil { s.delegate = self }
    if s.activationState != .activated { s.activate() }
  }

  func updateContext(json: String) {
    queue.async {
      self.latestContext = json
      self.pushContextIfPossible()
    }
  }

  private func pushContextIfPossible() {
    guard WCSession.isSupported(), let json = latestContext else { return }
    let s = WCSession.default
    guard s.activationState == .activated, s.isPaired, s.isWatchAppInstalled else { return }
    try? s.updateApplicationContext(["json": json])
  }

  func reply(requestId: String, json: String) {
    queue.async {
      guard let handler = self.pending.removeValue(forKey: requestId) else { return }
      handler(["json": json])
    }
  }

  // MARK: WCSessionDelegate

  func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
    queue.async { self.pushContextIfPossible() }
  }

  func sessionDidBecomeInactive(_ session: WCSession) {}

  func sessionDidDeactivate(_ session: WCSession) {
    // Switching to another paired watch: reactivate for the new one.
    session.activate()
  }

  func sessionWatchStateDidChange(_ session: WCSession) {
    queue.async { self.pushContextIfPossible() }
  }

  func session(_ session: WCSession, didReceiveMessage message: [String: Any], replyHandler: @escaping ([String: Any]) -> Void) {
    guard let json = message["json"] as? String else {
      replyHandler(["json": Self.errorJson(id: "", message: "Invalid message.")])
      return
    }
    let requestId = UUID().uuidString
    queue.async {
      guard let forward = self.onCommand else {
        replyHandler(["json": Self.errorJson(id: Self.commandId(json), message: "Open LogM8 on your phone.")])
        return
      }
      self.pending[requestId] = replyHandler
      DispatchQueue.main.async { forward(requestId, json) }
      self.queue.asyncAfter(deadline: .now() + Self.replyTimeout) {
        guard let handler = self.pending.removeValue(forKey: requestId) else { return }
        handler(["json": Self.errorJson(id: Self.commandId(json), message: "No answer from phone. Check the phone before pressing again.")])
      }
    }
  }

  private static func commandId(_ json: String) -> String {
    guard let data = json.data(using: .utf8),
          let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let id = obj["id"] as? String else { return "" }
    return id
  }

  private static func errorJson(id: String, message: String) -> String {
    let obj: [String: Any] = ["id": id, "ok": false, "reason": "error", "message": message]
    guard let data = try? JSONSerialization.data(withJSONObject: obj), let s = String(data: data, encoding: .utf8) else {
      return "{\"id\":\"\",\"ok\":false,\"reason\":\"error\",\"message\":\"Error\"}"
    }
    return s
  }
}

import Foundation

/// Mirrors `WatchContext` in apps/mobile/src/lib/watch.ts. Protocol version 1.
struct WatchContext: Codable, Equatable {
  struct RestPlace: Codable, Equatable, Hashable {
    let value: String
    let label: String
  }

  let v: Int
  let sentAtMs: Double
  let setupDone: Bool
  let state: String?
  let restLocation: String?
  let stateSinceMs: Double?
  let limitAtMs: Double?
  let limitLabel: String
  let alertMinutes: [Int]
  let interactionAllowed: Bool
  let restPlaces: [RestPlace]
  let disclaimer: String

  var limitAt: Date? { limitAtMs.map { Date(timeIntervalSince1970: $0 / 1000) } }
  var stateSince: Date? { stateSinceMs.map { Date(timeIntervalSince1970: $0 / 1000) } }
  var sentAt: Date { Date(timeIntervalSince1970: sentAtMs / 1000) }
}

/// Mirrors `WatchReply`.
struct WatchReply: Decodable {
  let id: String
  let ok: Bool
  let reason: String?
  let message: String?
  let context: WatchContext?
}

enum WatchProtocol {
  static let version = 1

  static func command(id: String, action: String, restLocation: String? = nil) -> String {
    var obj: [String: Any] = ["v": version, "id": id, "action": action]
    if let r = restLocation { obj["restLocation"] = r }
    let data = (try? JSONSerialization.data(withJSONObject: obj)) ?? Data()
    return String(data: data, encoding: .utf8) ?? "{}"
  }
}

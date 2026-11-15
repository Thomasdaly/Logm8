import SwiftUI

/// One screen: current state, countdown to the next required rest, and big Start Work / Start Rest buttons.
/// Buttons are disabled while the phone reports the vehicle moving; the phone checks again on every press.
struct ContentView: View {
  @EnvironmentObject var link: PhoneLink
  @State private var choosingRest = false

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(spacing: 8) {
          if let ctx = link.context, ctx.setupDone {
            StatusView(ctx: ctx)
            if ctx.interactionAllowed {
              Button("Start Work") { link.startWork() }
                .buttonStyle(.borderedProminent)
                .tint(.orange)
                .disabled(link.busy || ctx.state == "work")
                .accessibilityIdentifier("watch-start-work")
              Button("Start Rest") { choosingRest = true }
                .buttonStyle(.borderedProminent)
                .tint(.green)
                .disabled(link.busy)
                .accessibilityIdentifier("watch-start-rest")
            } else {
              Text("Locked while moving")
                .font(.headline)
                .multilineTextAlignment(.center)
            }
          } else {
            Text("Open LogM8 on your iPhone to finish setup.")
              .multilineTextAlignment(.center)
          }
          if link.busy { ProgressView() }
          if let msg = link.lastMessage {
            Text(msg).font(.footnote).multilineTextAlignment(.center)
          }
          if !link.reachable {
            Text("Phone not connected").font(.footnote).foregroundStyle(.secondary)
          }
          if let d = link.context?.disclaimer {
            Text(d).font(.system(size: 11)).foregroundStyle(.secondary).multilineTextAlignment(.center)
          }
        }
        .padding(.horizontal, 4)
      }
      .navigationTitle("LogM8")
      .sheet(isPresented: $choosingRest) {
        RestPicker(places: link.context?.restPlaces ?? []) { place in
          choosingRest = false
          link.startRest(place)
        }
      }
    }
  }
}

struct StatusView: View {
  let ctx: WatchContext

  var body: some View {
    VStack(spacing: 2) {
      Text(ctx.state == "work" ? "WORKING" : ctx.state == "rest" ? "RESTING" : "NOT STARTED")
        .font(.caption.bold())
        .foregroundStyle(ctx.state == "work" ? .orange : .green)
      if ctx.state == "work", let limitAt = ctx.limitAt {
        if limitAt > Date() {
          Text(timerInterval: Date()...limitAt, countsDown: true)
            .font(.system(size: 34, weight: .bold, design: .rounded))
            .monospacedDigit()
        } else {
          Text("Rest now").font(.title3.bold()).foregroundStyle(.red)
        }
        Text(ctx.limitLabel).font(.footnote).multilineTextAlignment(.center).lineLimit(3)
      } else if let since = ctx.stateSince {
        Text(since, style: .relative).font(.title3).monospacedDigit()
      }
      if Date().timeIntervalSince(ctx.sentAt) > 15 * 60 {
        Text("Last phone update \(ctx.sentAt, style: .time)")
          .font(.system(size: 11)).foregroundStyle(.yellow)
      }
    }
  }
}

struct RestPicker: View {
  let places: [WatchContext.RestPlace]
  let pick: (String) -> Void

  var body: some View {
    List(places, id: \.value) { p in
      Button(p.label) { pick(p.value) }
    }
    .navigationTitle("Rest where?")
  }
}

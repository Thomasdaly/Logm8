# Manual on-device tests (stage 2)

Automated tests use mocked location, speech and clock. These checks need a **real device** and a **development
or release build** (not Expo Go: background location and the foreground service need the native config in
`app.json`). Do them on at least: one real iPhone, one real Android phone, **one iPad (cellular model)** and, if
drivers use them, one Android tablet. Record the device, OS version and result for each line.

Build: `cd apps/mobile && npx expo prebuild && npx expo run:ios --device` / `npx expo run:android --device`
(or an EAS development build).

## 1. Location permissions and honest copy
- [ ] Fresh install: nothing asks for location until you tap **Allow location** in onboarding (after reading the explanation).
- [ ] iOS: first prompt is "While Using"; the **Always** upgrade prompt appears afterwards with the text from `app.json`. Choose "Allow While Using" and confirm Settings shows "Allowed while the app is open only…" and the app still works (foreground tracking, manual logging).
- [ ] iOS: choose "Always": Settings shows "Allowed, including in the background". A blue location indicator shows while the app is in the background.
- [ ] Android 10+: "Allow all the time" is only reachable through the system settings screen. Confirm the app handles returning with the permission granted or not.
- [ ] Deny everything: onboarding can still be completed; Start Work / Start Rest work; the status says location is off.

## 2. Background location (screen locked / app in the background)
- [ ] **iOS**: start work, lock the phone, drive (or use Xcode "City Drive" / a real drive) for 10 minutes. Unlock: the speed-based "Movement detected" suggestion was raised and **nothing was recorded** until you confirmed it.
- [ ] **Android**: same test. A persistent notification ("LogM8 is watching your work and rest limits") shows while tracking. Swipe the app away from recents: tracking continues (foreground service). Force-stop: tracking stops (expected).
- [ ] Battery saver / Doze (Android) and Low Power Mode (iOS): note whether location updates and warnings still arrive on time.
- [ ] After a 15+ minute stop while working, a "Stopped for 15 minutes… Start rest?" suggestion appears, back-dated to when you stopped, and only commits on **Confirm**. Dismiss does not repeat it.

## 3. Audio warnings with the screen locked
Do not change the phone clock to test this. Either log "Start Work" and wait for a real limit, or use a debug build with `WARNING_THRESHOLDS` and a short scheme limit.
- [ ] Warnings are spoken at 60 / 30 / 15 / 5 minutes before the limit and "Limit reached" at 0, with the **screen locked**.
- [ ] iOS: spoken while the app is in the background and the phone is locked (background mode `audio`).
- [ ] Android: spoken with the screen off (foreground service running).
- [ ] Spoken over music or navigation audio and through the car's Bluetooth / CarPlay-style audio route; volume is audible at highway speed.
- [ ] Silent / ring-switch on iOS: note whether speech is muted.
- [ ] Each threshold is spoken once only (no repeats on every GPS update).

## 4. Driving safety lock
- [ ] Above 10 km/h the app shows only the "Driving" screen: countdown and banner, **no buttons**, from any screen (home, settings, history, onboarding).
- [ ] Below 10 km/h (or stopped) the normal screens return within a few seconds.
- [ ] Tunnel / GPS loss: after 2 minutes without a GPS fix the lock lifts (speed treated as unknown). Decide whether this is acceptable (see DECISIONS.md).
- [ ] Two-up passenger scenario: confirm the lock is acceptable for the non-driving partner, or note it as a product decision.

## 5. iPad and tablets
- [ ] Installs as a **native iPad app** (not iPhone-compatibility mode, not letterboxed).
- [ ] Portrait, landscape-left and landscape-right all work; rotate with the app running and with a countdown active. Nothing is cut off and the countdown keeps running.
- [ ] Landscape (about 1000 pt wide or more): two columns. Left = status, countdown, Start Work / Start Rest. Right = today's 24-hour timeline in one row, breaches, History/Settings.
- [ ] Portrait: single centred column, readable from a dash mount (countdown is large).
- [ ] Split View / Slide Over (iPad multitasking): the layout switches between one and two columns as the width changes.
- [ ] **Wi-Fi-only iPad (no GPS)**: location status shows "Off" or no speed; there are no motion suggestions and no driving lock (speed unknown), but manual logging, the countdown and **spoken warnings still work**. Note this limitation to drivers: Wi-Fi-only iPads cannot detect movement; **cellular iPads** have GPS.
- [ ] Cellular iPad on a dash mount: GPS speed works, the lock engages above 10 km/h, background location works with the screen locked.
- [ ] iPad in a hot cab: no layout issues in dark mode in bright light (contrast check).
- [ ] Text size: set the largest Dynamic Type / Android font scale and check that buttons and the countdown stay usable.

## 6. Offline and storage
- [ ] Airplane mode: everything works (log, countdown, warnings, history, export).
- [ ] Kill the app mid-shift and relaunch: state (Working/Resting since …), countdown and today's timeline are restored from SQLite.
- [ ] Settings → **Check log integrity** reports "Log intact". (A tamper test needs a rooted/jailbroken device or a copy of the database file and is covered by unit tests.)
- [ ] Settings → **Export log (JSON)** opens the share sheet and the JSON contains events, `integrity` and `rulesetVersion`.
- [ ] History → Correct: adds a correction with a reason; the original stays listed and the timeline uses the corrected time.

## 7. Time zones
- [ ] Hermes `Intl` time-zone support: with base **QLD** (no daylight saving), travel or set the device to **NSW/VIC** during daylight saving (Oct–Apr). The home screen, timeline and "since HH:MM" must stay in **Brisbane** time while the phone clock shows Sydney time.
- [ ] Repeat with base **NSW** while the device is in QLD.
- [ ] On the daylight-saving change day (first Sunday of April/October) the timeline has 25 / 23 hours.

## 8. Performance
- [ ] With about 2 weeks of realistic history, tapping Start Work / Start Rest updates the buttons immediately. The short-period countdown appears within about 1–2 seconds, and the 7/14-day limits merge in afterwards without freezing the UI. Note the times on the oldest supported phone and iPad.

## 9. Disclaimer
- [ ] "Your Written Work Diary is your legal record. This app helps you check it." is visible in onboarding (before the form), in Settings and at the bottom of Home.

## 10. Photo check of a daily sheet (stage 3)
Synthetic accuracy does **not** prove real-world accuracy. These checks calibrate the templates and the reader:
- [ ] Photograph 20–30 real daily sheets (both pre-2026 and v1.4) whose schedules you have written down. Vary the
      phone, light, angle, surface (dark seat, dash, clipboard) and pen. Save them as `packages/diary-reader/fixtures/real/<name>.jpg`
      with `<name>.json` (`{ "version": "v1.4", "cells": [96 x "work" | "rest" | "none"] }`), then run
      `pnpm --filter @logm8/diary-reader accuracy`. Record the "Real photos" line. Do not commit other drivers' diaries.
- [ ] If accuracy is poor, compare a rectified real sheet with the template (grid, field and checkbox boxes) and
      adjust `src/templates/*.json`. The grid self-corrects; boxes do not.
- [ ] A sheet on a **white** table: the app should say it cannot find the sheet (known limitation).
- [ ] Glare across the grid, a creased page, a page photographed while still in the book (binding visible).
- [ ] Time to read a photo on the oldest supported phone/iPad (target: under about 10 s, with a "Reading the sheet…" indicator).
- [ ] Camera permission prompt text (iOS/Android) and the "Choose photo" fallback.
- [ ] With `EXPO_PUBLIC_FIELD_READER_URL` pointing at `apps/api` (`pnpm --filter @logm8/api start`), check the request is
      sent and the stub reply ("not read") is handled. Check no API key appears in the app bundle.

## Known limitations to tell testers
- No network time source in stage 2: each record stores the device time and, when available, the GPS fix time.
- Removing the *newest* records from the database leaves a valid shorter chain (detectable only once the head hash is anchored off-device in stage 4).
- WA / NT are not supported; the app offers no WA/NT base.

## Apple Watch (dev build on a paired iPhone + Apple Watch, or paired simulators)

1. `npx expo prebuild -p ios --clean` then build the `LogM8` scheme; the LogM8 watch app installs with it.
2. Watch shows "Open LogM8 on your iPhone to finish setup" before onboarding, then state + countdown after.
3. Press Start Work on the watch: phone home screen shows Working; history shows the entry with source `watch`.
4. Press Start Rest, pick each rest place; check the phone records it. Solo profile: no "Sleeper (moving)".
5. Drive (> 10 km/h): watch shows "Locked while moving"; no buttons.
6. Phone in flight mode / out of range: a press shows "Phone not reachable" and nothing is recorded on the phone.
7. Alerts: work until 60 min before a limit with the phone locked and in a pocket; the watch taps at 60/30/15/5/0 min.
   Start a rest: no further alerts.
8. Force-quit the phone app, press on the watch: "Open LogM8 on your phone" or "No answer from phone", nothing recorded.

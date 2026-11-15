# Truck Driver Fatigue Companion — Product & Engineering Spec

Working name: **LogM8** (placeholder). Owner: tdaly. Last updated: 2026-11-15.

## 1. Product summary

A cross-platform (Android + iOS) app for **owner-drivers** of fatigue-regulated heavy vehicles in Australia, sold as a **monthly subscription** (target $10–20/month, free trial).

Core jobs:
1. Driver picks their fatigue scheme (Standard Hours, transitional BFM, later ACA-Fatigue/ACH, AFM).
2. App tracks work and rest (GPS/motion prompts + manual confirm) and **warns before a breach**.
3. Driver photographs each **Written Work Diary (WWD) daily sheet**; the app reads it and checks (a) it is filled in correctly and (b) it matches what the app recorded.

**Legal positioning (v1):** the paper WWD remains the legal record. The app is a compliance assistant, NOT an Electronic Work Diary (EWD). All UI copy must say so. **Long-term goal: NHVR EWD approval**, so the architecture must meet the intent of the NHVR EWD Standards from day one (see §6).

Jurisdiction: HVNL states — QLD, NSW, VIC, SA, TAS, ACT. WA and NT are **out of scope for v1**; the engine must flag (not silently mis-check) any record whose base or journey is in WA/NT.

## 2. Repository layout (monorepo, pnpm workspaces, TypeScript strict)

```
/packages/rules-engine    pure TS, ZERO runtime dependencies, Vitest
/packages/diary-reader    WWD daily-sheet image reader + comparer
/packages/shared          shared types (WorkRestEvent, Scheme, Breach, etc.)
/apps/mobile              Expo (React Native) app, expo-router
/docs                     SPEC.md, RULES_SOURCES.md, DECISIONS.md
```

Scripts at root: `pnpm test`, `pnpm typecheck`, `pnpm lint` must run every package.

## 3. Build order (one /goal per stage — see GOALS.md)

1. **Rules engine**: Standard Hours (solo, two-up) + BFM (solo, two-up), tested against NHVR worked examples.
2. **Driver app**: logging, motion prompts, live countdowns, audio warnings, offline-first storage.
3. **Photo checker**: read old and v1.4 WWD daily sheets, compare to app log.
4. **Subscriptions + sync**: App Store / Google Play billing (RevenueCat suggested), cloud backup, PDF export. *(Needs owner's store accounts — human step.)*
5. **EWD application prep**: gap analysis against NHVR EWD Standards, evidence pack. *(Human/regulator step.)*

## 4. Rules engine requirements

### 4.1 Inputs
- `events: WorkRestEvent[]` — contiguous, non-overlapping intervals `{start, end (ISO UTC), kind: 'work' | 'rest', restLocation?: 'stationary_out_of_vehicle' | 'sleeper_berth_stationary' | 'sleeper_berth_moving' | 'in_vehicle_other'}`.
- `baseTimeZone` (IANA, e.g. `Australia/Brisbane`). **All counting and night/long-night windows use the base time zone**, including across daylight-saving borders.
- `recordingMode: 'written' | 'electronic'`.
- `scheme: SchemeDefinition` (data, not code — see 4.3).

### 4.2 Outputs
- `evaluate(events, ctx) → { breaches: Breach[], status: SchemeStatus }`
  - `Breach`: rule id, period, window start/end, actual vs limit, severity tier if known.
- `forecast(events, ctx, now) → Forecast` — assuming the driver keeps working from `now`: minutes until each limit is hit, the earliest binding limit, and the minimum rest that would clear it. This drives the countdown and the warnings in the app.
- Pure, deterministic functions with no I/O and no clock reads (`now` is passed in).

### 4.3 Scheme definitions as data
Each scheme is a JSON-serialisable object listing rules: `{period, maxWork?, minRest?: {total, minBlock, continuous, stationary, nightRest?, count?, consecutive?}, countFrom: 'any_rest' | 'relevant_major_rest', majorRest?}` plus special rules (long/night cap). AFM and ACA-Fatigue/ACH hours are operator-specific: v1 supports them through a **custom scheme loaded from data** (validated with a schema), with no new code needed.

### 4.4 Rule tables (researched 2026-11-15 — MUST be re-verified, see §4.7)

**Standard Hours — solo (truck)**

| Period | Max work | Min rest |
|---|---|---|
| 5½ h | 5¼ h | 15 continuous min |
| 8 h | 7½ h | 30 min in blocks ≥15 continuous min |
| 11 h | 10 h | 60 min in blocks ≥15 continuous min |
| 24 h | 12 h | 7 continuous h stationary rest |
| 7 days | 72 h | 24 continuous h stationary rest |
| 14 days | 144 h | 2 night rest breaks + 2 night rest breaks on consecutive days |

**Standard Hours — two-up**

| Period | Max work | Min rest |
|---|---|---|
| 5½ h | 5¼ h | 15 continuous min |
| 8 h | 7½ h | 30 min in ≥15 min blocks |
| 11 h | 10 h | 60 min in ≥15 min blocks |
| 24 h | 12 h | 5 continuous h stationary rest, OR 5 continuous h in approved sleeper berth while moving |
| 52 h | — | 10 continuous h stationary rest |
| 7 days | 60 h | 24 continuous h stationary rest + another 24 h stationary rest in blocks ≥7 continuous h |
| 14 days | 120 h | 2 night rest breaks + 2 night rest breaks on consecutive days |

**BFM — solo** (transitional: only for drivers with an existing BFM accreditation that hasn't expired)

| Period | Max work | Min rest |
|---|---|---|
| 6¼ h | 6 h | 15 continuous min |
| 9 h | 8½ h | 30 min in ≥15 min blocks |
| 12 h | 11 h | 60 min in ≥15 min blocks |
| 24 h | 14 h | 7 continuous h stationary rest (split-rest variant: see 4.7) |
| 7 days | 36 h **long/night work time** | — |
| 14 days | 144 h | 24 continuous h stationary rest after ≤84 h work, + another 24 continuous h stationary rest, + 2 night rest breaks, + 2 night rest breaks on consecutive days |

**BFM — two-up**

| Period | Max work | Min rest |
|---|---|---|
| 24 h | 14 h | — |
| 82 h | — | 10 continuous h stationary rest |
| 7 days | 70 h | 24 continuous h stationary rest + 24 h stationary rest in blocks ≥7 continuous h |
| 14 days | 140 h | 4 night rest breaks |

**Definitions**
- *Stationary rest*: time out of the vehicle, or in an approved sleeper berth of a stationary vehicle.
- *Night rest break*: 7 continuous h stationary rest between 22:00 and 08:00 (base time zone), OR 24 continuous h stationary rest.
- *Long/night work time* (BFM): work in excess of 12 h in a 24 h period, plus any work between 00:00 and 06:00 (base tz). Counted together, never double-counted. Counted in 15-minute blocks rounded up (53 min over 12 h → 1 h; 141 min between 00:00–03:00 → 2½ h).
- *Switching schemes*: a driver operates under one option at a time. Switching needs either full compliance with the new option's limits over the look-back, or a reset rest of ≥48 continuous hours. The engine must support a scheme-change event.

### 4.5 Counting-time rules
- Periods **< 24 h**: count forward from the end of **any** rest break, so every rest-end starts a candidate window.
- Periods **≥ 24 h**: count forward from the end of the **relevant major rest break** for that period and scheme (e.g. Standard solo: 7-day from end of a ≥24 h rest; 14-day from end of a night rest break. BFM solo 24 h: from end of a ≥7 h rest, or a ≥6 h rest when split rest is used. BFM two-up 24 h: from end of any rest). **If no relevant major rest was taken, count from the end of any rest break.**
- A later major rest **does not reset** an unfinished 24 h period. Work that resumes creates an **overlapping** period, and both must comply.
- **Written diary rounding** (15-min blocks aligned to the clock): work rounds **outward/up** (6 min → 15, 32 → 45, 2 h 21 → 2 h 30); rest rounds **inward/down** (12 min → 0, 44 → 30, 6 h 40 → 6 h 30).
- **Electronic** mode: per-minute. Work counts to the minute. A continuous rest ≥15 min counts to the minute, and a rest <15 min counts as 0 rest.

### 4.6 Required test cases (each must be a named test)
1. **8-hour limit (Standard solo):** start 06:00 after a qualifying major rest, work to 11:15, rest 11:15–11:30, work to 14:00 → **breach** of 8 h / 7½ h (7 h 45 min worked). The single 15-min break doesn't reset the period.
2. **Rounding (written):** work 06:07–10:02 records as 06:00–10:15. Rest 10:02–10:37 credits only 10:15–10:30.
3. **11-hour limit:** 9 h driving + 3 h loading/inspection in an 11 h period = 12 h work → **breach** (all work counts, not just driving).
4. **24-hour overlap (Standard solo):** start 06:00, work 5¼ h, rest 15 min, work 2¼ h, rest 90 min, work 4½ h, then 7 h rest from 19:45. The 12 h maximum is reached, so the earliest compliant restart is **06:00 next day**. Restarting at 02:45 when the rest ends creates an overlapping period and must **breach**.
5. **Long/night 1:** BFM solo, 13 h work between 06:00 and 23:00 → **1 h** long/night.
6. **Long/night 2:** BFM solo, 14 h work from 13:00 to 06:00 next day including 00:00–06:00 → **6 h** long/night (no double count).
7. **Long/night rounding:** 53 min over 12 h → 1 h. 141 min between 00:00–03:00 → 2½ h.
8. **36 h cap:** BFM solo reaching 36 h long/night in 7 days → further long/night work flagged until the total drops below 36.
9. **Night rest:** a 7 h stationary rest 23:00–06:00 counts as a night rest break. 21:00–04:00 does not (outside 22:00–08:00). A 24 h rest always counts.
10. **Sleeper berth:** two-up 5 h sleeper-berth-moving rest satisfies the 24 h rule. The same rest does NOT count as stationary for the 52 h rule.
11. **Time zone:** QLD-based driver working in NSW during daylight saving. All windows are computed in Brisbane time.
12. **Forecast:** given a partial day, `forecast` returns the correct minutes to the earliest binding limit for at least one case per scheme.
13. **Scheme switch:** switching Standard → BFM without a 48 h reset and without full BFM compliance → flagged.
14. **WA/NT guard:** base tz `Australia/Perth` or `Australia/Darwin` → explicit "unsupported jurisdiction" result, not a pass.
Also include property-based tests (fast-check): random valid schedules never crash, and adding work never reduces the breach count.

### 4.7 Verification required (open questions)
The tables above came from NHVR web pages read through a summariser. Before relying on them, Claude Code must check each value against the **official** sources and record the URL and date checked in `docs/RULES_SOURCES.md`:
- NHVR "Work and rest hours" and "Counting time" pages (nhvr.gov.au)
- Heavy Vehicle (Fatigue Management) National Regulation, current in-force version, Schedule 1 tables
- NHVR "HVNL changes to recording information in the Written Work Diary (commencing 1 August 2026)" information sheet

Known open items:
- **BFM split rest** (6 h + split) exact definition.
- NHVR says Standard Hours and ACH counting were **"simplified, with one consistent rule for all period lengths"** from 1 Aug 2026. Confirm exactly how this changes §4.5 for Standard Hours.
- Whether any Standard Hours limits changed on 1 Aug 2026.
Anything that can't be verified goes in an **UNVERIFIED** section of RULES_SOURCES.md, and the affected tests are tagged `@unverified`. If web access is unavailable, say so in RULES_SOURCES.md and do not invent values.

## 5. Driver app requirements (stage 2)
- Expo + TypeScript, expo-router. Local-first storage (SQLite via expo-sqlite). Works fully offline.
- Onboarding: scheme, two-up yes/no, base + base time zone, rego, WWD number, recording mode = written.
- Home: big live countdown to the next required rest (from `forecast`), today's timeline in 15-min blocks.
- Logging: one-tap Start Work / Start Rest (only while stationary). Motion detection (expo-location + speed) **suggests** state changes. Nothing is ever auto-committed without the driver confirming.
- **Driving safety:** while speed > 10 km/h, no interactive UI. Warnings are audio (expo-speech) + large glanceable banner only, at 60/30/15/5 min before a limit. Gate this with a tested `isInteractionAllowed(speed)` helper.
- Background location: iOS "always" permission flow with honest copy, Android foreground service. Degrade gracefully if denied.
- Disclaimer: "Your Written Work Diary is your legal record. This app helps you check it."

## 6. EWD-readiness constraints (all stages)
- **Append-only event store.** Records are never mutated or deleted. A correction is a new event that references the original, with a reason and timestamp.
- Each event stores device time, a trusted/network time where available, GPS position + accuracy, and app version.
- Hash-chain events (each record includes the hash of the previous one) so tampering is detectable.
- Rules engine versioned, with the rule-set version stored on each evaluation result.
- Export: records and evaluation history for a date range (JSON now, PDF in stage 4).

## 7. Photo checker requirements (stage 3)
- Support both the pre-Aug-2026 daily sheet and **WWD v1.4** (from 1 Aug 2026). Day of week, standard-hours tick and daily totals are **optional** on all sheets after 1 Aug 2026 and must not be flagged as missing.
- Pipeline: detect page → perspective-correct to a canonical template → locate the 24 h grid → classify each 15-min column as work/rest from the drawn line → read handwritten fields (date, locations, odometer, rego, two-up partner) via a pluggable `FieldReader` interface (vision-LLM implementation behind a server endpoint. Never put API keys in the app).
- Compare: per-15-min diff against the app's log, missing mandatory fields, rule breaches visible on the sheet itself (run the rules engine on the sheet's grid).
- Test fixtures: until real photos are supplied, **generate synthetic sheets** from known schedules (render the template + hand-drawn-style line, then apply rotation ±8°, perspective skew, blur, lighting gradient, JPEG noise). Real photos go in `packages/diary-reader/fixtures/real/` with ground-truth JSON.
- Template geometry for both sheet versions lives in data files. If the exact layout can't be obtained from the official NHVR PDFs, build a best-effort template, record it in DECISIONS.md, and flag it for calibration against real photos.

## 8. Out of scope for v1
WA/NT rules, operator dashboards, AFM certificate parsing, payments (stage 4), EWD submission.

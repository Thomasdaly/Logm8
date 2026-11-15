# /goal commands — run one stage at a time

Setup (once):
1. Put this folder (with `docs/SPEC.md`, `CLAUDE.md`, `GOALS.md`) in a new git repo and `cd` into it.
2. Start Claude Code (v2.1.139+), switch to **auto mode** so turns run unattended.
3. Paste ONE goal below. When it reports achieved, review and commit, then paste the next.

Each goal is under the 4,000-character limit. The evaluator only reads the conversation, so every goal asks Claude to print the proof (test output, command exit codes) in the transcript.

---

## Stage 1 — Rules engine

```text
/goal Build stage 1 (rules engine) exactly as specified in docs/SPEC.md §2, §4 and §6. Read docs/SPEC.md and CLAUDE.md first.

Done when ALL of the following are shown in this conversation:
1. A pnpm-workspace TypeScript (strict) monorepo exists with packages/shared and packages/rules-engine. packages/rules-engine has ZERO runtime dependencies (print its package.json "dependencies" field: empty or absent).
2. Schemes Standard Hours solo, Standard Hours two-up, BFM solo and BFM two-up are defined as data (not hard-coded logic). A custom scheme can be loaded from JSON and is validated.
3. evaluate() and forecast() are implemented as pure functions (no clock reads, no I/O), covering both written (15-min rounding) and electronic (per-minute) recording modes, base-time-zone counting, overlapping 24h periods, night rest breaks, long/night work time with the BFM 36h cap, scheme switching with the 48h reset, and the WA/NT unsupported-jurisdiction guard.
4. Every one of the 14 test cases in SPEC.md §4.6 exists as a separately named Vitest test, plus fast-check property tests. `pnpm test` exits 0 and the output is printed showing the test names passing.
5. Coverage for packages/rules-engine is >= 90% lines and branches (print the coverage summary).
6. `pnpm typecheck` and `pnpm lint` both exit 0 (print the output).
7. docs/RULES_SOURCES.md lists every numeric limit in SPEC.md §4.4 and every counting rule in §4.5 with an official source URL (nhvr.gov.au or the in-force Heavy Vehicle (Fatigue Management) National Regulation) and the date checked, and resolves or lists under UNVERIFIED each open item in §4.7. If an official value differs from SPEC.md, the code follows the official value and the difference is recorded in docs/DECISIONS.md. Values are never invented.
8. A final summary is printed listing anything UNVERIFIED and any spec deviations.

Constraints: do not modify the §4.6 expected outcomes to make tests pass unless an official source proves them wrong (record that in DECISIONS.md). No mobile app code in this stage. Stop and report after 80 turns if not done.
```

---

## Stage 2 — Driver app

```text
/goal Build stage 2 (driver app) as specified in docs/SPEC.md §5 and §6, using packages/rules-engine from stage 1 without changing its public API (if a change is truly needed, record it in docs/DECISIONS.md and keep all stage 1 tests passing). Read docs/SPEC.md, CLAUDE.md and docs/DECISIONS.md first.

Done when ALL of the following are shown in this conversation:
1. apps/mobile is an Expo + TypeScript app using expo-router, with onboarding (scheme, two-up, base + base time zone, rego, WWD number), a home screen with a live countdown driven by forecast(), today's 15-minute timeline, and work/rest logging.
2. Storage is local-first SQLite and implements the §6 append-only, hash-chained event store: corrections are new events with a reason, and nothing is updated or deleted. Unit tests prove a tampered record is detected.
3. Motion detection only SUGGESTS state changes, and nothing is committed without driver confirmation (tested).
4. isInteractionAllowed(speedKmh) blocks interactive UI above 10 km/h. Warnings fire at 60/30/15/5 minutes before the earliest limit via expo-speech plus a glanceable banner (tested with a mocked clock and location).
5. The legal-record disclaimer appears in onboarding and settings.
6. `pnpm test`, `pnpm typecheck` and `pnpm lint` all exit 0 across the whole repo (print output). Includes jest/react-native-testing-library tests for onboarding, logging and the warning flow.
7. `npx expo export --platform android` and `npx expo export --platform ios` both succeed in apps/mobile (print the tail of each output).
8. docs/MANUAL_TEST.md lists the on-device checks a human must do (background location on real iOS/Android, audio while screen locked).

Stop and report after 100 turns if not done.
```

---

## Stage 3 — Photo checker

```text
/goal Build stage 3 (photo checker) as specified in docs/SPEC.md §7, in packages/diary-reader, and wire it into apps/mobile (camera capture screen → results screen). Read docs/SPEC.md, CLAUDE.md and docs/DECISIONS.md first.

Done when ALL of the following are shown in this conversation:
1. Template geometry for the pre-Aug-2026 daily sheet and WWD v1.4 is stored as data. The source for each (official NHVR PDF, or best-effort with reasons) is recorded in docs/DECISIONS.md.
2. A synthetic fixture generator renders at least 200 sheets (both versions) from random valid and invalid schedules, with the §7 distortions applied, and writes ground-truth JSON.
3. The reader recovers the per-15-minute work/rest grid with >= 98% cell accuracy and >= 90% fully-correct sheets on the synthetic set (print the accuracy report).
4. The comparer reports per-15-min differences against an app log, missing mandatory fields (and does NOT flag fields made optional from 1 Aug 2026), and rule breaches visible on the sheet via packages/rules-engine. Each is covered by tests.
5. Handwritten field reading sits behind a FieldReader interface with a mock implementation used in tests. The vision-model implementation calls a server endpoint (stub server in /apps/api, no API keys in the mobile app).
6. If packages/diary-reader/fixtures/real/ contains photos with ground truth, the accuracy report includes them separately.
7. `pnpm test`, `pnpm typecheck`, `pnpm lint` exit 0 repo-wide, and both expo exports still succeed (print output).

Stop and report after 100 turns if not done.
```

---

## Stages 4–5 (not goal-able yet)

These need things only you can provide:
- **Stage 4 (subscriptions, sync, PDF export):** Apple Developer + Google Play Console accounts, a RevenueCat (or similar) account and a backend choice. Once these exist, ask Claude Code to write the stage 4 goal from SPEC.md §3.
- **Stage 5 (EWD application):** download the current NHVR EWD Standards and application form, then run a goal like: `/goal docs/EWD_GAP_ANALYSIS.md maps every requirement in <EWD Standards file> to the code/feature that meets it or marks it as a gap with an estimate`.

# Decisions and deviations

Format: date — decision — reason. Sources are as keyed in `docs/RULES_SOURCES.md`.

## Stage 1 (rules engine), 2026-11-15

### Official values vs SPEC
- **2026-11-15 — No numeric limit in SPEC §4.4 differs from the official tables.** Every value was checked
  against REG / REG-OLD and NHVR-WRH (see RULES_SOURCES.md). No §4.6 expected outcome was changed.
- **2026-11-15 — Standard Hours ≥ 24 h periods count from the end of the *longest* major rest required in that
  period (HVNL s247(a) as amended).** This is the official form of SPEC §4.5. It gives the same result for all
  Standard Hours rows. BFM keeps the pre-reform wording ("a relevant major rest break"), so for BFM every listed
  major rest is a counting start: BFM two-up 7 days = ≥ 24 h or ≥ 7 h stationary; BFM solo 14 days = ≥ 24 h or a
  night rest break (as in the NHVR-CT example).
- **2026-11-15 — Apparent misprint in REG Sch 1 Table 3 (two-up, 11 h):** column 4 reads "< 10¾ hours work time:
  minor" and "≤ 10¾ hours work time: substantial", which overlap. Implemented the same as Table 1 (solo):
  ≤ 10¾ h minor, > 10¾ h substantial. Reason: the reading consistent with every other row; only the severity
  label is affected, never whether there is a breach.

### Scheme data model (SPEC §4.3)
- **2026-11-15 — `minRest` is an array of requirements, not a single object.** Several rows have more than one
  rest requirement (e.g. BFM solo 14 days has four), and s22(3) says some of them cannot be met by the same rest.
  Added fields: `allowSleeperMoving`, `afterMaxWork`, `exclusiveGroup` (s22(3) non-concurrency),
  `splitRestDefence`, `tiers` (risk categories) and `id`/`description`. Also added at scheme level: `longNight`,
  `switchingOut` and `resetRestMinutes`. `majorRest` is a list of alternatives. The SPEC field names (`total`,
  `minBlock`, `continuous`, `stationary`, `nightRest`, `count`, `consecutive`, `countFrom`, `majorRest`) are kept.
- **2026-11-15 — Built-in schemes are JSON files** (`packages/rules-engine/src/schemes/*.json`), loaded through the
  same validator as custom schemes. A JSON Schema (`schemeJsonSchema`) is exported for tooling. The engine's own
  validator (zero dependencies) also enforces cross-field rules, e.g. a period under 24 h may not use
  `relevant_major_rest`, `minBlock` ≥ 15, and a night rest break is 7 h continuous stationary.
- **2026-11-15 — Standard Hours bus tables (REG Sch 1 Table 2) are not included.** SPEC stage 1 covers trucks. They
  can be added as data later.
- **2026-11-15 — The custom-scheme validator requires `switchingOut`.** AFM, ACH and exemption schemes should set
  `reset_only` (HVNL s263(1)(b)). The engine does not infer it from `family`, so the data stays explicit.

### Counting
- **2026-11-15 — Counting starts (U5).** A rest end is a counting start for a period ≥ 24 h when (a) the rest
  qualifies as the relevant major rest, or (b) no qualifying major rest ended within the preceding period length
  ("if you have not taken the required rest break, count from the end of any rest break", NHVR-CT). Reason:
  this is the most direct reading. For compliant drivers it never adds periods, because the next qualifying rest
  always ends within one period.
- **2026-11-15 — A record that starts with work is treated as if a rest ended at its first minute** (notice
  `record_start_assumed_after_rest`). Reason: earlier history is unknown, and checking from the first minute is
  the conservative choice.
- **2026-11-15 — Minimum-rest requirements are only checked for periods that are complete** (period end ≤ end of
  record). Maximum-work limits are checked for partial periods too. Reason: a driver cannot yet have failed to
  take a rest whose deadline has not passed. `forecast()` covers upcoming deadlines.
- **2026-11-15 — Rests are clipped to the period.** Only the part of a rest inside a period counts towards it. A
  night rest break counts in a period only if its 7 h night portion (or its 24 h) lies inside the period.
- **2026-11-15 — A rest with no `restLocation` is treated as rest that is NOT stationary** (notice
  `rest_location_unknown`). Reason: safety-critical. This can only produce more warnings, never hide one.
- **2026-11-15 — Written mode uses a clock-aligned 15-minute grid (U1, SPEC case 2).** A block containing any
  work is all work. A block is rest only if it is rest for the full 15 minutes. A block that mixes rest kinds
  counts as non-stationary rest. All Australian base offsets are multiples of 15 minutes, so the grid is aligned
  in UTC. Reason: this matches the WWD daily-sheet grid and SPEC, and for work it is never less than duration rounding.
- **2026-11-15 — Electronic mode floors instants to the whole minute** (periods under 1 minute are not counted,
  s19A(3)). Rest under 15 minutes is still rest time: it ends work and starts a < 24 h period, but it does not
  count towards any minimum rest (s19A(4)).
- **2026-11-15 — The EWD 8-minute minor-breach tolerance (REG s5(5)) is NOT applied.** Reason: it applies only to
  a driver using an approved electronic work diary. This app is not one (SPEC §1), so electronic mode is
  per-minute counting only.
- **2026-11-15 — Long/night work time (U3).** Within each 24 h period (counted under the scheme's 24 h rule), the
  work after the first 12 h of work is "long". Work between 00:00 and 06:00 base time is "night". The union is
  counted once. Each continuous run of long/night minutes is rounded up to 15 minutes, in both recording modes
  (the REG-OLD s3 examples are part of the definition, not diary-specific). Reason: literal reading, and never
  less than the alternative.
- **2026-11-15 — Night rest breaks (U4).** One continuous stationary rest yields one night rest break for each
  local night (22:00–08:00) in which it has ≥ 7 continuous hours. A ≥ 24 h rest with no such night still counts
  once. A night rest break's "day" is the local date of the evening it starts. "Consecutive days" means
  consecutive such dates.
- **2026-11-15 — BFM split rest (U2) is reported as a defence notice, not as compliance.** If a 24 h period lacks
  7 h continuous stationary rest but has 6 h + 2 h, and the previous 24 h did not rely on a split rest, the engine
  emits `bfm_split_rest_defence` instead of a breach. Reason: HVNL-OLD s255 makes it a defence the driver must
  prove, and it cannot be planned. The 6 h part of a split is also used as a counting start, as SPEC §4.5
  says; this is unverified.
- **2026-11-15 — Each breach is one rule/requirement in one counting period.** Overlapping breached periods are
  not merged. Reason: merging would hide overlapping periods (SPEC §4.5), and it would break the property that
  adding work never reduces the breach count. The app layer can group breaches for display.

### Scheme switching
- **2026-11-15 — Switching is modelled as `ctx.schemeChanges: {at, scheme}[]`.** At each change: if the change
  falls inside (or at the end of) a rest of ≥ `resetRestMinutes` of the scheme being left, it is a reset, and the
  new scheme counts from the end of that rest (HVNL s263(2)). Otherwise, if the old scheme's `switchingOut` is
  `reset_only` (ACH / AFM / exemption), it is a `scheme_switch` breach. Otherwise the new scheme's rules are
  evaluated over the history before the change (2 × its longest period), and any breach makes it a `scheme_switch`
  breach. After the change, the new scheme's periods include the work done before the change.

### Jurisdiction
- **2026-11-15 — Unsupported jurisdictions.** The result is `unsupported_jurisdiction` (never a pass) when the base
  time zone is WA/NT (Perth, Eucla, Darwin and aliases) or is not an Australian HVNL base zone, or when any event
  is tagged `jurisdiction: 'WA' | 'NT'`.
- **2026-11-15 — Added optional `jurisdiction` and `activity` fields to `WorkRestEvent`.** Both are additive.
  `jurisdiction` lets the engine detect WA/NT journeys (SPEC §1). `activity` (driving / other work) is
  descriptive only: all work counts (HVNL s221 "work"; SPEC case 3).

### Forecast
- **2026-11-15 — `forecast()` works by evaluating hypothetical futures with the same engine:** keep working
  for t minutes, then rest. `minutesUntilBreach` for each limit is the largest t with no new breach of that limit
  (binary search). The record is assumed to continue in its last state until `now`; events after `now` are
  ignored.
- **2026-11-15 — `minimumRestToClear` is the shortest rest, taken when the earliest limit is reached, after which
  work can resume without a new breach** (searched in 15-min steps up to 48 h, then refined to the minute in
  electronic mode). `earliestRestart` = now + minutesToEarliest + minimumRestToClear. SPEC case 4 gives a 06:00
  restart.
- **2026-11-15 — Requirements that need several distinct rests or night rest breaks** (exclusive groups,
  `count` > 1, night rest, after-max-work) cannot be judged from the single-rest "stop now" plan. Their open
  periods are left out of the comparison and are never reported as "already binding". Reason: avoid false
  "0 minutes" warnings; they are still fully checked by `evaluate()`.

### Repository / tooling
- **2026-11-15 — Installed pnpm 10 globally with `npm i -g pnpm@10`.** Node 26 no longer ships corepack.
- **2026-11-15 — TypeScript pinned to ~6.0.** typescript-eslint 8.72 supports TypeScript < 6.1. TypeScript 7 exists
  but is not yet supported by the linter.
- **2026-11-15 — `@logm8/shared` is types-only.** rules-engine imports it only with `import type`, and lists it
  under `peerDependencies` / `devDependencies`. So rules-engine has no `dependencies` field (zero runtime
  dependencies). A test enforces this, and ESLint bans clock reads, `Math.random` and I/O imports in
  `packages/rules-engine/src`.
- **2026-11-15 — Time zones use the ECMAScript built-in `Intl` API** (not a dependency). Stage 2 must confirm that
  the React Native (Hermes) build has full time-zone support.
- **2026-11-15 — The "adding work never reduces the breach count" property test interprets "adding work" as
  appending work time at the end of the record.** Converting an earlier rest into work can legitimately remove
  a counting start (a rest end), so breach counts are not monotonic under that operation.
- **2026-11-15 — SPEC case 3 ("12 h work in an 11 h period") cannot happen literally.** The test uses a 12 h shift
  (9 h driving + 3 h loading/inspection). The 11 h period from 06:00 contains 10 h 30 min of work (8 h 30 min of it
  driving), so counting all work gives the breach and counting driving alone would not. The expected outcome
  (breach) is unchanged.

## Stage 2 (driver app), 2026-11-15

### Rules-engine change found while building stage 2 (no public API change)
- **2026-11-15 — Fixed a stage 1 false positive: one long rest can serve two rest requirements.** A fresh-start
  `forecast()` for a two-up scheme reported a limit of "0 minutes" because a single continuous rest could not
  satisfy both "24 continuous h" and "24 h in blocks of ≥ 7 h". Fatigue Reg s22(3) says the two requirements
  cannot be fulfilled *concurrently*, i.e. the same minutes cannot count twice (Schedule 3 example: a 48 h rest is
  one 24 h rest plus a further 24 h). `requirements.ts` now allocates minutes of a rest to a requirement and leaves the
  rest available (previously the whole run was consumed). This affects Standard two-up 7 days, BFM two-up 7 days and
  BFM solo 14 days. Regression tests were added (48 h and 60 h rests satisfy both; 40 h does not). All stage 1 tests
  pass unchanged. Public API (`evaluate`, `forecast`, scheme JSON) is unchanged.

### Architecture
- **2026-11-15 — Controller pattern.** All behaviour (logging, motion suggestions, warnings, gating) lives in a
  plain TypeScript `DriverController` with injected ports (`EventStore`, clock, speech, location). React only
  subscribes via `useSyncExternalStore`. Reason: warning and suggestion flows can be tested with a mocked clock,
  location and speech, with no native modules.
- **2026-11-15 — Event store.** One append-only `events` table; types `profile`, `state_change`, `correction`.
  Profile and scheme changes are events too (nothing mutable). SQLite triggers reject UPDATE and DELETE
  (defence in depth; the store API also has neither). Hash = SHA-256 over canonical JSON of
  `[seq, prevHash, type, payload, deviceTime, networkTime, position, appVersion]`. `verify()` checks seq continuity,
  the previous-hash link and the recomputed hash. SHA-256 comes from `expo-crypto`; tests use `node:crypto`.
  Tests run against real SQLite via `node:sqlite`.
- **2026-11-15 — Known limitation: truncating the newest records leaves a valid shorter chain.** Detecting it needs
  the head hash anchored off-device (stage 4 sync). Documented in `eventStore.ts` and MANUAL_TEST.md.
- **2026-11-15 — "Trusted time".** There is no network time source while offline-first, so `networkTime` is null in
  stage 2. The GNSS fix timestamp stored in `position.fixTime` serves as the trusted time. The position stamped on an
  event is the last fix seen (its `fixTime` shows how old it is).
- **2026-11-15 — "Evaluation history" (SPEC §6) is produced on export, not stored per change.** The JSON export
  contains the raw log, the integrity result, and an evaluation including `rulesetVersion`. Appending an
  evaluation event after every change was rejected: it doubles the log and adds nothing the log cannot reproduce.
- **2026-11-15 — Corrections.** A correction event carries the full replacement (or `void`); the latest correction
  for an entry wins. Corrections require a reason and an existing `state_change` target (enforced by the store).

### Safety
- **2026-11-15 — `isInteractionAllowed(speed)`:** blocks strictly above 10 km/h. Unknown speed is allowed so the app
  degrades to manual use without GPS (denied permission, tunnel, or a Wi-Fi-only iPad). A speed reading older than
  2 minutes is treated as unknown, so a lost GPS signal cannot lock the app forever. Trade-off: a tunnel longer than
  2 minutes unlocks the UI. To be reviewed with real drivers (MANUAL_TEST.md §4).
- **2026-11-15 — The lock is applied at the root layout** (every screen, including onboarding and settings), and the
  controller's write methods also refuse when moving (defence in depth).
- **2026-11-15 — Motion detection thresholds:** moving > 10 km/h for 30 s suggests "start work"; stopped < 3 km/h for
  15 min while working suggests "start rest" (15 min is the shortest rest that counts). Suggestions are back-dated to
  when the condition began, never auto-committed, and a dismissed suggestion is not repeated.
- **2026-11-15 — Warnings:** thresholds 60/30/15/5 minutes plus an extra "limit reached" at 0. Each fires once per
  work run and limit. If several thresholds were crossed while the app was suspended, only the most urgent is spoken.
  The countdown is the forecast minus elapsed time; the forecast assumes continuous work, so the two fall one-for-one.

### Forecast performance
- **2026-11-15 — Two-tier forecast (app side, no engine change).** A forecast over 17 days of history took about
  0.5 s on V8 and would be several times slower on Hermes. The app runs a **fast tier** (rules ≤ 82 h, 6 days of history)
  first and paints it, then a **slow tier** (7 and 14 day rules, plus the 24 h rule BFM long/night needs, 17 days) and merges
  the earliest limit. The tiers are scheme *data* variants. Must be timed on devices (MANUAL_TEST.md §8).
- **2026-11-15 — History for engine calls is trimmed to 17 days**, starting at a rest, so a record never begins part-way through work.

### Product
- **2026-11-15 — Hours option and base are changed through new `profile` events**, so a scheme change becomes an
  engine `schemeChanges` entry and the HVNL s263 rules (48 h reset or full compliance) are applied.
- **2026-11-15 — Base options are QLD, NSW, VIC, SA, TAS, ACT** (WA/NT not offered). ACT uses `Australia/Sydney` (same
  rules and avoids relying on the `Australia/Canberra` alias in Hermes).
- **2026-11-15 — Bundle identifiers `au.example.logm8` are placeholders** for the owner to replace before store submission.
- **2026-11-15 — iPad / tablet support.** `supportsTablet: true` and `orientation: default` (all orientations; cab
  mounts are often landscape). Layout is responsive: content is centred and capped (640 pt, 1180 pt wide);
  from 840 pt wide Home is two columns (status/countdown/controls | timeline/breaches), the timeline is one row of
  24 hours and the countdown is larger. Wi-Fi-only iPads have no GPS: they work in manual mode with spoken warnings
  but get no motion suggestions and no driving lock; this must be explained to drivers (cellular iPads have GPS).
- **2026-11-15 — Tooling:** pnpm `node-linker=hoisted` (`.npmrc`) for Expo/Metro; Metro resolves the rules-engine's
  `.js`-suffixed TypeScript imports (custom `resolveRequest`); Jest maps them the same way. Expo SDK 58 / React 19.3 / RN 0.88.
  RNTL 14 (async `render`/`fireEvent`).

## Stage 3 (photo checker), 2026-11-15

### Template geometry (both sheet versions)
- **2026-11-15 — The daily sheet layouts are data** (`packages/diary-reader/src/templates/v1.4.json` and
  `pre-2026.json`). Normalised geometry for the work/rest grid, the place/odometer/two-up rows, the field boxes and
  the checkboxes.
  - **Source:** the two daily-sheet images on page 4 of the NHVR information sheet *HVNL changes to recording
    information in the Written Work Diary* (10 June 2026). That sheet shows the pre-1-Aug-2026 sheet (1016×717 px)
    and v1.4 (981×703 px).
  - **Measurement:** grid lines were found by pixel analysis. On v1.4, midnight to midnight is x = 106–868
    (31.75 px/hour) and the work/rest rows are y = 468 / 512 / 556. On pre-2026, x = 111–897 (32.75 px/hour) and
    y = 478 / 524 / 569. Field and checkbox boxes were read off the images.
  - **Status:** best-effort. These are low-resolution images, not the printed PDF (which was not available), so the
    templates are flagged `calibration: best-effort` and must be calibrated against real photos (MANUAL_TEST.md §10).
    The reader re-locates the grid lines and hour ticks on every photo, which absorbs small template errors in the
    grid; field and checkbox boxes have no such correction.
- **2026-11-15 — The sheet version is detected automatically** by correlating the rectified photo with each
  template's printed layout. It can also be forced.
- **2026-11-15 — The printed layer used by the generator and for version detection is an approximation**
  (lines, boxes, shading and ticks from the template, with "pseudo-text" blocks instead of real lettering).
  Real-photo calibration may need real reference scans.

### Reading pipeline (pure TypeScript, runs on the phone)
- **2026-11-15 — No native or computer-vision dependency.** The steps are:
  1. JPEG decode (`jpeg-js`, pure JS).
  2. Page detection: Otsu threshold on a downscaled image, the largest bright component, then a sub-pixel fit of
     each paper edge.
  3. Homography rectification to a 1400 px wide canonical sheet.
  4. Grid refinement: grid lines re-located locally, and the 25 printed hour ticks located to absorb residual
     perspective error.
  5. Per-cell classification of the drawn line in the work or rest row (local-background ink coverage).
  6. Checkbox and field "ink present" detection that ignores pixels printed on the reference layout.

  Reason: works offline and keeps the photo on the device.
- **2026-11-15 — Assumes a light sheet on a darker background** (the capture screen tells the driver this).
  A sheet on a white table may not be found; the error message says so.
- **2026-11-15 — Handwriting is read through `FieldReader`.** The mobile app uses `HttpFieldReader`, which posts small
  greyscale PNG crops (not the whole photo) to the server, configured by `EXPO_PUBLIC_FIELD_READER_URL`. Without it,
  `NullFieldReader` is used and only the presence of handwriting is checked. No API keys are in the app (a test
  enforces this).
- **2026-11-15 — `apps/api` is a zero-dependency Node HTTP server** with a `VisionProvider` interface and a stub
  provider (every field returns "not read"). Choosing and configuring a real vision model (server-side credentials,
  privacy terms for diary content) is an owner decision for a later stage.
- **2026-11-15 — `noUncheckedIndexedAccess` stays on for the diary-reader.** Pixel loops use non-null assertions
  (no runtime cost; a helper call per pixel would be slow on Hermes). ESLint allows `!` only in
  `packages/diary-reader/src`.

### Accuracy measurement
- **2026-11-15 — The accuracy targets (≥ 98% cells, ≥ 90% fully-correct sheets) are measured on SYNTHETIC sheets
  only.** These are rendered from the same templates the reader uses, so they show that the pipeline handles
  rotation (±8°), perspective, blur, lighting gradients and JPEG noise. They do **not** show real-world accuracy:
  printed lettering, pen pressure, folded or creased pages, other surfaces and real lighting are not modelled.
  `pnpm --filter @logm8/diary-reader accuracy` reports `fixtures/real/` photos separately once they exist.
- **2026-11-15 — The synthetic images are generated, not committed** (`fixtures/synthetic/` is git-ignored;
  `pnpm --filter @logm8/diary-reader synth 200` writes them with ground-truth JSON). Each sheet is deterministic from
  its seed. The mobile tests use one committed fixture (seed 3036) because the pipeline is about 20× slower under
  Jest's Babel transform.

### Comparison rules
- **2026-11-15 — Mandatory items come from the Regulation** (`requirements.ts`, with sources; see
  RULES_SOURCES.md). The rules that apply depend on the **date of the sheet**, not the sheet version: an old sheet
  used after 1 Aug 2026 follows the new rules (NHVR information sheet FAQ).
- **2026-11-15 — Place and odometer are checked at every change in the hour column of the change** (or the column
  before, for a change exactly on the hour).
  - **Same-day rest-to-work change:** reported as "check", not "missing", because REG s16(6) exempts it when the
    place and odometer are unchanged.
  - **Rest that began before midnight:** a rest running from the start of the sheet (midnight) is treated as
    having started the previous day, so it is not exempt.
  - **Odometer:** only required "if an odometer is fitted" (s16(2)(d)); the item notes this.
- **2026-11-15 — Rest drawn on a sheet is treated as stationary rest** for the breach check, because the sheet does
  not record where rest was taken. A false "no 7 h stationary rest" alarm is worse here than in the app, where the
  driver chooses the rest location.
- **2026-11-15 — Breaches visible on the sheet are checked for that one day only** (written-diary rounding, the
  driver's scheme from the profile or the ticked hours option). 7 and 14 day limits need the app log.
- **2026-11-15 — The sheet date comes from the handwritten date** (when a FieldReader is configured and returns
  it), otherwise from today in base time. The driver can change it on the results screen.

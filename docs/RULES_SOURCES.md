# Rules sources

Every numeric limit in SPEC §4.4 and every counting rule in SPEC §4.5, checked against official sources.
**Date checked for every row: 2026-11-15.** Pages and legislation were downloaded as raw HTML/PDF and read
directly (not through a summariser). Machine-readable copies of the values live in
`packages/rules-engine/src/schemes/*.json`; `packages/rules-engine/test/schemes.test.ts` asserts that the data
equals the values in this file.

## Source key

| Key | Source | URL |
|---|---|---|
| **REG** | Heavy Vehicle (Fatigue Management) National Regulation, in force from 1 Aug 2026 (Qld reprint, which is the National Regulation; the body text is identical to the "current" reprint as at 2026-11-15) | https://www.legislation.qld.gov.au/view/whole/html/inforce/2026-08-01/sl-2013-0078 |
| **REG-OLD** | Same Regulation, as in force 31 Jul 2026 (the BFM tables, which continue to apply to existing BFM accreditations) | https://www.legislation.qld.gov.au/view/whole/html/inforce/2026-07-31/sl-2013-0078 |
| **HVNL** | Heavy Vehicle National Law (Schedule to the Heavy Vehicle National Law Act 2012 (Qld)), current | https://www.legislation.qld.gov.au/view/whole/html/inforce/current/act-2012-021 |
| **HVNL-OLD** | Heavy Vehicle National Law as in force 31 Jul 2026 (BFM provisions, incl. s255 split rest) | https://www.legislation.qld.gov.au/view/whole/html/inforce/2026-07-31/act-2012-021 |
| **NHVR-WRH** | NHVR, "Work and rest hours" | https://www.nhvr.gov.au/safety-accreditation-compliance/fatigue-management/work-and-rest-hours |
| **NHVR-CT** | NHVR, "Counting time" | https://www.nhvr.gov.au/safety-accreditation-compliance/fatigue-management/counting-time |
| **NHVR-SPLIT** | NHVR, "Split rest breaks" | https://www.nhvr.gov.au/safety-accreditation-compliance/fatigue-management/split-rest-breaks |
| **NHVR-WWD** | NHVR information sheet "HVNL changes to recording information in the Written Work Diary, commencing 1 August 2026" (10 June 2026) | https://www.nhvr.gov.au/files/media/document/883/202606-1760-hvnl-changes-to-recording-information-in-written-work-diary.pdf |

BFM is transitional. NHVR-WWD (p. 3, p. 8) says existing BFM accreditation holders keep operating under their
BFM hours until expiry, and that the existing requirements for "changing between work and rest options" and
"counting time" keep applying. So the BFM tables and BFM counting rules are taken from REG-OLD and HVNL-OLD.

## Standard Hours — solo (truck) — REG Sch 1 Table 1 (also NHVR-WRH)

| Period | Max work | Min rest | Source | Matches SPEC |
|---|---|---|---|---|
| 5½ h | 5¼ h | 15 continuous min | REG Sch 1 T1; NHVR-WRH | yes |
| 8 h | 7½ h | 30 min in blocks ≥ 15 continuous min | REG Sch 1 T1; NHVR-WRH | yes |
| 11 h | 10 h | 60 min in blocks ≥ 15 continuous min | REG Sch 1 T1; NHVR-WRH | yes |
| 24 h | 12 h | 7 continuous h stationary rest | REG Sch 1 T1; NHVR-WRH | yes |
| 7 days (168 h) | 72 h | 24 continuous h stationary rest | REG Sch 1 T1; NHVR-WRH | yes |
| 14 days (336 h) | 144 h | 2 night rest breaks **and** 2 night rest breaks on consecutive days | REG Sch 1 T1; NHVR-WRH | yes |

## Standard Hours — two-up — REG Sch 1 Table 3 (also NHVR-WRH)

| Period | Max work | Min rest | Source | Matches SPEC |
|---|---|---|---|---|
| 5½ h | 5¼ h | 15 continuous min | REG Sch 1 T3 | yes |
| 8 h | 7½ h | 30 min in blocks ≥ 15 min | REG Sch 1 T3 | yes |
| 11 h | 10 h | 60 min in blocks ≥ 15 min | REG Sch 1 T3 | yes |
| 24 h | 12 h | 5 continuous h stationary rest, or 5 continuous h in an approved sleeper berth while moving | REG Sch 1 T3 | yes |
| 52 h | — | 10 continuous h stationary rest | REG Sch 1 T3 | yes |
| 7 days | 60 h | 24 continuous h stationary rest **and** 24 h stationary rest in blocks ≥ 7 continuous h | REG Sch 1 T3 | yes |
| 14 days | 120 h | 2 night rest breaks **and** 2 night rest breaks on consecutive days | REG Sch 1 T3 | yes |

## BFM — solo — REG-OLD Sch 2 Table 1 (also NHVR-WRH "BFM solo drivers")

| Period | Max work | Min rest | Source | Matches SPEC |
|---|---|---|---|---|
| 6¼ h | 6 h | 15 continuous min | REG-OLD Sch 2 T1 | yes |
| 9 h | 8½ h | 30 min in blocks ≥ 15 min | REG-OLD Sch 2 T1 | yes |
| 12 h | 11 h | 60 min in blocks ≥ 15 min | REG-OLD Sch 2 T1 | yes |
| 24 h | 14 h | 7 continuous h stationary rest (split-rest **defence**: see below) | REG-OLD Sch 2 T1; HVNL-OLD s255 | yes |
| 7 days | 36 h long/night work time | no limit set | REG-OLD Sch 2 T1 | yes |
| 14 days | 144 h | 24 continuous h stationary rest taken after ≤ 84 h work, **and** 24 continuous h stationary rest, **and** 2 night rest breaks, **and** 2 night rest breaks on consecutive days | REG-OLD Sch 2 T1 | yes |

## BFM — two-up — REG-OLD Sch 2 Table 2 (also NHVR-WRH "BFM two-up drivers")

| Period | Max work | Min rest | Source | Matches SPEC |
|---|---|---|---|---|
| 24 h | 14 h | no limit set | REG-OLD Sch 2 T2 | yes |
| 82 h | — | 10 continuous h stationary rest | REG-OLD Sch 2 T2 | yes |
| 7 days | 70 h | 24 continuous h stationary rest **and** 24 h stationary rest in blocks ≥ 7 continuous h | REG-OLD Sch 2 T2 | yes |
| 14 days | 140 h | 4 night rest breaks | REG-OLD Sch 2 T2 | yes |

## Risk categories (severity tiers)

Column 4 of REG Sch 1 Tables 1 and 3, and of REG-OLD Sch 2 Tables 1 and 2. They are encoded as `tiers` in the
scheme JSON exactly as printed (for example, Standard solo 24 h work: ≤ 12¾ h minor; > 12¾ to ≤ 13¼ h
substantial; > 13¼ to ≤ 13½ h severe; > 13½ h critical). The tables give no tier for rest shortfalls in the short
periods or for night rest breaks, so those breaches have no `severity` ("severity tier if known", SPEC §4.2).
There is an apparent misprint in REG Sch 1 Table 3 (two-up, 11 h); see DECISIONS.md.

## Definitions (SPEC §4.4 "Definitions")

| Definition | Official wording / value | Source | Matches SPEC |
|---|---|---|---|
| Stationary rest time | Rest time spent out of the vehicle, or in an approved sleeper berth of a stationary vehicle | HVNL s221 | yes |
| Major rest break | Rest time of at least 5 continuous hours | HVNL s221 | (not in SPEC; used for counting, see below) |
| Night rest break | (a) 7 continuous h stationary rest between 10 pm on a day and 8 am the next day, or (b) 24 continuous h stationary rest; base time zone (s248) | HVNL s5 | yes |
| Long/night work time (BFM) | Any work time (a) in excess of 12 h in a 24 h period, or (b) between 12 midnight and 6 am (base time zone). Examples: 53 min over 12 h → 1 h; 141 min between midnight and 3 am → 2½ h | REG-OLD s3; NHVR-CT "Counting long/night work time" ("both long and night work must be counted together") | yes |
| Two-up driving arrangement | 2 persons share the driving of a vehicle that has an approved sleeper berth | HVNL s221 | — |
| Work | Includes driving and other tasks related to the use of the vehicle (loading, unloading, inspecting, servicing, repairing, attending to load, refuelling, cleaning, ...) | HVNL s221 | yes (case 3) |
| Switching options | One option at a time (s262). Must not drive after changing unless, when changing from standard hours, the driver complies with all max work / min rest requirements of the new option or has had a reset rest break; from ACH or exemption hours a reset rest break is required (s263(1)). Pre-reform s263(1)(a) and NHVR-WRH: the same applies to changing from BFM | HVNL s262–263; HVNL-OLD s263; NHVR-WRH "Switching" | yes |
| Reset rest break | Rest time of at least 48 continuous hours; after a reset, the new option is counted from the end of the reset (s263(2)) | HVNL s263(2), (5) | yes |
| Multiple rest requirements | Can be met concurrently, except: 2 NRB vs 2 NRB on consecutive days; 24 h continuous vs 24 h in ≥ 7 h blocks; 24 h after ≤ 84 h vs 24 h | REG s22 (and REG-OLD s22 for BFM) | (not in SPEC; implemented as `exclusiveGroup`) |

## Counting-time rules (SPEC §4.5)

| Rule | Official position | Source | Matches SPEC |
|---|---|---|---|
| Periods < 24 h count from the end of **any** rest break | "Work periods of less than 24-hours must be counted forward from the end of any rest break" | NHVR-CT; HVNL s247(b) | yes |
| Periods ≥ 24 h, **Standard hours** (and ACH) | From 1 Aug 2026: counted forward from "the end of the longest major rest break required in a period under the driver's work and rest hours option". NHVR-CT applies this per period: 7 days from the end of a ≥ 24 h rest; 14 days from the end of a night rest break | HVNL s247(a) (amended 2025 No. 26 s52); NHVR-CT | yes, with clarification (§4.7 item 2) |
| Periods ≥ 24 h, **BFM** | Counted from "the end of a relevant major rest break" required under BFM (e.g. 14 days from a ≥ 24 h rest OR a night rest break) | HVNL-OLD s247(a); NHVR-CT "Basic Fatigue Management" | yes |
| BFM two-up 24 h | No rest requirement in the 24 h row, so no relevant major rest: count from the end of any rest (s247(b)) | REG-OLD Sch 2 T2; HVNL-OLD s247(b) | yes |
| No relevant major rest taken | "If you have not taken the required rest break, count from the end of any rest break" | NHVR-CT | yes (exact formulation: DECISIONS.md) |
| Later major rest does not reset an unfinished 24 h period; resuming work creates an overlapping period | "If you take another (subsequent) relevant/long major rest break during that 24-hour period, it does not reset the 24-hour period ... recommenced work at 2.45am ... would instead create an overlapping 24-hour counting period" (the 06:00 / 19:45 / 02:45 example is the same as SPEC case 4) | NHVR-CT "Important note" | yes |
| Written diary: work rounds up | Work counted in 15-minute periods; < 15 min counts as 15 (Reg examples 14 → 15, 17 → 30, 53 → 60); NHVR table 6 → 15, 32 → 45, 2 h 21 → 2 h 30 | REG s19(2)–(3); NHVR-CT | yes |
| Written diary: rest rounds down | Rest counted in blocks of no less than 15 min; < 15 min disregarded (17 → 15); NHVR table 12 → 0, 44 → 30, 6 h 40 → 6 h 30 | REG s19(4)–(5); NHVR-CT | yes |
| Written diary: 15-minute grid aligned to the clock | NHVR-CT: "rounding up to the next 15-minute interval". REG s20(1)(b): record as the diary's instructions say. The instructions are in Part 1 of the National Driver Work Diary itself, which was **not** available online | NHVR-CT; REG s20 | **UNVERIFIED** (see below) |
| Electronic: per minute | Work and rest counted in 1-minute periods; periods < 1 min not counted; a rest < 15 min does not count towards a minimum rest (example: 14 + 24 + 22 min ≠ 60 min) | REG s19A; NHVR-CT | yes |
| Base time zone | Time is counted and recorded in the time zone of the driver's base (e.g. a QLD-based driver in NSW during daylight saving uses Queensland time) | HVNL s248; REG s20B; NHVR-CT "Time zones" | yes |
| Unsupported jurisdictions | WA and NT are not participating jurisdictions. s245 has special rules for time spent outside participating jurisdictions; v1 does not implement them and returns "unsupported jurisdiction" | HVNL s244–245; SPEC §1 | yes |

## SPEC §4.7 open items — resolution

1. **BFM split rest (6 h + split): RESOLVED (definition).** HVNL-OLD s255 (also NHVR-SPLIT) makes it a
   **defence**, not a scheduled option. It is available to a BFM **solo** driver required to have 7 continuous
   hours of stationary rest in a 24 h period, if during that period the driver had 6 continuous h + 2 continuous h
   of stationary rest, and had not had a split rest break in the previous 24 h period. NHVR-SPLIT adds that split
   rests "cannot be scheduled or rostered under any circumstance". The engine reports it as a
   `bfm_split_rest_defence` notice instead of a breach. The SPEC statement that BFM 24 h periods count "from a
   ≥ 6 h rest when split rest is used" is **not** in any official source found: see UNVERIFIED.
2. **"Simplified, one consistent rule for all period lengths" (Standard Hours / ACH): RESOLVED.** HVNL s247(a)
   now reads "the end of the **longest** major rest break required in a period under the driver's work and rest
   hours option" (previously "the end of a relevant major rest break"). NHVR-CT applies it per period length (7 days
   from a ≥ 24 h rest, 14 days from a night rest break), and the 24 h period by the same logic counts from the 7 h
   (solo) / 5 h (two-up) rest. Periods < 24 h still count from any rest. For Standard Hours this matches SPEC §4.5
   in effect. The only change is that, where a period's rest column lists more than one rest, only the longest
   one is a counting start. For two-up 7 days (24 h continuous + 24 h in ≥ 7 h blocks) that is the 24 h rest. For
   two-up 24 h, the two alternatives (5 h stationary / 5 h sleeper berth moving) are the same length, so both count.
   No limit values change. BFM keeps "a relevant major rest break" (every listed major rest is a counting start).
3. **Did any Standard Hours limits change on 1 Aug 2026? RESOLVED: no.** Schedule 1 of REG-OLD (31 Jul 2026)
   and REG (1 Aug 2026) were diffed line by line. Only the headings and section references changed. All
   periods, limits and risk categories are identical.
4. **WWD changes from 1 Aug 2026 (NHVR-WWD): checked.** Day of week, daily totals and the Standard Hours tick
   become optional on all sheets. This affects stage 3 (photo checker), not the engine. No counting rule
   changed.

## UNVERIFIED

These items could not be confirmed from an official source. The engine follows the conservative or SPEC
reading noted, and the decision is recorded in DECISIONS.md. Tests that depend on them are tagged `@unverified`.

| # | Item | Engine behaviour | Tests tagged |
|---|---|---|---|
| U1 | Written diary 15-min blocks are aligned to the clock grid (SPEC case 2), rather than rounding each period's duration. The diary's Part 1 instructions were not obtained. The two readings differ only for times that are not on a 15-minute boundary | Clock-aligned grid (SPEC); for work this is never less than duration rounding | spec-cases "2. Rounding (written) ... @unverified"; rounding "mixes rest kinds ... @unverified" |
| U2 | BFM solo 24 h periods counting from the end of a ≥ 6 h rest when a split rest is used (SPEC §4.5) | Implemented as extra counting points only when the 6 h block is part of a 6 h + 2 h pair (conservative: more periods are checked) | rules "@unverified split rest ..." |
| U3 | Long/night "in excess of 12 hours": which minutes are "the excess" when night work comes before the 12 h mark. No official worked example covers it | Chronological: work after the first 12 h of work in each 24 h period. This is never less than the alternative reading. SPEC cases 5–7 give the same result under every reading | none (no test depends on it) |
| U4 | Whether one continuous stationary rest spanning two nights counts as two night rest breaks | Counted once per qualifying night (literal HVNL s5 reading) | none (no test depends on it) |
| U5 | Exact formulation of "if you have not taken the required rest break, count from the end of any rest break" | A rest end is also a counting start when no qualifying major rest ended within the preceding period length | covered implicitly by case 10 (52 h) |

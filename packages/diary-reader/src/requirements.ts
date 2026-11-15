/**
 * What must be filled in on a daily sheet, as data, with sources (see docs/RULES_SOURCES.md, stage 3).
 * REG = Heavy Vehicle (Fatigue Management) National Regulation in force from 1 Aug 2026; REG-OLD = as in force 31 Jul 2026.
 */
export const REFORM_DATE = '2026-08-01';

export type RequirementWhen =
  /** Every sheet. */
  | 'always'
  /** Only sheets for days before 1 August 2026 (optional from then, on every sheet version). */
  | 'before_reform'
  /** From 1 August 2026, only if the driver is not on Standard Hours (before then: always). */
  | 'non_standard_from_reform'
  /** Only when the driver is in a two-up driving arrangement. */
  | 'two_up';

export type RequirementTarget = { field: string } | { allFields: string[] } | { checkboxGroup: string };

export interface RecordingRequirement {
  id: string;
  label: string;
  target: RequirementTarget;
  when: RequirementWhen;
  source: string;
}

export const SHEET_REQUIREMENTS: readonly RecordingRequirement[] = [
  { id: 'date', label: 'Date', target: { field: 'date' }, when: 'always', source: 'REG s15(1)(a); REG-OLD s15(1)(a)' },
  { id: 'numberPlate', label: 'Number plate (registration)', target: { field: 'numberPlate' }, when: 'always', source: 'REG s15(1)(b)' },
  { id: 'driverName', label: "Driver's name", target: { field: 'driverName' }, when: 'always', source: 'REG s15(1)(c)' },
  { id: 'licenceNo', label: 'Licence number', target: { field: 'licenceNo' }, when: 'always', source: 'REG s15(1)(d)' },
  { id: 'timeZone', label: 'Time zone of base', target: { checkboxGroup: 'timeZone' }, when: 'always', source: 'REG s15(1)(k)' },
  { id: 'signature', label: "Driver's signature", target: { field: 'signature' }, when: 'always', source: 'REG s20(1)(c)(i)' },
  { id: 'hoursOption', label: 'Driver hours option', target: { checkboxGroup: 'hoursOption' }, when: 'non_standard_from_reform', source: 'REG s15(1)(e); REG-OLD s15(1)(e); NHVR WWD information sheet (Standard tick optional)' },
  { id: 'dayOfWeek', label: 'Day of the week', target: { checkboxGroup: 'dayOfWeek' }, when: 'before_reform', source: 'REG-OLD s15(1)(a); NHVR WWD information sheet (optional from 1 Aug 2026)' },
  { id: 'totals', label: 'Daily work and rest totals', target: { allFields: ['totalWork', 'totalRest'] }, when: 'before_reform', source: 'NHVR WWD information sheet (no longer required from 1 Aug 2026)' },
  { id: 'twoUpName', label: "Two-up driver's name", target: { field: 'twoUpName' }, when: 'two_up', source: 'REG s17(2)(a)' },
  { id: 'twoUpLicenceNo', label: "Two-up driver's licence number", target: { field: 'twoUpLicenceNo' }, when: 'two_up', source: 'REG s17(2)(b)' },
  { id: 'twoUpLicenceState', label: "Two-up driver's licence jurisdiction", target: { checkboxGroup: 'twoUpLicenceState' }, when: 'two_up', source: 'REG s17(2)(b)' },
  { id: 'twoUpSignature', label: "Two-up driver's signature", target: { field: 'twoUpSignature' }, when: 'two_up', source: 'REG s20(1)(c)(ii)' },
];

/** Items that became optional on 1 August 2026 and must NOT be flagged on sheets from that date. */
export const OPTIONAL_FROM_REFORM: readonly string[] = ['dayOfWeek', 'hoursOption (Standard Hours)', 'totals'];

export const CHANGE_REQUIREMENTS = {
  place: { label: 'Place of the work/rest change', source: 'REG s16(2)(c)' },
  odometer: { label: 'Odometer reading at the change', source: 'REG s16(2)(d)' },
  restToWorkExemption: 'REG s16(6): not needed for a change from rest to work on the same day if the place and odometer have not changed since the start of that rest.',
} as const;

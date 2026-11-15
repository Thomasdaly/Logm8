import { BFM_SOLO, BFM_TWO_UP, STANDARD_SOLO, STANDARD_TWO_UP, type SchemeDefinition } from '@logmate/rules-engine';
import type { BaseState, Profile, SchemeFamilyChoice } from './types';

export interface BaseOption {
  state: BaseState;
  label: string;
  timeZone: string;
}

/** Supported HVNL jurisdictions and the IANA zone of their base. WA and NT are out of scope for v1. */
export const BASE_OPTIONS: readonly BaseOption[] = [
  { state: 'QLD', label: 'Queensland', timeZone: 'Australia/Brisbane' },
  { state: 'NSW', label: 'New South Wales', timeZone: 'Australia/Sydney' },
  { state: 'VIC', label: 'Victoria', timeZone: 'Australia/Melbourne' },
  { state: 'SA', label: 'South Australia', timeZone: 'Australia/Adelaide' },
  { state: 'TAS', label: 'Tasmania', timeZone: 'Australia/Hobart' },
  { state: 'ACT', label: 'ACT', timeZone: 'Australia/Sydney' },
];

export const UNSUPPORTED_BASES: readonly string[] = ['Western Australia', 'Northern Territory'];

export function schemeFor(family: SchemeFamilyChoice, twoUp: boolean): SchemeDefinition {
  if (family === 'standard') return twoUp ? STANDARD_TWO_UP : STANDARD_SOLO;
  return twoUp ? BFM_TWO_UP : BFM_SOLO;
}

export interface ProfileInput {
  schemeFamily: SchemeFamilyChoice;
  twoUp: boolean;
  baseName: string;
  baseState: BaseState | null;
  rego: string;
  wwdNumber: string;
}

export type ProfileValidation = { ok: true; profile: Profile } | { ok: false; errors: Partial<Record<'baseName' | 'baseState' | 'rego' | 'wwdNumber', string>> };

export function validateProfileInput(input: ProfileInput): ProfileValidation {
  const errors: Partial<Record<'baseName' | 'baseState' | 'rego' | 'wwdNumber', string>> = {};
  const baseName = input.baseName.trim();
  const rego = input.rego.trim().toUpperCase();
  const wwdNumber = input.wwdNumber.trim();
  if (baseName.length === 0) errors.baseName = 'Enter your base (town or depot).';
  const opt = BASE_OPTIONS.find((o) => o.state === input.baseState);
  if (!opt) errors.baseState = 'Choose the state your base is in.';
  if (rego.length === 0) errors.rego = 'Enter the vehicle registration.';
  else if (!/^[A-Z0-9 -]{1,10}$/.test(rego)) errors.rego = 'Registration can only contain letters, numbers, spaces and dashes.';
  if (wwdNumber.length === 0) errors.wwdNumber = 'Enter your Written Work Diary number.';
  if (Object.keys(errors).length > 0 || !opt) return { ok: false, errors };
  return {
    ok: true,
    profile: { schemeFamily: input.schemeFamily, twoUp: input.twoUp, baseName, baseState: opt.state, baseTimeZone: opt.timeZone, rego, wwdNumber, recordingMode: 'written' },
  };
}

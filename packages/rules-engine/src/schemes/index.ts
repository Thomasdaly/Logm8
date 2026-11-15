import type { SchemeDefinition } from '@logmate/shared';
import { validateScheme } from '../schemeValidation.js';
import standardSoloJson from './standard-solo.json';
import standardTwoUpJson from './standard-two-up.json';
import bfmSoloJson from './bfm-solo.json';
import bfmTwoUpJson from './bfm-two-up.json';

function load(json: unknown): SchemeDefinition {
  const v = validateScheme(json);
  if (!v.ok) throw new Error(`Built-in scheme failed validation: ${v.errors.join('; ')}`);
  return v.scheme;
}

/** Standard Hours, solo driver of a fatigue-regulated heavy vehicle (Fatigue Reg Sch 1 Table 1). */
export const STANDARD_SOLO: SchemeDefinition = load(standardSoloJson);
/** Standard Hours, two-up driving arrangement (Fatigue Reg Sch 1 Table 3). */
export const STANDARD_TWO_UP: SchemeDefinition = load(standardTwoUpJson);
/** BFM solo (transitional; pre-1 Aug 2026 Fatigue Reg Sch 2 Table 1). */
export const BFM_SOLO: SchemeDefinition = load(bfmSoloJson);
/** BFM two-up (transitional; pre-1 Aug 2026 Fatigue Reg Sch 2 Table 2). */
export const BFM_TWO_UP: SchemeDefinition = load(bfmTwoUpJson);

export const BUILT_IN_SCHEMES: readonly SchemeDefinition[] = [STANDARD_SOLO, STANDARD_TWO_UP, BFM_SOLO, BFM_TWO_UP];

import type { Jurisdiction, WorkRestEvent } from '@logm8/shared';

/**
 * Base time zones accepted for HVNL participating jurisdictions (QLD, NSW, VIC, SA, TAS, ACT).
 * WA and NT are not participating jurisdictions (SPEC §1, §8) and are explicitly unsupported.
 */
const SUPPORTED_ZONES: Readonly<Record<string, Jurisdiction>> = {
  'Australia/Brisbane': 'QLD',
  'Australia/Lindeman': 'QLD',
  'Australia/Queensland': 'QLD',
  'Australia/Sydney': 'NSW',
  'Australia/NSW': 'NSW',
  'Australia/Broken_Hill': 'NSW',
  'Australia/Yancowinna': 'NSW',
  'Australia/Lord_Howe': 'NSW',
  'Australia/LHI': 'NSW',
  'Australia/Melbourne': 'VIC',
  'Australia/Victoria': 'VIC',
  'Australia/Adelaide': 'SA',
  'Australia/South': 'SA',
  'Australia/Hobart': 'TAS',
  'Australia/Tasmania': 'TAS',
  'Australia/Currie': 'TAS',
  'Australia/Canberra': 'ACT',
  'Australia/ACT': 'ACT',
};

const UNSUPPORTED_ZONES: Readonly<Record<string, Jurisdiction>> = {
  'Australia/Perth': 'WA',
  'Australia/West': 'WA',
  'Australia/Eucla': 'WA',
  'Australia/Darwin': 'NT',
  'Australia/North': 'NT',
};

export type JurisdictionCheck = { supported: true } | { supported: false; jurisdiction: string; message: string };

export function checkJurisdiction(baseTimeZone: string, events: readonly WorkRestEvent[]): JurisdictionCheck {
  const unsupported = UNSUPPORTED_ZONES[baseTimeZone];
  if (unsupported) {
    return {
      supported: false,
      jurisdiction: unsupported,
      message: `Base time zone ${baseTimeZone} is in ${unsupported}, which is not an HVNL participating jurisdiction. This app cannot check ${unsupported} fatigue rules.`,
    };
  }
  if (!SUPPORTED_ZONES[baseTimeZone]) {
    return {
      supported: false,
      jurisdiction: baseTimeZone,
      message: `Base time zone ${baseTimeZone} is not a recognised base time zone in an HVNL participating jurisdiction (QLD, NSW, VIC, SA, TAS, ACT).`,
    };
  }
  const outside = events.find((e) => e.jurisdiction === 'WA' || e.jurisdiction === 'NT');
  if (outside?.jurisdiction) {
    return {
      supported: false,
      jurisdiction: outside.jurisdiction,
      message: `The record includes time in ${outside.jurisdiction} (from ${outside.start}). Journeys in WA/NT are not supported in this version, so the record cannot be checked.`,
    };
  }
  return { supported: true };
}

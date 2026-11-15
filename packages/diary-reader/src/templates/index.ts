import type { SheetTemplate, SheetVersionId } from '../types.js';
import pre2026 from './pre-2026.json';
import v14 from './v1.4.json';

/** Daily-sheet layouts, as data. See docs/DECISIONS.md (stage 3) for how they were measured. */
export const TEMPLATE_V14 = v14 as unknown as SheetTemplate;
export const TEMPLATE_PRE_2026 = pre2026 as unknown as SheetTemplate;
export const TEMPLATES: readonly SheetTemplate[] = [TEMPLATE_V14, TEMPLATE_PRE_2026];

export function templateById(id: SheetVersionId): SheetTemplate {
  const t = TEMPLATES.find((x) => x.id === id);
  if (!t) throw new Error(`Unknown sheet version ${id}`);
  return t;
}

export const CELLS_PER_DAY = 96;

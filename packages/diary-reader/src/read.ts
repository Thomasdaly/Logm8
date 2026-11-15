import { detectPage } from './detect.js';
import type { FieldCrop, FieldReader, FieldValue } from './fields.js';
import { solveHomography, warp } from './homography.js';
import { boxBlur, crop, decodeJpeg, downscale, inkFraction, quantileIn, rgbaToGray } from './image.js';
import { boxPx, printedGray } from './render.js';
import { CELLS_PER_DAY, TEMPLATES } from './templates/index.js';
import type { CellState, GrayImage, Quad, RgbaImage, SheetTemplate, SheetVersionId } from './types.js';

/** Width (px) of the rectified sheet. */
export const CANONICAL_WIDTH = 1400;

export interface GridGeometry {
  x0: number;
  x1: number;
  workTop: number;
  split: number;
  restBottom: number;
}

export interface GridReading {
  cells: CellState[];
  workScores: number[];
  restScores: number[];
  geometry: GridGeometry;
}

export interface SheetReadingOk {
  ok: true;
  version: SheetVersionId;
  versionScores: Record<string, number>;
  template: SheetTemplate;
  quad: Quad;
  cells: CellState[];
  workScores: number[];
  restScores: number[];
  /** Marked options per checkbox group; `readable: false` when the sheet has no printed boxes for the group. */
  checkboxes: Record<string, { marked: string[]; readable: boolean }>;
  /** Whether each field box contains handwriting. */
  fieldInk: Record<string, boolean>;
  /** Ink per hour column (index = hour) in the odometer and place rows. */
  hourInk: { odometer: boolean[]; place: boolean[] };
  /** Values read by the FieldReader (only for fields with ink). */
  fields: Record<string, FieldValue>;
  rectified: GrayImage;
}

export interface SheetReadingError {
  ok: false;
  error: 'decode_failed' | 'page_not_found';
  message: string;
}

export type SheetReading = SheetReadingOk | SheetReadingError;

export interface ReadOptions {
  /** Force a sheet version instead of detecting it. */
  version?: SheetVersionId;
  fieldReader?: FieldReader;
  templates?: readonly SheetTemplate[];
}

export function canonicalSize(t: SheetTemplate): { W: number; H: number } {
  return { W: CANONICAL_WIDTH, H: Math.round(CANONICAL_WIDTH / t.aspect) };
}

/** Warps the photographed page onto the template's canonical frame. */
export function rectify(img: GrayImage, quad: Quad, t: SheetTemplate): GrayImage {
  const { W, H } = canonicalSize(t);
  const h = solveHomography(
    [
      { x: 0, y: 0 },
      { x: W, y: 0 },
      { x: W, y: H },
      { x: 0, y: H },
    ],
    quad,
  );
  return warp(img, h, W, H, 1);
}

/** Normalised cross-correlation of two equally sized images. */
function ncc(a: GrayImage, b: GrayImage): number {
  const n = Math.min(a.data.length, b.data.length);
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a.data[i]!;
    mb += b.data[i]!;
  }
  ma /= n;
  mb /= n;
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  for (let i = 0; i < n; i++) {
    const da = a.data[i]! - ma;
    const db = b.data[i]! - mb;
    sab += da * db;
    saa += da * da;
    sbb += db * db;
  }
  return sab / Math.sqrt(saa * sbb || 1e-12);
}

/** Similarity of a rectified page to a template's printed layout. */
export function templateScore(rect: GrayImage, t: SheetTemplate): number {
  const ref = printedGray(t, rect.width);
  return ncc(boxBlur(downscale(rect, 4), 1), boxBlur(downscale(ref, 4), 1));
}

function refineLine(img: GrayImage, horizontal: boolean, expected: number, from: number, to: number, R: number): number {
  let best = expected;
  let bestScore = -1;
  const covAt = (p: number): number => {
    let dark = 0;
    let n = 0;
    for (let q = Math.round(from); q < to; q += 2) {
      const x = horizontal ? q : p;
      const y = horizontal ? p : q;
      if (x < 0 || y < 0 || x >= img.width || y >= img.height) continue;
      n++;
      if (img.data[y * img.width + x]! < 0.55) dark++;
    }
    return n ? dark / n : 0;
  };
  const e = Math.round(expected);
  const cov = new Map<number, number>();
  for (let p = e - R - 1; p <= e + R + 1; p++) cov.set(p, covAt(p));
  for (let p = e - R; p <= e + R; p++) {
    const s = (cov.get(p - 1) ?? 0) * 0.5 + (cov.get(p) ?? 0) + (cov.get(p + 1) ?? 0) * 0.5;
    if (s > bestScore) {
      bestScore = s;
      best = p;
    }
  }
  return bestScore >= 0.6 ? best : expected;
}

/**
 * Finds the 25 hour boundaries along the grid using the printed hour ticks. Hour ticks are longer than the
 * quarter ticks, so only they reach the bands sampled here (18-42% into the work row from the top and into the
 * rest row from the bottom), which the driver's horizontal line and vertical connectors rarely cross. This corrects
 * residual perspective error that a straight linear spacing would accumulate across the day.
 */
export function locateHourTicks(rect: GrayImage, x0: number, x1: number, workTop: number, split: number, restBottom: number, hours = 24): number[] {
  const step = (x1 - x0) / hours;
  const R = Math.max(2, Math.round(step * 0.18));
  const wh = split - workTop;
  const rh = restBottom - split;
  const bands: Array<[number, number]> = [
    [workTop + wh * 0.18, workTop + wh * 0.42],
    [restBottom - rh * 0.42, restBottom - rh * 0.18],
  ];
  const colScore = (x: number): number => {
    let dark = 0;
    let n = 0;
    for (const [ya, yb] of bands) {
      for (let y = Math.round(ya); y < yb; y++) {
        for (const xx of [Math.floor(x), Math.ceil(x)]) {
          if (xx < 0 || xx >= rect.width) continue;
          n++;
          if (rect.data[y * rect.width + xx]! < 0.6) dark++;
        }
      }
    }
    return n ? dark / n : 0;
  };
  const found: Array<number | null> = [];
  let offset = 0;
  for (let h = 0; h <= hours; h++) {
    if (h === 0 || h === hours) {
      found.push(h === 0 ? x0 : x1);
      continue;
    }
    const exp = x0 + h * step + offset;
    let best = exp;
    let bestScore = -1;
    for (let d = -R; d <= R; d += 0.5) {
      const sc = colScore(exp + d - 0.5) * 0.5 + colScore(exp + d) + colScore(exp + d + 0.5) * 0.5;
      if (sc > bestScore) {
        bestScore = sc;
        best = exp + d;
      }
    }
    if (bestScore >= 0.9) {
      found.push(best);
      offset = best - (x0 + h * step);
    } else found.push(null);
  }
  // fill gaps by linear interpolation between found ticks
  const out: number[] = [];
  for (let h = 0; h <= hours; h++) {
    const v = found[h];
    if (v !== null && v !== undefined) {
      out.push(v);
      continue;
    }
    let a = h - 1;
    while (a > 0 && (found[a] === null || found[a] === undefined)) a--;
    let b = h + 1;
    while (b < hours && (found[b] === null || found[b] === undefined)) b++;
    const va = found[a] ?? x0;
    const vb = found[b] ?? x1;
    out.push(va + ((vb - va) * (h - a)) / (b - a));
  }
  return out;
}

/** Locates the work/rest grid precisely (around the template's expected position) and classifies the 96 cells. */
export function readGrid(rect: GrayImage, t: SheetTemplate): GridReading {
  const W = rect.width;
  const H = rect.height;
  const g = t.grid;
  const R = Math.round(H * 0.012);
  const ex0 = g.x0 * W;
  const ex1 = g.x1 * W;
  const workTop = refineLine(rect, true, g.workTop * H, ex0, ex1, R);
  const split = refineLine(rect, true, g.split * H, ex0, ex1, R);
  const restBottom = refineLine(rect, true, g.restBottom * H, ex0, ex1, R);
  const x0 = refineLine(rect, false, ex0, workTop, restBottom, R);
  const x1 = refineLine(rect, false, ex1, workTop, restBottom, R);

  const hourX = locateHourTicks(rect, x0, x1, workTop, split, restBottom);
  const cellX = (i: number): number => {
    const h = Math.min(t.grid.hours - 1, Math.floor(i / t.grid.cellsPerHour));
    const q = i - h * t.grid.cellsPerHour;
    return hourX[h]! + ((hourX[h + 1]! - hourX[h]!) * q) / t.grid.cellsPerHour;
  };
  const bandScore = (cx0: number, cx1: number, y0: number, y1: number): number => {
    const bg = quantileIn(rect, cx0, y0, cx1, y1, 0.85);
    const ya = Math.round(y0);
    const yb = Math.round(y1);
    const covs: number[] = [];
    for (let y = ya; y < yb; y++) covs.push(inkFraction(rect, cx0, y, cx1, y + 1, bg, 0.62));
    let best = 0;
    for (let i = 0; i < covs.length; i++) {
      const c = covs[i]!;
      const s = ((covs[i - 1] ?? c) + c + (covs[i + 1] ?? c)) / 3;
      if (s > best) best = s;
    }
    return best;
  };
  const cells: CellState[] = [];
  const workScores: number[] = [];
  const restScores: number[] = [];
  const workH = split - workTop;
  const restH = restBottom - split;
  for (let i = 0; i < CELLS_PER_DAY; i++) {
    const a = cellX(i);
    const b = cellX(i + 1);
    const cx0 = a + (b - a) * 0.22;
    const cx1 = a + (b - a) * 0.78;
    const w = bandScore(cx0, cx1, workTop + workH * 0.12, split - workH * 0.12);
    const r = bandScore(cx0, cx1, split + restH * 0.12, restBottom - restH * 0.12);
    workScores.push(w);
    restScores.push(r);
    cells.push(Math.max(w, r) < 0.45 ? 'none' : w >= r ? 'work' : 'rest');
  }
  return { cells, workScores, restScores, geometry: { x0, x1, workTop, split, restBottom } };
}

function shrink(b: { x: number; y: number; w: number; h: number }, fx: number, fy: number) {
  return { x: b.x + b.w * fx, y: b.y + b.h * fy, w: b.w * (1 - 2 * fx), h: b.h * (1 - 2 * fy) };
}

function pageBackground(rect: GrayImage, b: { x: number; y: number; w: number; h: number }): number {
  return Math.max(0.3, quantileIn(rect, b.x - b.w, b.y - b.h, b.x + 2 * b.w, b.y + 2 * b.h, 0.9, 2));
}

/**
 * Handwriting coverage in a rectangle: pixels darker than `ratio` x background where the printed reference
 * layout is blank (so printed letters, lines and the watermark are not mistaken for ink).
 */
function handInk(rect: GrayImage, ref: GrayImage, b: { x: number; y: number; w: number; h: number }, bg: number, ratio = 0.6): number {
  const xa = Math.max(0, Math.floor(b.x));
  const xb = Math.min(rect.width, Math.ceil(b.x + b.w));
  const ya = Math.max(0, Math.floor(b.y));
  const yb = Math.min(rect.height, Math.ceil(b.y + b.h));
  const t = bg * ratio;
  let n = 0;
  let dark = 0;
  for (let y = ya; y < yb; y++) {
    for (let x = xa; x < xb; x++) {
      const i = y * rect.width + x;
      // ignore pixels within 2 px of printed ink in the reference
      let printed = false;
      for (let dy = -2; dy <= 2 && !printed; dy += 2) for (let dx = -2; dx <= 2 && !printed; dx += 2) {
        const yy = Math.min(rect.height - 1, Math.max(0, y + dy));
        const xx = Math.min(rect.width - 1, Math.max(0, x + dx));
        if (ref.data[yy * rect.width + xx]! < 0.8) printed = true;
      }
      if (printed) continue;
      n++;
      if (rect.data[i]! < t) dark++;
    }
  }
  return n === 0 ? 0 : dark / n;
}

export function readCheckboxes(rect: GrayImage, t: SheetTemplate): SheetReadingOk['checkboxes'] {
  const ref = printedGray(t, rect.width);
  const out: SheetReadingOk['checkboxes'] = {};
  for (const grp of t.checkboxGroups) {
    if (!grp.outlined) {
      out[grp.id] = { marked: [], readable: false };
      continue;
    }
    const marked: string[] = [];
    for (const o of grp.options) {
      const b = boxPx(o.box, rect.width, rect.height);
      const ink = handInk(rect, ref, shrink(b, 0.12, 0.12), pageBackground(rect, b));
      if (ink > 0.06) marked.push(o.value);
    }
    out[grp.id] = { marked, readable: true };
  }
  return out;
}

export function readFieldInk(rect: GrayImage, t: SheetTemplate): Record<string, boolean> {
  const ref = printedGray(t, rect.width);
  const out: Record<string, boolean> = {};
  for (const f of t.fields) {
    const b = boxPx(f.box, rect.width, rect.height);
    out[f.id] = handInk(rect, ref, shrink(b, 0.03, 0.1), pageBackground(rect, b)) > 0.01;
  }
  return out;
}

function hourColumns(rect: GrayImage, t: SheetTemplate, top: number, bottom: number): Array<{ x: number; y: number; w: number; h: number }> {
  const W = rect.width;
  const H = rect.height;
  const colW = ((t.grid.x1 - t.grid.x0) * W) / t.grid.hours;
  return Array.from({ length: t.grid.hours }, (_, h) => shrink({ x: t.grid.x0 * W + h * colW, y: top * H, w: colW, h: (bottom - top) * H }, 0.12, 0.06));
}

export function readHourInk(rect: GrayImage, t: SheetTemplate): SheetReadingOk['hourInk'] {
  const a = t.activities;
  const ref = printedGray(t, rect.width);
  const has = (b: { x: number; y: number; w: number; h: number }): boolean => handInk(rect, ref, b, quantileIn(rect, b.x, b.y, b.x + b.w, b.y + b.h, 0.9, 2)) > 0.008;
  return {
    odometer: hourColumns(rect, t, a.odometerTop, a.placeTop).map(has),
    place: hourColumns(rect, t, a.placeTop, a.twoUpTop).map(has),
  };
}

/** The crops sent to the FieldReader: text fields with ink, and the place/odometer column of each hour with ink. */
export function fieldCrops(rect: GrayImage, t: SheetTemplate, fieldInk: Record<string, boolean>, hourInk: SheetReadingOk['hourInk']): FieldCrop[] {
  const crops: FieldCrop[] = [];
  for (const f of t.fields) {
    if (f.kind === 'signature' || !fieldInk[f.id]) continue;
    const b = boxPx(f.box, rect.width, rect.height);
    crops.push({ id: f.id, kind: f.kind === 'date' ? 'date' : 'text', image: crop(rect, b.x, b.y, b.w, b.h) });
  }
  const a = t.activities;
  const odo = hourColumns(rect, t, a.odometerTop, a.placeTop);
  const place = hourColumns(rect, t, a.placeTop, a.twoUpTop);
  for (let h = 0; h < t.grid.hours; h++) {
    const hh = String(h).padStart(2, '0');
    if (hourInk.odometer[h]) crops.push({ id: `odometer-${hh}`, kind: 'odometer', image: crop(rect, odo[h]!.x, odo[h]!.y, odo[h]!.w, odo[h]!.h) });
    if (hourInk.place[h]) crops.push({ id: `place-${hh}`, kind: 'place', image: crop(rect, place[h]!.x, place[h]!.y, place[h]!.w, place[h]!.h) });
  }
  return crops;
}

/**
 * Reads a photographed daily sheet: find the page, rectify it, detect the sheet version, read the 15-minute grid,
 * checkboxes and field ink, and (optionally) read handwriting through the FieldReader.
 */
export async function readSheet(input: Uint8Array | RgbaImage | GrayImage, opts: ReadOptions = {}): Promise<SheetReading> {
  let gray: GrayImage;
  try {
    if (input instanceof Uint8Array) gray = rgbaToGray(decodeJpeg(input));
    else if ('data' in input && input.data instanceof Float32Array) gray = input as GrayImage;
    else gray = rgbaToGray(input as RgbaImage);
  } catch (e) {
    return { ok: false, error: 'decode_failed', message: `Could not decode the photo: ${(e as Error).message}` };
  }
  const quad = detectPage(gray);
  if (!quad) return { ok: false, error: 'page_not_found', message: 'Could not find the daily sheet in the photo. Photograph the whole sheet on a darker surface.' };

  const candidates = (opts.templates ?? TEMPLATES).filter((t) => !opts.version || t.id === opts.version);
  const versionScores: Record<string, number> = {};
  let best: { t: SheetTemplate; rect: GrayImage; score: number } | null = null;
  for (const t of candidates) {
    const rect = rectify(gray, quad, t);
    const score = candidates.length > 1 ? templateScore(rect, t) : 1;
    versionScores[t.id] = score;
    if (!best || score > best.score) best = { t, rect, score };
  }
  if (!best) return { ok: false, error: 'page_not_found', message: 'No sheet template available.' };

  const { t, rect } = best;
  const grid = readGrid(rect, t);
  const checkboxes = readCheckboxes(rect, t);
  const fieldInk = readFieldInk(rect, t);
  const hourInk = readHourInk(rect, t);
  const fields = opts.fieldReader ? await opts.fieldReader.readFields(fieldCrops(rect, t, fieldInk, hourInk)) : {};
  return { ok: true, version: t.id, versionScores, template: t, quad, cells: grid.cells, workScores: grid.workScores, restScores: grid.restScores, checkboxes, fieldInk, hourInk, fields, rectified: rect };
}

import jpeg from 'jpeg-js';
import { applyHomography, solveHomography } from '../homography.js';
import { Raster, type Rgb, boxPx, renderPrinted } from '../render.js';
import { CANONICAL_WIDTH } from '../read.js';
import { templateById } from '../templates/index.js';
import type { CellState, Point, Quad, RgbaImage, SheetTemplate, SheetVersionId } from '../types.js';
import { Rng } from './rng.js';
import { type ScheduleKind, changesOf, randomSchedule } from './schedule.js';

export interface SheetTruth {
  id: string;
  seed: number;
  version: SheetVersionId;
  scheduleKind: ScheduleKind;
  date: string;
  baseState: string;
  schemeFamily: 'standard' | 'bfm';
  twoUp: boolean;
  cells: CellState[];
  /** Field values as handwritten; null = deliberately left blank. */
  fields: Record<string, string | null>;
  checkboxes: Record<string, string[]>;
  /** Hours whose odometer / place column has handwriting. */
  hourInk: { odometer: number[]; place: number[] };
  photo: { rotationDeg: number; blurRadius: number; jpegQuality: number; lighting: number; quad: Quad };
}

export interface SyntheticSheet {
  truth: SheetTruth;
  jpeg: Uint8Array;
  width: number;
  height: number;
}

const NAMES = ['J SMITH', 'A NGUYEN', 'R KAUR', 'M OBRIEN', 'T WILLIAMS', 'S PAPADOPOULOS', 'K LEE', 'D TAYLOR'];
const INKS: Rgb[] = [
  [0.08, 0.12, 0.5],
  [0.07, 0.07, 0.09],
  [0.1, 0.15, 0.42],
];

/** A wobbly handwritten-looking scribble filling part of a box. */
function scribble(r: Raster, rng: Rng, x: number, y: number, w: number, h: number, ink: Rgb, pen: number, chars: number): void {
  const pts: Array<[number, number]> = [];
  const len = Math.min(w * 0.92, chars * h * 0.55);
  const steps = Math.max(6, Math.round(chars * 4));
  const mid = y + h * 0.55;
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    pts.push([x + w * 0.04 + len * f + rng.range(-1, 1), mid + Math.sin(f * chars * Math.PI * 1.3 + rng.range(0, 1)) * h * 0.25 + rng.range(-1.5, 1.5)]);
  }
  r.polyline(pts, pen * 0.8, ink);
}

function cross(r: Raster, b: { x: number; y: number; w: number; h: number }, ink: Rgb, pen: number, rng: Rng): void {
  const j = (): number => rng.range(-1, 1);
  r.line(b.x + b.w * 0.15 + j(), b.y + b.h * 0.15 + j(), b.x + b.w * 0.85 + j(), b.y + b.h * 0.85 + j(), pen, ink);
  r.line(b.x + b.w * 0.85 + j(), b.y + b.h * 0.15 + j(), b.x + b.w * 0.15 + j(), b.y + b.h * 0.85 + j(), pen, ink);
}

function circle(r: Raster, b: { x: number; y: number; w: number; h: number }, ink: Rgb, pen: number): void {
  const pts: Array<[number, number]> = [];
  for (let k = 0; k <= 24; k++) {
    const a = (k / 24) * Math.PI * 2;
    pts.push([b.x + b.w / 2 + Math.cos(a) * b.w * 0.55, b.y + b.h / 2 + Math.sin(a) * b.h * 0.6]);
  }
  r.polyline(pts, pen * 0.8, ink);
}

/** Draws the driver's handwriting (grid line, fields, checkboxes) onto the printed sheet. */
export function drawHandwriting(r: Raster, t: SheetTemplate, truth: SheetTruth, rng: Rng): void {
  const W = r.width;
  const H = r.height;
  const g = t.grid;
  const ink = rng.pick(INKS);
  const pen = rng.range(2.6, 4.2) * (W / 1400);
  const cw = ((g.x1 - g.x0) * W) / 96;
  const rowMid = (state: CellState): number => (state === 'work' ? (g.workTop + g.split) / 2 : (g.split + g.restBottom) / 2) * H;
  const rowH = (g.split - g.workTop) * H;

  // The continuous line through the work / rest rows, with vertical connectors at each change.
  const runs: Array<{ state: CellState; a: number; b: number }> = [];
  truth.cells.forEach((c, i) => {
    const last = runs[runs.length - 1];
    if (last && last.state === c) last.b = i + 1;
    else runs.push({ state: c, a: i, b: i + 1 });
  });
  let prevEnd: [number, number] | null = null;
  const slope = rng.range(-0.012, 0.012);
  for (const run of runs) {
    if (run.state === 'none') {
      prevEnd = null;
      continue;
    }
    const yBase = rowMid(run.state) + rng.range(-0.15, 0.15) * rowH;
    const xa = g.x0 * W + run.a * cw;
    const xb = g.x0 * W + run.b * cw;
    const pts: Array<[number, number]> = [];
    const n = Math.max(2, Math.round((xb - xa) / 12));
    for (let k = 0; k <= n; k++) {
      const x = xa + ((xb - xa) * k) / n;
      pts.push([x, yBase + (x - xa) * slope + rng.range(-0.8, 0.8)]);
    }
    if (prevEnd) r.line(prevEnd[0], prevEnd[1], pts[0]![0]!, pts[0]![1]!, pen, ink);
    r.polyline(pts, pen, ink);
    prevEnd = pts[pts.length - 1] ?? null;
  }

  for (const f of t.fields) {
    const v = truth.fields[f.id];
    if (v === null || v === undefined) continue;
    const b = boxPx(f.box, W, H);
    scribble(r, rng, b.x, b.y, b.w, b.h, ink, pen, f.kind === 'signature' ? 9 : Math.max(3, v.length));
  }
  for (const grp of t.checkboxGroups) {
    for (const value of truth.checkboxes[grp.id] ?? []) {
      const o = grp.options.find((x) => x.value === value);
      if (!o) continue;
      const b = boxPx(o.box, W, H);
      if (grp.outlined) cross(r, b, ink, pen * 0.8, rng);
      else circle(r, b, ink, pen);
    }
  }
  const a = t.activities;
  const colW = ((g.x1 - g.x0) * W) / g.hours;
  for (const h of truth.hourInk.odometer) scribble(r, rng, g.x0 * W + h * colW + colW * 0.1, a.odometerTop * H + (a.placeTop - a.odometerTop) * H * 0.3, colW * 0.8, (a.placeTop - a.odometerTop) * H * 0.4, ink, pen, 4);
  for (const h of truth.hourInk.place) {
    // place names are written vertically in the narrow hour column
    const x = g.x0 * W + h * colW + colW * 0.5;
    const pts: Array<[number, number]> = [];
    const top = a.placeTop * H + 8;
    const len = (a.twoUpTop - a.placeTop) * H * rng.range(0.4, 0.8);
    for (let k = 0; k <= 20; k++) pts.push([x + Math.sin(k * 1.7) * colW * 0.2, top + (len * k) / 20]);
    r.polyline(pts, pen * 0.8, ink);
  }
}

const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const STATES = ['QLD', 'NSW', 'VIC', 'SA', 'TAS', 'ACT'];

/** Builds the ground truth (schedule, fields, checkboxes) for a seed. */
export function makeTruth(seed: number, version: SheetVersionId, rng: Rng): SheetTruth {
  const { kind, cells } = randomSchedule(rng);
  const dayOffset = rng.int(0, 400);
  const d = new Date(Date.UTC(version === 'v1.4' ? 2026 : 2025, 7, 1 + dayOffset));
  const date = d.toISOString().slice(0, 10);
  const twoUp = rng.chance(0.25);
  const schemeFamily = rng.chance(0.2) ? 'bfm' : 'standard';
  const baseState = rng.pick(STATES);
  const fields: Record<string, string | null> = {
    driverName: rng.pick(NAMES),
    date: `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(2, 4)}`,
    licenceNo: String(rng.int(10_000_000, 99_999_999)),
    numberPlate: `${rng.pick(['XQ', 'BK', 'CV', 'DT'])}${rng.int(10, 99)}${rng.pick(['AB', 'ZZ', 'QR'])}`,
    dailyCheckTime: null,
    workDiaryNo: null,
    signature: 'signed',
    totalWork: rng.chance(0.5) ? String(cells.filter((c) => c === 'work').length / 4) : null,
    totalRest: null,
    twoUpName: twoUp ? rng.pick(NAMES) : null,
    twoUpLicenceNo: twoUp ? String(rng.int(10_000_000, 99_999_999)) : null,
    twoUpDiaryPage: twoUp ? `${rng.int(100000, 999999)}/${rng.int(1, 99)}` : null,
    twoUpSignature: twoUp ? 'signed' : null,
  };
  if (fields.totalWork) fields.totalRest = String(cells.filter((c) => c === 'rest').length / 4);
  const checkboxes: Record<string, string[]> = {
    timeZone: [baseState],
    hoursOption: schemeFamily === 'bfm' ? ['bfm'] : rng.chance(0.6) ? ['standard'] : [],
    dayOfWeek: version === 'pre-2026' || rng.chance(0.4) ? [DAYS[d.getUTCDay()] ?? 'SUN'] : [],
  };
  if (twoUp) {
    checkboxes.twoUpLicenceState = [rng.pick(STATES)];
    checkboxes.twoUpHoursOption = [schemeFamily];
  }
  const changes = changesOf(cells);
  const hours = [...new Set(changes.map((c) => Math.floor(c.cell / 4)))];
  const hourInk = { odometer: [...hours], place: [...hours] };

  // About a third of the sheets have a mandatory item left out, for the missing-field checks.
  if (rng.chance(0.33)) {
    const what = rng.pick(['driverName', 'licenceNo', 'numberPlate', 'date', 'signature', 'timeZone', 'place']);
    if (what === 'timeZone') checkboxes.timeZone = [];
    else if (what === 'place' && hours.length > 0) hourInk.place.splice(rng.int(0, hourInk.place.length - 1), 1);
    else if (what !== 'place') fields[what] = null;
  }
  return {
    id: `${version}-${String(seed).padStart(5, '0')}`,
    seed,
    version,
    scheduleKind: kind,
    date,
    baseState,
    schemeFamily,
    twoUp,
    cells,
    fields,
    checkboxes,
    hourInk,
    photo: { rotationDeg: 0, blurRadius: 0, jpegQuality: 0, lighting: 0, quad: [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }] },
  };
}

function blurChannel(data: Float32Array, w: number, h: number, c: number, r: number): void {
  if (r <= 0) return;
  const plane = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) plane[i] = data[i * 3 + c]!;
  const tmp = new Float32Array(w * h);
  const win = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let k = -r; k <= r; k++) s += plane[y * w + Math.min(w - 1, Math.max(0, x + k))]!;
      tmp[y * w + x] = s / win;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let k = -r; k <= r; k++) s += tmp[Math.min(h - 1, Math.max(0, y + k)) * w + x]!;
      data[(y * w + x) * 3 + c] = s / win;
    }
  }
}

/**
 * "Photographs" a rendered sheet: places it on a textured background with rotation (±8°), perspective skew,
 * a lighting gradient, blur and JPEG compression noise.
 */
export function photograph(sheet: Raster, rng: Rng, PW = 1600, PH = 1200): { rgba: RgbaImage; jpeg: Uint8Array; params: SheetTruth['photo'] } {
  const rot = rng.range(-8, 8);
  const th = (rot * Math.PI) / 180;
  let corners: Point[] = [];
  for (let attempt = 0; attempt < 20; attempt++) {
    const pw = PW * rng.range(0.7, 0.86) * (attempt > 10 ? 0.85 : 1);
    const ph = (pw * sheet.height) / sheet.width;
    const cx = PW / 2 + rng.range(-0.04, 0.04) * PW;
    const cy = PH / 2 + rng.range(-0.04, 0.04) * PH;
    const skew = pw * 0.035;
    corners = [
      [-pw / 2, -ph / 2],
      [pw / 2, -ph / 2],
      [pw / 2, ph / 2],
      [-pw / 2, ph / 2],
    ].map(([x, y]) => ({
      x: cx + x! * Math.cos(th) - y! * Math.sin(th) + rng.range(-skew, skew),
      y: cy + x! * Math.sin(th) + y! * Math.cos(th) + rng.range(-skew, skew),
    }));
    if (corners.every((p) => p.x > 12 && p.y > 12 && p.x < PW - 12 && p.y < PH - 12)) break;
  }
  const sheetCorners: Point[] = [
    { x: 0, y: 0 },
    { x: sheet.width, y: 0 },
    { x: sheet.width, y: sheet.height },
    { x: 0, y: sheet.height },
  ];
  const toSheet = solveHomography(corners, sheetCorners);
  const bg: Rgb = [rng.range(0.15, 0.4), rng.range(0.13, 0.35), rng.range(0.1, 0.3)];
  const lightDir = rng.range(0, Math.PI * 2);
  const lighting = rng.range(0.1, 0.32);
  const f1 = rng.range(0.004, 0.012);
  const f2 = rng.range(0.004, 0.012);
  const img = new Float32Array(PW * PH * 3);
  const px: Rgb = [0, 0, 0];
  for (let y = 0; y < PH; y++) {
    for (let x = 0; x < PW; x++) {
      const s = applyHomography(toSheet, x + 0.5, y + 0.5);
      const i = (y * PW + x) * 3;
      if (!sheet.sample(s.x, s.y, px)) {
        const tex = 0.06 * Math.sin(x * f1 + y * f2 * 0.7) + 0.04 * Math.sin(y * f1 * 1.3 - x * f2 * 0.4) + rng.range(-0.04, 0.04);
        px[0] = bg[0] + tex;
        px[1] = bg[1] + tex;
        px[2] = bg[2] + tex;
      }
      const u = ((x - PW / 2) * Math.cos(lightDir) + (y - PH / 2) * Math.sin(lightDir)) / Math.hypot(PW, PH) + 0.5;
      const light = 1 - lighting * u;
      for (let c = 0; c < 3; c++) img[i + c] = px[c]! * light;
    }
  }
  const blurRadius = rng.pick([0, 1, 1, 2]);
  for (let c = 0; c < 3; c++) blurChannel(img, PW, PH, c, blurRadius);
  const rgba = new Uint8Array(PW * PH * 4);
  for (let i = 0; i < PW * PH; i++) {
    const n = rng.range(-0.025, 0.025);
    for (let c = 0; c < 3; c++) rgba[i * 4 + c] = Math.max(0, Math.min(255, Math.round((img[i * 3 + c]! + n) * 255)));
    rgba[i * 4 + 3] = 255;
  }
  const jpegQuality = rng.int(55, 90);
  const encoded = new Uint8Array(jpeg.encode({ data: rgba, width: PW, height: PH }, jpegQuality).data);
  return { rgba: { width: PW, height: PH, data: rgba }, jpeg: encoded, params: { rotationDeg: rot, blurRadius, jpegQuality, lighting, quad: corners as Quad } };
}

/** Generates one synthetic photographed daily sheet with ground truth. Deterministic for a given seed. */
export function generateSheet(seed: number, version: SheetVersionId = seed % 2 === 0 ? 'v1.4' : 'pre-2026'): SyntheticSheet {
  const rng = new Rng(seed * 7919 + 17);
  const t = templateById(version);
  const truth = makeTruth(seed, version, rng);
  const sheet = renderPrinted(t, CANONICAL_WIDTH);
  drawHandwriting(sheet, t, truth, rng);
  const photo = photograph(sheet, rng);
  truth.photo = photo.params;
  return { truth, jpeg: photo.jpeg, width: photo.rgba.width, height: photo.rgba.height };
}

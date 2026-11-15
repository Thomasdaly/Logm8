import { makeGray } from './image.js';
import type { Box, GrayImage, SheetTemplate } from './types.js';

export type Rgb = [number, number, number];

/** Simple RGB raster (0..1 per channel) with anti-aliased drawing primitives. */
export class Raster {
  readonly data: Float32Array;
  constructor(
    readonly width: number,
    readonly height: number,
    bg: Rgb = [1, 1, 1],
  ) {
    this.data = new Float32Array(width * height * 3);
    for (let i = 0; i < width * height; i++) {
      this.data[i * 3] = bg[0];
      this.data[i * 3 + 1] = bg[1];
      this.data[i * 3 + 2] = bg[2];
    }
  }

  private blend(x: number, y: number, c: Rgb, a: number): void {
    if (a <= 0 || x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const i = (y * this.width + x) * 3;
    const k = Math.min(1, a);
    this.data[i]! += (c[0] - this.data[i]!) * k;
    this.data[i + 1]! += (c[1] - this.data[i + 1]!) * k;
    this.data[i + 2]! += (c[2] - this.data[i + 2]!) * k;
  }

  fillRect(x: number, y: number, w: number, h: number, c: Rgb, alpha = 1): void {
    const xa = Math.max(0, Math.round(x));
    const ya = Math.max(0, Math.round(y));
    const xb = Math.min(this.width, Math.round(x + w));
    const yb = Math.min(this.height, Math.round(y + h));
    for (let yy = ya; yy < yb; yy++) for (let xx = xa; xx < xb; xx++) this.blend(xx, yy, c, alpha);
  }

  /** Anti-aliased thick line segment with round caps. */
  line(x0: number, y0: number, x1: number, y1: number, width: number, c: Rgb, alpha = 1): void {
    const r = width / 2;
    const xa = Math.floor(Math.min(x0, x1) - r - 1);
    const xb = Math.ceil(Math.max(x0, x1) + r + 1);
    const ya = Math.floor(Math.min(y0, y1) - r - 1);
    const yb = Math.ceil(Math.max(y0, y1) + r + 1);
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len2 = dx * dx + dy * dy || 1e-9;
    for (let y = ya; y <= yb; y++) {
      for (let x = xa; x <= xb; x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        const t = Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / len2));
        const d = Math.hypot(px - (x0 + t * dx), py - (y0 + t * dy));
        const cov = Math.max(0, Math.min(1, r + 0.5 - d));
        if (cov > 0) this.blend(x, y, c, cov * alpha);
      }
    }
  }

  strokeRect(x: number, y: number, w: number, h: number, width: number, c: Rgb): void {
    this.line(x, y, x + w, y, width, c);
    this.line(x + w, y, x + w, y + h, width, c);
    this.line(x + w, y + h, x, y + h, width, c);
    this.line(x, y + h, x, y, width, c);
  }

  polyline(pts: Array<[number, number]>, width: number, c: Rgb, alpha = 1): void {
    for (let i = 1; i < pts.length; i++) this.line(pts[i - 1]![0]!, pts[i - 1]![1]!, pts[i]![0]!, pts[i]![1]!, width, c, alpha);
  }

  toGray(): GrayImage {
    const g = makeGray(this.width, this.height, 0);
    for (let i = 0; i < g.data.length; i++) g.data[i] = 0.299 * this.data[i * 3]! + 0.587 * this.data[i * 3 + 1]! + 0.114 * this.data[i * 3 + 2]!;
    return g;
  }

  /** Bilinear sample of the RGB value at (x, y) into `out`. Returns false outside the raster. */
  sample(x: number, y: number, out: Rgb): boolean {
    if (x < 0 || y < 0 || x > this.width - 1 || y > this.height - 1) return false;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = Math.min(x0 + 1, this.width - 1);
    const y1 = Math.min(y0 + 1, this.height - 1);
    const fx = x - x0;
    const fy = y - y0;
    for (let c = 0; c < 3; c++) {
      const a = this.data[(y0 * this.width + x0) * 3 + c]! * (1 - fx) + this.data[(y0 * this.width + x1) * 3 + c]! * fx;
      const b = this.data[(y1 * this.width + x0) * 3 + c]! * (1 - fx) + this.data[(y1 * this.width + x1) * 3 + c]! * fx;
      out[c] = a * (1 - fy) + b * fy;
    }
    return true;
  }
}

const PRINT: Rgb = [0.25, 0.25, 0.27];
const LIGHT: Rgb = [0.94, 0.94, 0.95];
const SHADE: Rgb = [0.87, 0.87, 0.88];
const BAR: Rgb = [0.55, 0.55, 0.57];
const WATERMARK: Rgb = [0.86, 0.86, 0.87];

/** Pseudo-text: a row of short dark dashes standing in for printed words. */
function pseudoText(r: Raster, x: number, y: number, chars: number, size: number, c: Rgb = PRINT): void {
  const cw = size * 0.6;
  for (let i = 0; i < chars; i++) {
    if (i % 6 === 5) continue; // word gaps
    r.fillRect(x + i * cw, y, cw * 0.7, size, c, 0.75);
  }
}

export function boxPx(b: Box, W: number, H: number): { x: number; y: number; w: number; h: number } {
  return { x: b[0] * W, y: b[1] * H, w: b[2] * W, h: b[3] * H };
}

/**
 * Draws the printed (blank) daily sheet for a template. This approximates the printed layout from the template
 * geometry: grid, shading, ticks, boxes and pseudo-text labels.
 */
export function renderPrinted(t: SheetTemplate, W: number): Raster {
  const H = Math.round(W / t.aspect);
  const r = new Raster(W, H);
  const g = t.grid;
  const a = t.activities;
  const X = (v: number): number => v * W;
  const Y = (v: number): number => v * H;
  const lw = Math.max(1, W / 700);

  // title and section bars
  pseudoText(r, X(0.28), Y(0.02), 40, Y(0.022));
  r.fillRect(X(0.012), Y(0.058), X(0.97), Y(0.02), BAR);
  r.fillRect(X(0.012), Y(0.078), X(0.97), Y(0.125), LIGHT);
  // two-up section
  r.fillRect(X(0.33), Y(0.83), X(0.65), Y(0.02), BAR);
  r.fillRect(X(0.33), Y(0.85), X(0.65), Y(0.13), LIGHT);

  for (const f of t.fields) {
    const b = boxPx(f.box, W, H);
    pseudoText(r, b.x, b.y - Y(0.02), Math.min(30, f.label.length), Y(0.012));
    if (f.id.startsWith('total') || f.id === 'workDiaryNo') continue;
    r.fillRect(b.x, b.y, b.w, b.h, [1, 1, 1]);
    r.strokeRect(b.x, b.y, b.w, b.h, lw, PRINT);
  }
  for (const grp of t.checkboxGroups) {
    for (const o of grp.options) {
      const b = boxPx(o.box, W, H);
      if (grp.outlined) {
        r.fillRect(b.x, b.y, b.w, b.h, [1, 1, 1]);
        r.strokeRect(b.x, b.y, b.w, b.h, lw, PRINT);
      }
      pseudoText(r, b.x + b.w * 0.3, b.y + b.h * 0.3, 1, b.h * 0.4);
    }
  }

  // side bar of the activities area
  r.fillRect(X(g.labelLeft), Y(a.top), X(0.028), Y(a.bottom - a.top), BAR);
  // watermark across the place / odometer area (above the work/rest grid)
  for (let i = 0; i < 38; i++) {
    const f = i / 38;
    if (i % 7 === 6) continue;
    const cx = X(0.14 + 0.72 * f);
    const cy = Y(a.placeTop + (a.twoUpTop - a.placeTop) * 0.8 - (a.twoUpTop - a.top) * 0.75 * f);
    r.line(cx, cy, cx + X(0.012), cy - Y(0.008), Y(0.02), WATERMARK);
  }

  const left = X(g.labelLeft + 0.03);
  const cellW = (X(g.x1) - X(g.x0)) / (g.hours * g.cellsPerHour);
  // shading of night hours (drawn first: the printed grid lines sit on top of it) in the work and rest rows
  for (const [h0, h1] of g.shadedHours) {
    const xa = X(g.x0) + h0 * g.cellsPerHour * cellW;
    r.fillRect(xa, Y(g.workTop) + lw, (h1 - h0) * g.cellsPerHour * cellW, Y(g.restBottom - g.workTop) - 2 * lw, SHADE);
  }
  const right = X(g.totalsRight);
  r.strokeRect(left, Y(a.top), right - left, Y(g.restBottom - a.top), lw, PRINT);
  for (const yy of [a.odometerTop, a.placeTop, a.twoUpTop]) r.line(left, Y(yy), X(g.x1), Y(yy), lw, PRINT);
  for (const yy of [a.labelsTop, g.workTop, g.split]) r.line(left, Y(yy), right, Y(yy), lw, PRINT);
  r.line(X(g.x0), Y(a.top), X(g.x0), Y(g.restBottom), lw, PRINT);
  r.line(X(g.x1), Y(a.top), X(g.x1), Y(g.restBottom), lw, PRINT);

  // hour columns in the odometer/place area
  for (let h = 1; h < g.hours; h++) {
    const x = X(g.x0) + h * g.cellsPerHour * cellW;
    r.line(x, Y(a.odometerTop), x, Y(a.twoUpTop), lw, PRINT);
  }
  // quarter-hour ticks in the two-up, work and rest rows
  const rows: Array<[number, number]> = [
    [Y(a.twoUpTop), Y(a.labelsTop)],
    [Y(g.workTop), Y(g.split)],
    [Y(g.split), Y(g.restBottom)],
  ];
  for (let q = 1; q < g.hours * g.cellsPerHour; q++) {
    const x = X(g.x0) + q * cellW;
    const hour = q % g.cellsPerHour === 0;
    for (const [y0, y1] of rows) {
      const len = (y1 - y0) * (hour ? 0.45 : 0.28);
      r.line(x, y0, x, y0 + len, lw * 0.8, PRINT);
      r.line(x, y1, x, y1 - len, lw * 0.8, PRINT);
    }
  }
  // hour numbers and row labels
  for (let h = 0; h <= g.hours; h++) {
    const x = X(g.x0) + h * g.cellsPerHour * cellW - Y(0.006);
    pseudoText(r, x, Y(a.labelsTop) + Y(0.008), h % 12 === 0 ? 3 : 1, Y(0.012));
    pseudoText(r, x, Y(g.restBottom) + Y(0.008), h % 12 === 0 ? 3 : 1, Y(0.012));
  }
  pseudoText(r, X(g.labelLeft + 0.04), Y((g.workTop + g.split) / 2) - Y(0.006), 7, Y(0.012));
  pseudoText(r, X(g.labelLeft + 0.04), Y((g.split + g.restBottom) / 2) - Y(0.006), 7, Y(0.012));
  return r;
}

const printedCache = new Map<string, GrayImage>();

/** Greyscale printed layer, cached per template and width (used as the reference for version detection). */
export function printedGray(t: SheetTemplate, W: number): GrayImage {
  const key = `${t.id}@${W}`;
  let g = printedCache.get(key);
  if (!g) {
    g = renderPrinted(t, W).toGray();
    printedCache.set(key, g);
  }
  return g;
}

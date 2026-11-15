import { boxBlur, downscale, otsu, sampleBilinear } from './image.js';
import type { GrayImage, Point, Quad } from './types.js';

interface Line {
  /** Point on the line and unit direction. */
  px: number;
  py: number;
  dx: number;
  dy: number;
}

function largestBrightComponent(img: GrayImage, t: number): { xs: Int32Array; ys: Int32Array; n: number } {
  const { width: w, height: h } = img;
  const label = new Int32Array(w * h).fill(-1);
  const queue = new Int32Array(w * h);
  let best = { start: 0, n: 0 };
  const order: number[] = [];
  let comp = 0;
  for (let i = 0; i < w * h; i++) {
    if (label[i] !== -1 || img.data[i]! <= t) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = i;
    label[i] = comp;
    const start = order.length;
    while (head < tail) {
      const p = queue[head++];
      order.push(p!);
      const x = p! % w;
      const y = (p! - x) / w;
      const nb = [x > 0 ? p! - 1 : -1, x < w - 1 ? p! + 1 : -1, y > 0 ? p! - w : -1, y < h - 1 ? p! + w : -1];
      for (const q of nb) {
        if (q >= 0 && label[q] === -1 && img.data[q]! > t) {
          label[q] = comp;
          queue[tail++] = q;
        }
      }
    }
    if (tail > best.n) best = { start, n: tail };
    comp++;
  }
  const xs = new Int32Array(best.n);
  const ys = new Int32Array(best.n);
  for (let k = 0; k < best.n; k++) {
    const p = order[best.start + k];
    xs[k] = p! % w;
    ys[k] = (p! - xs[k]!) / w;
  }
  return { xs, ys, n: best.n };
}

function fitLine(pts: Point[]): Line | null {
  if (pts.length < 2) return null;
  let mx = 0;
  let my = 0;
  for (const p of pts) {
    mx += p.x;
    my += p.y;
  }
  mx /= pts.length;
  my /= pts.length;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const p of pts) {
    sxx += (p.x - mx) ** 2;
    sxy += (p.x - mx) * (p.y - my);
    syy += (p.y - my) ** 2;
  }
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return { px: mx, py: my, dx: Math.cos(theta), dy: Math.sin(theta) };
}

function intersect(a: Line, b: Line): Point | null {
  const det = a.dx * b.dy - a.dy * b.dx;
  if (Math.abs(det) < 1e-9) return null;
  const t = ((b.px - a.px) * b.dy - (b.py - a.py) * b.dx) / det;
  return { x: a.px + t * a.dx, y: a.py + t * a.dy };
}

/**
 * Finds the four corners of the (light) sheet on a (darker) background.
 * 1. Coarse: Otsu threshold on a downscaled image, largest bright component, extreme points.
 * 2. Fine: along each side, locate the paper edge at full resolution and fit a straight line;
 *    corners are the intersections of adjacent edge lines (sub-pixel, robust to rounded/blurred corners).
 * Returns null if no plausible page is found.
 */
export function detectPage(img: GrayImage): Quad | null {
  const factor = Math.max(1, Math.round(Math.max(img.width, img.height) / 500));
  const small = boxBlur(downscale(img, factor), 1);
  const t = otsu(small);
  const comp = largestBrightComponent(small, t);
  if (comp.n < small.width * small.height * 0.12) return null;

  let tl = 0;
  let tr = 0;
  let br = 0;
  let bl = 0;
  for (let k = 1; k < comp.n; k++) {
    const s = comp.xs[k]! + comp.ys[k]!;
    const d = comp.xs[k]! - comp.ys[k]!;
    if (s < comp.xs[tl]! + comp.ys[tl]!) tl = k;
    if (s > comp.xs[br]! + comp.ys[br]!) br = k;
    if (d > comp.xs[tr]! - comp.ys[tr]!) tr = k;
    if (d < comp.xs[bl]! - comp.ys[bl]!) bl = k;
  }
  const up = (k: number): Point => ({ x: (comp.xs[k]! + 0.5) * factor, y: (comp.ys[k]! + 0.5) * factor });
  const coarse: Point[] = [up(tl), up(tr), up(br), up(bl)];

  // Refine each side by finding the bright-to-dark transition along the outward normal.
  const smooth = boxBlur(img, 1);
  const cx = coarse.reduce((s, p) => s + p.x, 0) / 4;
  const cy = coarse.reduce((s, p) => s + p.y, 0) / 4;
  const R = factor * 4 + 4;
  const lines: Line[] = [];
  for (let i = 0; i < 4; i++) {
    const a = coarse[i]!;
    const b = coarse[(i + 1) % 4]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    let nx = -(b.y - a.y) / len;
    let ny = (b.x - a.x) / len;
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    if ((mx - cx) * nx + (my - cy) * ny < 0) {
      nx = -nx;
      ny = -ny;
    }
    const pts: Point[] = [];
    const N = 40;
    for (let k = 2; k < N - 1; k++) {
      const f = k / N;
      const bx = a.x + (b.x - a.x) * f;
      const by = a.y + (b.y - a.y) * f;
      let prev = sampleBilinear(smooth, bx - nx * R, by - ny * R, 0);
      for (let s = -R + 0.5; s <= R; s += 0.5) {
        const v = sampleBilinear(smooth, bx + nx * s, by + ny * s, 0);
        if (prev > t && v <= t) {
          const frac = (prev - t) / (prev - v || 1e-9);
          const ss = s - 0.5 + 0.5 * frac;
          pts.push({ x: bx + nx * ss, y: by + ny * ss });
          break;
        }
        prev = v;
      }
    }
    let line = fitLine(pts);
    if (line) {
      // one round of outlier rejection
      const l = line;
      const inliers = pts.filter((p) => Math.abs((p.x - l.px) * l.dy - (p.y - l.py) * l.dx) < 2.5);
      line = fitLine(inliers.length >= 6 ? inliers : pts);
    }
    lines.push(line ?? { px: a.x, py: a.y, dx: (b.x - a.x) / len, dy: (b.y - a.y) / len });
  }
  const corners: Point[] = [];
  for (let i = 0; i < 4; i++) {
    // corner i is between side (i-1) and side i
    const p = intersect(lines[(i + 3) % 4]!, lines[i]!);
    const c = coarse[i]!;
    corners.push(p && Math.hypot(p.x - c.x, p.y - c.y) < R * 3 ? p : c);
  }
  return corners as Quad;
}

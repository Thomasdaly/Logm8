import jpeg from 'jpeg-js';
import type { GrayImage, RgbaImage } from './types.js';

export function makeGray(width: number, height: number, fill = 1): GrayImage {
  const data = new Float32Array(width * height);
  if (fill !== 0) data.fill(fill);
  return { width, height, data };
}

/** Luminance (Rec. 601) in 0..1. */
export function rgbaToGray(img: RgbaImage): GrayImage {
  const out = makeGray(img.width, img.height, 0);
  const d = img.data;
  for (let i = 0, p = 0; i < out.data.length; i++, p += 4) {
    out.data[i] = (0.299 * d[p]! + 0.587 * d[p + 1]! + 0.114 * d[p + 2]!) / 255;
  }
  return out;
}

/** Decodes a baseline JPEG in pure JavaScript (works in React Native, no Buffer needed). */
export function decodeJpeg(bytes: Uint8Array): RgbaImage {
  const r = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true, maxResolutionInMP: 40 });
  return { width: r.width, height: r.height, data: r.data };
}

/** Average-pools by an integer factor. */
export function downscale(img: GrayImage, factor: number): GrayImage {
  if (factor <= 1) return img;
  const w = Math.floor(img.width / factor);
  const h = Math.floor(img.height / factor);
  const out = makeGray(w, h, 0);
  const n = factor * factor;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let dy = 0; dy < factor; dy++) {
        const row = (y * factor + dy) * img.width + x * factor;
        for (let dx = 0; dx < factor; dx++) s += img.data[row + dx]!;
      }
      out.data[y * w + x] = s / n;
    }
  }
  return out;
}

/** Separable box blur with radius r (window 2r+1), edges clamped. */
export function boxBlur(img: GrayImage, r: number): GrayImage {
  if (r <= 0) return img;
  const { width: w, height: h } = img;
  const tmp = new Float32Array(w * h);
  const out = makeGray(w, h, 0);
  const win = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let s = 0;
    for (let k = -r; k <= r; k++) s += img.data[row + Math.min(w - 1, Math.max(0, k))]!;
    for (let x = 0; x < w; x++) {
      tmp[row + x] = s / win;
      s += img.data[row + Math.min(w - 1, x + r + 1)]! - img.data[row + Math.max(0, x - r)]!;
    }
  }
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let k = -r; k <= r; k++) s += tmp[Math.min(h - 1, Math.max(0, k)) * w + x]!;
    for (let y = 0; y < h; y++) {
      out.data[y * w + x] = s / win;
      s += tmp[Math.min(h - 1, y + r + 1) * w + x]! - tmp[Math.max(0, y - r) * w + x]!;
    }
  }
  return out;
}

export function sampleBilinear(img: GrayImage, x: number, y: number, outside = 0): number {
  if (x < 0 || y < 0 || x > img.width - 1 || y > img.height - 1) return outside;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, img.width - 1);
  const y1 = Math.min(y0 + 1, img.height - 1);
  const fx = x - x0;
  const fy = y - y0;
  const d = img.data;
  const w = img.width;
  const a = d[y0 * w + x0]! * (1 - fx) + d[y0 * w + x1]! * fx;
  const b = d[y1 * w + x0]! * (1 - fx) + d[y1 * w + x1]! * fx;
  return a * (1 - fy) + b * fy;
}

/** Otsu threshold on 256 bins. */
export function otsu(img: GrayImage): number {
  const hist = new Float64Array(256);
  for (let i = 0; i < img.data.length; i++) hist[Math.min(255, Math.max(0, Math.round(img.data[i]! * 255)))]!++;
  const total = img.data.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i]!;
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let thr = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]!;
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t]!;
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) {
      best = between;
      thr = t;
    }
  }
  return (thr + 0.5) / 255;
}

export function crop(img: GrayImage, x: number, y: number, w: number, h: number): GrayImage {
  const x0 = Math.max(0, Math.round(x));
  const y0 = Math.max(0, Math.round(y));
  const cw = Math.max(1, Math.min(img.width - x0, Math.round(w)));
  const ch = Math.max(1, Math.min(img.height - y0, Math.round(h)));
  const out = makeGray(cw, ch, 0);
  for (let yy = 0; yy < ch; yy++) out.data.set(img.data.subarray((y0 + yy) * img.width + x0, (y0 + yy) * img.width + x0 + cw), yy * cw);
  return out;
}

/** The q-quantile (0..1) of values in a rectangle (sampled on a stride for speed). */
export function quantileIn(img: GrayImage, x0: number, y0: number, x1: number, y1: number, q: number, stride = 1): number {
  const vals: number[] = [];
  const xa = Math.max(0, Math.floor(x0));
  const xb = Math.min(img.width, Math.ceil(x1));
  const ya = Math.max(0, Math.floor(y0));
  const yb = Math.min(img.height, Math.ceil(y1));
  for (let y = ya; y < yb; y += stride) for (let x = xa; x < xb; x += stride) vals.push(img.data[y * img.width + x]!);
  if (vals.length === 0) return 1;
  vals.sort((a, b) => a - b);
  return vals[Math.min(vals.length - 1, Math.floor(q * vals.length))]!;
}

/** Fraction of pixels in a rectangle darker than `ratio` × the local background (ink coverage). */
export function inkFraction(img: GrayImage, x0: number, y0: number, x1: number, y1: number, bg: number, ratio = 0.6): number {
  const xa = Math.max(0, Math.floor(x0));
  const xb = Math.min(img.width, Math.ceil(x1));
  const ya = Math.max(0, Math.floor(y0));
  const yb = Math.min(img.height, Math.ceil(y1));
  let n = 0;
  let dark = 0;
  const t = bg * ratio;
  for (let y = ya; y < yb; y++) {
    for (let x = xa; x < xb; x++) {
      n++;
      if (img.data[y * img.width + x]! < t) dark++;
    }
  }
  return n === 0 ? 0 : dark / n;
}

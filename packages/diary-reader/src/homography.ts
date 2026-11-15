import { makeGray, sampleBilinear } from './image.js';
import type { GrayImage, Point } from './types.js';

/** 3x3 projective transform, row-major, h[8] = 1. */
export type Homography = number[];

/** Solves the homography that maps 4 source points onto 4 destination points (DLT, Gaussian elimination). */
export function solveHomography(src: readonly Point[], dst: readonly Point[]): Homography {
  if (src.length !== 4 || dst.length !== 4) throw new Error('need 4 point pairs');
  const A: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i]!;
    const { x: u, y: v } = dst[i]!;
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  // Gaussian elimination with partial pivoting on the 8x9 augmented matrix.
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r]![c]!) > Math.abs(A[p]![c]!)) p = r;
    if (Math.abs(A[p]![c]!) < 1e-12) throw new Error('degenerate point configuration');
    [A[c], A[p]] = [A[p]!, A[c]!];
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = A[r]![c]! / A[c]![c]!;
      for (let k = c; k < 9; k++) A[r]![k]! -= f * A[c]![k]!;
    }
  }
  const h = A.map((row, i) => row[8]! / row[i]!);
  return [...h, 1];
}

export function applyHomography(h: Homography, x: number, y: number): Point {
  const w = h[6]! * x + h[7]! * y + h[8]!;
  return { x: (h[0]! * x + h[1]! * y + h[2]!) / w, y: (h[3]! * x + h[4]! * y + h[5]!) / w };
}

/**
 * Renders an output image of size outW x outH where output pixel (x, y) takes the source value at
 * applyHomography(outToSrc, x, y) (bilinear).
 */
export function warp(src: GrayImage, outToSrc: Homography, outW: number, outH: number, outside = 1): GrayImage {
  const out = makeGray(outW, outH, 0);
  const h = outToSrc;
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const w = h[6]! * x + h[7]! * y + h[8]!;
      const sx = (h[0]! * x + h[1]! * y + h[2]!) / w;
      const sy = (h[3]! * x + h[4]! * y + h[5]!) / w;
      out.data[y * outW + x] = sampleBilinear(src, sx, sy, outside);
    }
  }
  return out;
}

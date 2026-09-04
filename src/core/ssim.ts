/**
 * Structural Similarity (Wang, Bovik, Sheikh & Simoncelli, 2004).
 *
 * Used here for one job: measure how much of a composition is destroyed by the
 * downscale to a delivery box. Detail that does not survive a 1280 -> 168 -> 1280
 * round trip was never delivered to the viewer, whatever it looks like on your monitor.
 */

import type { Plane } from './types';

/** Window size and stride. Stride 4 keeps a 1280x720 comparison interactive. */
const WIN = 8;
const STRIDE = 4;

// Dynamic range is 1.0 because planes are normalised to [0,1].
const L = 1;
const C1 = (0.01 * L) ** 2;
const C2 = (0.03 * L) ** 2;

function assertSameSize(a: Plane, b: Plane): void {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(
      `ssim: dimension mismatch (${a.width}x${a.height} vs ${b.width}x${b.height})`,
    );
  }
}

/**
 * Mean SSIM over uniform WINxWIN windows at stride STRIDE. Returns [-1,1];
 * exactly 1 for identical inputs.
 *
 * Uniform rather than Gaussian windows, and strided rather than dense, because
 * this runs on every analysis pass in the browser. Both are standard variants and
 * neither changes the ordering of results — which is all we use SSIM for.
 *
 * O(width * height * WIN^2 / STRIDE^2).
 */
export function ssim(a: Plane, b: Plane): number {
  assertSameSize(a, b);
  if (a.width < WIN || a.height < WIN) return meanOnly(a, b);

  const n = WIN * WIN;
  let total = 0;
  let windows = 0;

  for (let y = 0; y + WIN <= a.height; y += STRIDE) {
    for (let x = 0; x + WIN <= a.width; x += STRIDE) {
      let sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
      for (let j = 0; j < WIN; j++) {
        const row = (y + j) * a.width + x;
        for (let i = 0; i < WIN; i++) {
          const va = a.data[row + i] ?? 0;
          const vb = b.data[row + i] ?? 0;
          sa += va; sb += vb;
          saa += va * va; sbb += vb * vb; sab += va * vb;
        }
      }
      const ma = sa / n;
      const mb = sb / n;
      // Unbiased (n-1) variance, as in the reference implementation.
      const va = (saa - n * ma * ma) / (n - 1);
      const vb = (sbb - n * mb * mb) / (n - 1);
      const cov = (sab - n * ma * mb) / (n - 1);

      const num = (2 * ma * mb + C1) * (2 * cov + C2);
      const den = (ma * ma + mb * mb + C1) * (va + vb + C2);
      total += den === 0 ? 1 : num / den;
      windows++;
    }
  }
  return windows === 0 ? meanOnly(a, b) : total / windows;
}

/** Degenerate fallback for planes smaller than one window. */
function meanOnly(a: Plane, b: Plane): number {
  let sa = 0, sb = 0;
  const n = a.width * a.height;
  if (n === 0) return 1;
  for (let i = 0; i < n; i++) { sa += a.data[i] ?? 0; sb += b.data[i] ?? 0; }
  const ma = sa / n, mb = sb / n;
  return (2 * ma * mb + C1) / (ma * ma + mb * mb + C1);
}

/** Mean squared error between two equally sized planes. */
export function mse(a: Plane, b: Plane): number {
  assertSameSize(a, b);
  const n = a.width * a.height;
  if (n === 0) return 0;
  let s = 0;
  for (let i = 0; i < n; i++) {
    const d = (a.data[i] ?? 0) - (b.data[i] ?? 0);
    s += d * d;
  }
  return s / n;
}

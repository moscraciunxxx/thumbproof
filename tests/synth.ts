/** Synthetic bitmaps for the orchestrator/repair/shelf tests. Deterministic by construction. */

import type { Bitmap } from '../src/core/types';

export function solid(w: number, h: number, rgb: [number, number, number]): Bitmap {
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    rgba[i * 4] = rgb[0];
    rgba[i * 4 + 1] = rgb[1];
    rgba[i * 4 + 2] = rgb[2];
    rgba[i * 4 + 3] = 255;
  }
  return { width: w, height: h, rgba };
}

export function fillRect(
  b: Bitmap, x: number, y: number, w: number, h: number, rgb: [number, number, number],
): Bitmap {
  for (let yy = Math.max(0, y); yy < Math.min(b.height, y + h); yy++) {
    for (let xx = Math.max(0, x); xx < Math.min(b.width, x + w); xx++) {
      const i = (yy * b.width + xx) * 4;
      b.rgba[i] = rgb[0];
      b.rgba[i + 1] = rgb[1];
      b.rgba[i + 2] = rgb[2];
      b.rgba[i + 3] = 255;
    }
  }
  return b;
}

/**
 * A blocky stand-in for a headline: `glyphs` bars of width `stroke`, height `cap`,
 * laid out on one line starting at (x,y). SWT should read stroke width ≈ `stroke`.
 */
export function textLine(
  b: Bitmap, x: number, y: number, cap: number, stroke: number, glyphs: number,
  rgb: [number, number, number],
): Bitmap {
  for (let g = 0; g < glyphs; g++) {
    const gx = x + g * (stroke * 3);
    fillRect(b, gx, y, stroke, cap, rgb);
    fillRect(b, gx, y + Math.floor(cap / 2) - Math.floor(stroke / 2), stroke * 2, stroke, rgb);
  }
  return b;
}

/** Deterministic pseudo-noise (LCG) — never Math.random, so tests are reproducible. */
export function noise(b: Bitmap, seed = 12345, amount = 40): Bitmap {
  let s = seed >>> 0;
  for (let i = 0; i < b.rgba.length; i += 4) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const d = ((s >>> 16) % (amount * 2)) - amount;
    for (let c = 0; c < 3; c++) b.rgba[i + c] = (b.rgba[i + c] ?? 0) + d;
  }
  return b;
}

/** A 1280x720 thumbnail with one big high-contrast headline. Should score well. */
export function goodThumb(): Bitmap {
  const b = solid(1280, 720, [24, 96, 200]);
  fillRect(b, 0, 0, 1280, 720, [24, 96, 200]);
  textLine(b, 90, 240, 210, 34, 5, [255, 255, 255]);
  return b;
}

/** A 1280x720 thumbnail with tiny low-contrast text. Should score badly. */
export function badThumb(): Bitmap {
  const b = solid(1280, 720, [128, 128, 128]);
  for (let row = 0; row < 5; row++) textLine(b, 80, 200 + row * 44, 22, 4, 14, [150, 150, 150]);
  return b;
}

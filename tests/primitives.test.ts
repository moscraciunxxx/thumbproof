/**
 * Direct tests for the numeric primitives.
 *
 * These are the functions every headline claim reduces to, so they are checked
 * against published constants and closed-form answers rather than against their
 * own output. A test that only asserts "the function returns what it returned
 * last time" would prove nothing here.
 */

import { describe, it, expect } from 'vitest';
import {
  srgbToLinear, linearToSrgb, toGray, resizeLanczos, resizeBox, cropRect,
  planeToBitmap, gaussianBlurPlane, resizePlaneBilinear,
} from '../src/core/image';
import { relativeLuminance, contrastRatio, otsuThreshold, localTextContrast } from '../src/core/contrast';
import { fnv1a64, fnv1a64String, perceptualHash, hammingHex } from '../src/core/hash';
import { ssim, mse } from '../src/core/ssim';
import type { Bitmap, Plane } from '../src/core/types';
import { solid, fillRect, textLine, noise } from './synth';

const plane = (w: number, h: number, fn: (x: number, y: number) => number): Plane => {
  const data = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = fn(x, y);
  return { width: w, height: h, data };
};

// ---------------------------------------------------------------- sRGB transfer

describe('sRGB transfer function (IEC 61966-2-1)', () => {
  it('anchors at the endpoints', () => {
    expect(srgbToLinear(0)).toBe(0);
    expect(srgbToLinear(1)).toBeCloseTo(1, 12);
    expect(linearToSrgb(0)).toBe(0);
    expect(linearToSrgb(1)).toBeCloseTo(1, 12);
  });

  it('round-trips across the range', () => {
    for (let i = 0; i <= 100; i++) {
      const x = i / 100;
      expect(linearToSrgb(srgbToLinear(x))).toBeCloseTo(x, 6);
    }
  });

  it('puts mid-grey near linear 0.21, which is the whole point of gamma', () => {
    const mid = srgbToLinear(0.5);
    expect(mid).toBeGreaterThan(0.2);
    expect(mid).toBeLessThan(0.22);
  });

  it('clamps out-of-range input rather than producing NaN', () => {
    expect(srgbToLinear(-1)).toBe(0);
    expect(srgbToLinear(2)).toBeCloseTo(1, 12);
    expect(Number.isNaN(linearToSrgb(-5))).toBe(false);
  });
});

// ---------------------------------------------------------------- WCAG contrast

describe('WCAG 2.1 contrast', () => {
  it('gives black on white exactly 21:1', () => {
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 6);
  });

  it('gives a colour against itself exactly 1:1', () => {
    expect(contrastRatio([123, 45, 67], [123, 45, 67])).toBeCloseTo(1, 12);
  });

  it('is symmetric', () => {
    const a: [number, number, number] = [10, 200, 90];
    const b: [number, number, number] = [240, 30, 15];
    expect(contrastRatio(a, b)).toBeCloseTo(contrastRatio(b, a), 12);
  });

  it('matches the WCAG relative-luminance coefficients at the primaries', () => {
    expect(relativeLuminance(0, 0, 0)).toBeCloseTo(0, 12);
    expect(relativeLuminance(255, 255, 255)).toBeCloseTo(1, 9);
    expect(relativeLuminance(255, 0, 0)).toBeCloseTo(0.2126, 4);
    expect(relativeLuminance(0, 255, 0)).toBeCloseTo(0.7152, 4);
    expect(relativeLuminance(0, 0, 255)).toBeCloseTo(0.0722, 4);
  });

  it('never returns below 1 or above 21', () => {
    for (const v of [0, 17, 64, 128, 200, 255]) {
      const r = contrastRatio([v, v, v], [255 - v, 255 - v, 255 - v]);
      expect(r).toBeGreaterThanOrEqual(1);
      expect(r).toBeLessThanOrEqual(21 + 1e-9);
    }
  });
});

describe('Otsu threshold', () => {
  it('separates two well-separated peaks', () => {
    const hist = new Int32Array(256);
    hist[30] = 500;
    hist[220] = 500;
    const t = otsuThreshold(hist);
    // With equal masses every threshold in [30, 219] yields the same partition, so
    // between-class variance ties across that whole span. Assert the property that
    // matters -- the two peaks land in different classes -- rather than a specific
    // tie-break, which would be testing an implementation detail.
    expect(t).toBeGreaterThanOrEqual(30);
    expect(t).toBeLessThan(220);
  });

  it('breaks ties deterministically', () => {
    const hist = new Int32Array(256);
    hist[30] = 500;
    hist[220] = 500;
    expect(otsuThreshold(hist)).toBe(otsuThreshold(hist));
  });

  it('is deterministic and in range for a flat histogram', () => {
    const hist = new Int32Array(256).fill(1);
    const t = otsuThreshold(hist);
    expect(t).toBe(otsuThreshold(hist));
    expect(t).toBeGreaterThanOrEqual(0);
    expect(t).toBeLessThanOrEqual(255);
  });
});

describe('localTextContrast', () => {
  it('reports near-maximum contrast for white glyphs on black', () => {
    const b = solid(120, 60, [0, 0, 0]);
    textLine(b, 10, 10, 40, 6, 4, [255, 255, 255]);
    expect(localTextContrast(b, { x: 10, y: 10, w: 100, h: 40 }).ratio).toBeGreaterThan(18);
  });

  it('reports a failing ratio for grey glyphs on grey', () => {
    const b = solid(120, 60, [155, 155, 155]);
    textLine(b, 10, 10, 40, 6, 4, [185, 185, 185]);
    expect(localTextContrast(b, { x: 10, y: 10, w: 100, h: 40 }).ratio).toBeLessThan(2);
  });

  it('throws when the region does not intersect the image', () => {
    expect(() => localTextContrast(solid(50, 50, [0, 0, 0]), { x: 900, y: 900, w: 10, h: 10 })).toThrow();
  });
});

// ---------------------------------------------------------------- resampling

describe('resizeLanczos', () => {
  it('preserves a constant colour exactly, proving kernel normalisation', () => {
    const out = resizeLanczos(solid(64, 36, [37, 111, 200]), 16, 9);
    for (let i = 0; i < out.rgba.length; i += 4) {
      expect(out.rgba[i]).toBe(37);
      expect(out.rgba[i + 1]).toBe(111);
      expect(out.rgba[i + 2]).toBe(200);
    }
  });

  it('produces exactly the requested dimensions', () => {
    const out = resizeLanczos(solid(128, 72, [10, 10, 10]), 168, 94);
    expect(out.width).toBe(168);
    expect(out.height).toBe(94);
    expect(out.rgba.length).toBe(168 * 94 * 4);
  });

  it('never emits NaN on a high-frequency source', () => {
    const out = resizeLanczos(noise(solid(80, 45, [128, 128, 128]), 99, 90), 23, 13);
    for (let i = 0; i < out.rgba.length; i++) expect(Number.isNaN(out.rgba[i])).toBe(false);
  });

  it('is deterministic', () => {
    const src = noise(solid(64, 36, [90, 90, 90]), 5, 50);
    expect(Array.from(resizeLanczos(src, 20, 11).rgba))
      .toEqual(Array.from(resizeLanczos(src, 20, 11).rgba));
  });

  it('keeps a sharp edge in place instead of smearing it across the frame', () => {
    const src = solid(64, 8, [0, 0, 0]);
    fillRect(src, 32, 0, 32, 8, [255, 255, 255]);
    const out = resizeLanczos(src, 32, 4);
    const row = 2 * 32 * 4;
    expect(out.rgba[row + 4 * 4]!).toBeLessThan(60);
    expect(out.rgba[row + 27 * 4]!).toBeGreaterThan(195);
  });
});

describe('resizeBox', () => {
  it('averages a 2x2 checkerboard down to its mean', () => {
    const src = solid(2, 2, [0, 0, 0]);
    fillRect(src, 0, 0, 1, 1, [255, 255, 255]);
    fillRect(src, 1, 1, 1, 1, [255, 255, 255]);
    const v = resizeBox(src, 1, 1).rgba[0]!;
    expect(v).toBeGreaterThanOrEqual(127);
    expect(v).toBeLessThanOrEqual(128);
  });

  it('preserves a constant colour', () => {
    const out = resizeBox(solid(40, 40, [7, 200, 33]), 5, 5);
    expect(out.rgba[0]).toBe(7);
    expect(out.rgba[1]).toBe(200);
    expect(out.rgba[2]).toBe(33);
  });
});

describe('cropRect', () => {
  it('extracts the requested window', () => {
    const src = solid(20, 20, [0, 0, 0]);
    fillRect(src, 5, 5, 5, 5, [255, 0, 0]);
    const out = cropRect(src, 5, 5, 5, 5);
    expect(out.width).toBe(5);
    expect(out.height).toBe(5);
    expect(out.rgba[0]).toBe(255);
    expect(out.rgba[1]).toBe(0);
  });

  it('clamps a window that runs past the edge', () => {
    const out = cropRect(solid(10, 10, [1, 2, 3]), 8, 8, 10, 10);
    expect(out.width).toBeGreaterThan(0);
    expect(out.width).toBeLessThanOrEqual(10);
    expect(out.height).toBeLessThanOrEqual(10);
  });
});

// ---------------------------------------------------------------- planes

describe('toGray and planeToBitmap', () => {
  it('maps black and white to the ends of the range', () => {
    expect(toGray(solid(4, 4, [0, 0, 0])).data[0]).toBeCloseTo(0, 5);
    expect(toGray(solid(4, 4, [255, 255, 255])).data[0]).toBeCloseTo(1, 5);
  });

  it('ranks the primaries by their luma coefficients', () => {
    const r = toGray(solid(2, 2, [255, 0, 0])).data[0]!;
    const g = toGray(solid(2, 2, [0, 255, 0])).data[0]!;
    const b = toGray(solid(2, 2, [0, 0, 255])).data[0]!;
    expect(g).toBeGreaterThan(r);
    expect(r).toBeGreaterThan(b);
  });

  it('round-trips a plane into a neutral grey bitmap', () => {
    const b = planeToBitmap(plane(8, 8, () => 0.5));
    expect(b.width).toBe(8);
    expect(b.rgba[0]).toBe(b.rgba[1]);
    expect(b.rgba[1]).toBe(b.rgba[2]);
    expect(b.rgba[3]).toBe(255);
  });
});

describe('gaussianBlurPlane', () => {
  it('preserves a constant plane', () => {
    const out = gaussianBlurPlane(plane(16, 16, () => 0.4), 2);
    for (let i = 0; i < out.data.length; i++) expect(out.data[i]).toBeCloseTo(0.4, 4);
  });

  it('lowers an impulse peak and spreads its mass to neighbours', () => {
    const out = gaussianBlurPlane(plane(21, 21, (x, y) => (x === 10 && y === 10 ? 1 : 0)), 2);
    expect(out.data[10 * 21 + 10]!).toBeLessThan(1);
    expect(out.data[10 * 21 + 11]!).toBeGreaterThan(0);
  });

  it('returns a copy rather than the same buffer when sigma is zero', () => {
    const p = plane(4, 4, () => 0.25);
    const out = gaussianBlurPlane(p, 0);
    expect(out.data).not.toBe(p.data);
    expect(Array.from(out.data)).toEqual(Array.from(p.data));
  });
});

describe('resizePlaneBilinear', () => {
  it('preserves a constant plane and hits the target size', () => {
    const out = resizePlaneBilinear(plane(32, 32, () => 0.75), 8, 8);
    expect(out.width).toBe(8);
    expect(out.height).toBe(8);
    for (let i = 0; i < out.data.length; i++) expect(out.data[i]).toBeCloseTo(0.75, 5);
  });
});

// ---------------------------------------------------------------- SSIM

describe('SSIM (Wang et al. 2004)', () => {
  const base = plane(64, 64, (x, y) => (((x >> 3) + (y >> 3)) % 2 === 0 ? 0.85 : 0.15));

  it('is exactly 1 for identical planes', () => {
    expect(ssim(base, base)).toBeCloseTo(1, 10);
  });

  it('drops meaningfully against a blurred version', () => {
    const s = ssim(base, gaussianBlurPlane(base, 3));
    expect(s).toBeLessThan(0.9);
    expect(s).toBeGreaterThan(-1);
  });

  it('is symmetric', () => {
    const blurred = gaussianBlurPlane(base, 2);
    expect(ssim(base, blurred)).toBeCloseTo(ssim(blurred, base), 10);
  });

  it('throws on mismatched dimensions rather than comparing garbage', () => {
    expect(() => ssim(base, plane(32, 32, () => 0.5))).toThrow(/mismatch/i);
  });

  it('mse is zero for identical planes and positive otherwise', () => {
    expect(mse(base, base)).toBe(0);
    expect(mse(base, plane(64, 64, () => 0.5))).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------- hashing

describe('FNV-1a 64', () => {
  it('matches the canonical vector for "hello"', () => {
    expect(fnv1a64String('hello')).toBe('a430d84680aabd0b');
  });

  it('matches the canonical offset basis for empty input', () => {
    expect(fnv1a64(new Uint8Array(0))).toBe('cbf29ce484222325');
  });

  it('always returns 16 lowercase hex characters', () => {
    for (const s of ['', 'a', 'the quick brown fox', ' ']) {
      expect(fnv1a64String(s)).toMatch(/^[0-9a-f]{16}$/);
    }
  });

  it('changes when a single byte changes', () => {
    expect(fnv1a64String('thumbproof')).not.toBe(fnv1a64String('thumbproog'));
  });
});

describe('perceptualHash and hammingHex', () => {
  const a: Bitmap = fillRect(solid(64, 36, [20, 20, 20]), 0, 0, 32, 36, [230, 230, 230]);

  it('is stable under a small uniform brightness shift', () => {
    const brighter: Bitmap = { width: a.width, height: a.height, rgba: new Uint8ClampedArray(a.rgba) };
    for (let i = 0; i < brighter.rgba.length; i += 4) {
      for (let c = 0; c < 3; c++) brighter.rgba[i + c] = (brighter.rgba[i + c] ?? 0) + 8;
    }
    expect(hammingHex(perceptualHash(a), perceptualHash(brighter))).toBeLessThanOrEqual(2);
  });

  it('differs for a genuinely different composition', () => {
    const b = fillRect(solid(64, 36, [20, 20, 20]), 0, 0, 64, 18, [230, 230, 230]);
    expect(hammingHex(perceptualHash(a), perceptualHash(b))).toBeGreaterThan(4);
  });

  it('returns 16 hex chars and distance 0 against itself', () => {
    const h = perceptualHash(a);
    expect(h).toMatch(/^[0-9a-f]{16}$/);
    expect(hammingHex(h, h)).toBe(0);
  });

  it('throws on a length mismatch instead of comparing prefixes', () => {
    expect(() => hammingHex('abcd', 'abcdef')).toThrow(/mismatch/i);
  });
});

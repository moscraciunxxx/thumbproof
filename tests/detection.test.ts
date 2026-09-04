/**
 * Tests for the two detectors and the surface table.
 *
 * The SWT tests use synthetic shapes with a KNOWN stroke width, so the transform
 * is checked against the geometry that produced it rather than against itself.
 * The surface tests pin the visual-angle arithmetic that the README and
 * docs/surfaces.md both quote, so those documents cannot drift from the code.
 */

import { describe, it, expect } from 'vitest';
import { sobel, cannyEdges, strokeWidthTransform, detectTextSWT } from '../src/core/swt';
import { fft2, spectralResidualSaliency } from '../src/core/saliency';
import {
  SURFACES, YTIMG_VARIANTS, visualAngleDeg,
  CAP_HEIGHT_FAIL_PX, CAP_HEIGHT_WARN_PX, CONTRAST_FAIL, CONTRAST_WARN,
} from '../src/core/surfaces';
import { toGray } from '../src/core/image';
import type { Plane } from '../src/core/types';
import { solid, fillRect, textLine } from './synth';

/** Physical width of a 16:9 panel, from its diagonal in inches. */
const panelWidthMm = (diagIn: number) => (diagIn * 25.4 * 16) / Math.hypot(16, 9);

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
};

// ---------------------------------------------------------------- Sobel / Canny

describe('sobel', () => {
  it('responds horizontally to a vertical edge and not vertically', () => {
    const b = solid(32, 32, [0, 0, 0]);
    fillRect(b, 16, 0, 16, 32, [255, 255, 255]);
    const s = sobel(toGray(b));
    const i = 16 * 32 + 16;
    expect(Math.abs(s.gx.data[i]!)).toBeGreaterThan(0.5);
    expect(Math.abs(s.gy.data[i]!)).toBeLessThan(0.2);
  });

  it('responds vertically to a horizontal edge', () => {
    const b = solid(32, 32, [0, 0, 0]);
    fillRect(b, 0, 16, 32, 16, [255, 255, 255]);
    const s = sobel(toGray(b));
    const i = 16 * 32 + 16;
    expect(Math.abs(s.gy.data[i]!)).toBeGreaterThan(0.5);
    expect(Math.abs(s.gx.data[i]!)).toBeLessThan(0.2);
  });

  it('is flat on a constant image', () => {
    const s = sobel(toGray(solid(16, 16, [90, 90, 90])));
    for (let i = 0; i < s.mag.data.length; i++) expect(s.mag.data[i]).toBeCloseTo(0, 5);
  });
});

describe('cannyEdges', () => {
  it('produces a binary plane', () => {
    const b = solid(48, 48, [0, 0, 0]);
    fillRect(b, 12, 12, 24, 24, [255, 255, 255]);
    const e = cannyEdges(toGray(b));
    for (let i = 0; i < e.data.length; i++) expect(e.data[i] === 0 || e.data[i] === 1).toBe(true);
  });

  it('finds edges on a rectangle boundary and none in its interior', () => {
    const b = solid(48, 48, [0, 0, 0]);
    fillRect(b, 12, 12, 24, 24, [255, 255, 255]);
    const e = cannyEdges(toGray(b));
    const interior = e.data[24 * 48 + 24];
    let boundary = 0;
    for (let x = 10; x < 38; x++) boundary += e.data[12 * 48 + x] ?? 0;
    expect(interior).toBe(0);
    expect(boundary).toBeGreaterThan(0);
  });

  it('finds no edges at all in a flat image', () => {
    const e = cannyEdges(toGray(solid(32, 32, [128, 128, 128])));
    expect(e.data.reduce((a, v) => a + v, 0)).toBe(0);
  });
});

// ---------------------------------------------------------------- SWT

/**
 * Rays are capped at MAX_RAY_FRACTION (8%) of the smaller image dimension, so a
 * canvas must be at least ~12.5x the bar width for that bar to be measurable at
 * all. Real thumbnails clear this comfortably: at the 640px working width the cap
 * is 29px, and even a very heavy display face runs ~20px of stroke there.
 */
function measureBar(imgW: number, imgH: number, barW: number): number[] {
  const b = solid(imgW, imgH, [255, 255, 255]);
  const x0 = Math.round(imgW / 2 - barW / 2);
  fillRect(b, x0, Math.round(imgH * 0.2), barW, Math.round(imgH * 0.6), [0, 0, 0]);
  const swt = strokeWidthTransform(toGray(b), true);

  const vals: number[] = [];
  for (let y = Math.round(imgH * 0.35); y < Math.round(imgH * 0.65); y++) {
    for (let x = x0; x < x0 + barW; x++) {
      const v = swt.data[y * imgW + x] ?? Infinity;
      if (Number.isFinite(v)) vals.push(v);
    }
  }
  return vals;
}

describe('strokeWidthTransform', () => {
  it('recovers the width of a known 10px bar', () => {
    const vals = measureBar(200, 150, 10);
    expect(vals.length).toBeGreaterThan(0);
    expect(median(vals)).toBeGreaterThanOrEqual(8);
    expect(median(vals)).toBeLessThanOrEqual(12);
  });

  it('recovers the width of a known 20px bar', () => {
    const vals = measureBar(400, 300, 20);
    expect(vals.length).toBeGreaterThan(0);
    expect(median(vals)).toBeGreaterThanOrEqual(17);
    expect(median(vals)).toBeLessThanOrEqual(23);
  });

  it('scales with the bar width', () => {
    expect(median(measureBar(400, 300, 20))).toBeGreaterThan(median(measureBar(400, 300, 8)));
  });

  it('declines to measure a stroke wider than the ray cap, rather than guessing', () => {
    // 8% of 60 is under the 8px floor, so maxRay is 8 and a 30px bar is
    // unmeasurable by construction. Documented limitation, pinned here.
    expect(measureBar(80, 60, 30).length).toBe(0);
  });

  it('leaves a flat image entirely unwritten', () => {
    const swt = strokeWidthTransform(toGray(solid(40, 40, [200, 200, 200])), true);
    expect([...swt.data].every((v) => !Number.isFinite(v))).toBe(true);
  });

  it('is deterministic', () => {
    const b = solid(80, 60, [255, 255, 255]);
    fillRect(b, 35, 10, 10, 40, [0, 0, 0]);
    const g = toGray(b);
    expect(Array.from(strokeWidthTransform(g, true).data))
      .toEqual(Array.from(strokeWidthTransform(g, true).data));
  });
});

describe('detectTextSWT', () => {
  it('finds a synthetic headline and measures its height about right', () => {
    const b = solid(400, 225, [10, 10, 10]);
    textLine(b, 40, 70, 60, 10, 5, [255, 255, 255]);
    const regions = detectTextSWT(b).filter((r) => r.confidence >= 0.5);
    expect(regions.length).toBeGreaterThan(0);
    const tallest = regions.reduce((a, r) => (r.capHeightPx > a.capHeightPx ? r : a), regions[0]!);
    // Drawn cap height is 60px; allow generous slack for edge/threshold effects.
    expect(tallest.capHeightPx).toBeGreaterThan(35);
    expect(tallest.capHeightPx).toBeLessThan(90);
  });

  it('rejects a solid blob, which is the failure mode that broke real thumbnails', () => {
    // A filled disc reports a stroke width equal to its own size, so the
    // height-to-stroke-width floor must throw it out.
    const b = solid(400, 225, [10, 10, 10]);
    for (let y = 0; y < 225; y++) {
      for (let x = 0; x < 400; x++) {
        if (Math.hypot(x - 200, y - 112) < 60) {
          const i = (y * 400 + x) * 4;
          b.rgba[i] = 240; b.rgba[i + 1] = 240; b.rgba[i + 2] = 240;
        }
      }
    }
    const confident = detectTextSWT(b).filter((r) => r.confidence >= 0.5);
    expect(confident.length).toBe(0);
  });

  it('returns nothing for a flat image', () => {
    expect(detectTextSWT(solid(200, 112, [60, 60, 60])).length).toBe(0);
  });

  it('returns regions inside the image bounds, largest first', () => {
    const b = solid(400, 225, [10, 10, 10]);
    textLine(b, 40, 40, 40, 8, 4, [255, 255, 255]);
    textLine(b, 40, 140, 24, 5, 6, [255, 255, 255]);
    const regions = detectTextSWT(b);
    for (const r of regions) {
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w).toBeLessThanOrEqual(400 + 1e-6);
      expect(r.y + r.h).toBeLessThanOrEqual(225 + 1e-6);
      expect(r.confidence).toBeGreaterThanOrEqual(0);
      expect(r.confidence).toBeLessThanOrEqual(1);
    }
    for (let i = 1; i < regions.length; i++) {
      expect(regions[i - 1]!.w * regions[i - 1]!.h).toBeGreaterThanOrEqual(regions[i]!.w * regions[i]!.h);
    }
  });

  it('is deterministic', () => {
    const b = solid(400, 225, [10, 10, 10]);
    textLine(b, 40, 70, 60, 10, 5, [255, 255, 255]);
    expect(JSON.stringify(detectTextSWT(b))).toBe(JSON.stringify(detectTextSWT(b)));
  });
});

// ---------------------------------------------------------------- saliency

describe('fft2', () => {
  it('round-trips a signal through forward and inverse', () => {
    const n = 16;
    const re = new Float32Array(n * n);
    const im = new Float32Array(n * n);
    for (let i = 0; i < n * n; i++) re[i] = Math.sin(i * 0.37) * 0.5 + 0.5;
    const original = Array.from(re);

    fft2(re, im, n, n, false);
    fft2(re, im, n, n, true);
    for (let i = 0; i < n * n; i++) expect(re[i]).toBeCloseTo(original[i]!, 3);
  });

  it('puts all energy of a constant field in the DC bin', () => {
    const n = 8;
    const re = new Float32Array(n * n).fill(1);
    const im = new Float32Array(n * n);
    fft2(re, im, n, n, false);
    expect(re[0]).toBeCloseTo(n * n, 3);
    expect(Math.hypot(re[1] ?? 0, im[1] ?? 0)).toBeCloseTo(0, 3);
  });

  it('rejects non-power-of-two dimensions instead of returning nonsense', () => {
    expect(() => fft2(new Float32Array(12), new Float32Array(12), 3, 4, false))
      .toThrow(/power/i);
  });
});

describe('spectralResidualSaliency (Hou & Zhang 2007)', () => {
  it('puts the peak on a lone bright blob', () => {
    const b = solid(256, 144, [20, 20, 20]);
    for (let y = 0; y < 144; y++) {
      for (let x = 0; x < 256; x++) {
        if (Math.hypot(x - 190, y - 40) < 14) {
          const i = (y * 256 + x) * 4;
          b.rgba[i] = 250; b.rgba[i + 1] = 250; b.rgba[i + 2] = 250;
        }
      }
    }
    const s = spectralResidualSaliency(b);
    expect(Math.hypot(s.peak.x - 190, s.peak.y - 40)).toBeLessThan(45);
  });

  it('returns a normalised map with a peak inside the image', () => {
    const b = solid(256, 144, [30, 90, 160]);
    fillRect(b, 30, 30, 40, 40, [250, 250, 40]);
    const s = spectralResidualSaliency(b);
    let max = 0;
    for (let i = 0; i < s.map.data.length; i++) {
      const v = s.map.data[i] ?? 0;
      expect(v).toBeGreaterThanOrEqual(0);
      max = Math.max(max, v);
    }
    // Normalised to 1 on the 64x64 working grid, then bilinearly upsampled, which
    // interpolates between samples and can sit slightly under the original peak.
    expect(max).toBeGreaterThan(0.9);
    expect(max).toBeLessThanOrEqual(1 + 1e-6);
    expect(s.peak.x).toBeGreaterThanOrEqual(0);
    expect(s.peak.x).toBeLessThanOrEqual(256);
    expect(s.peak.y).toBeGreaterThanOrEqual(0);
    expect(s.peak.y).toBeLessThanOrEqual(144);
  });

  it('is deterministic', () => {
    const b = solid(128, 72, [40, 40, 40]);
    fillRect(b, 20, 20, 30, 20, [220, 220, 220]);
    const a = spectralResidualSaliency(b);
    const c = spectralResidualSaliency(b);
    expect(a.peak).toEqual(c.peak);
    expect(Array.from(a.map.data)).toEqual(Array.from(c.map.data));
  });
});

// ---------------------------------------------------------------- surfaces

describe('SURFACES table', () => {
  it('has impression weights summing to 1', () => {
    const sum = SURFACES.reduce((a, s) => a + s.impressionShare, 0);
    expect(sum).toBeCloseTo(1, 6);
  });

  it('has unique ids and positive dimensions', () => {
    expect(new Set(SURFACES.map((s) => s.id)).size).toBe(SURFACES.length);
    for (const s of SURFACES) {
      expect(s.cssWidth).toBeGreaterThan(0);
      expect(s.cssHeight).toBeGreaterThan(0);
      expect(s.dpr).toBeGreaterThanOrEqual(1);
    }
  });

  it('keeps every surface at 16:9 within a pixel of rounding', () => {
    for (const s of SURFACES) {
      expect(s.cssWidth / s.cssHeight).toBeCloseTo(16 / 9, 1);
    }
  });

  it('keeps duration badges inside the frame', () => {
    for (const s of SURFACES) {
      const d = s.chrome.durationBadge;
      if (!d) continue;
      expect(d.rightPct + d.widthPct).toBeLessThan(1);
      expect(d.bottomPct + d.heightPct).toBeLessThan(1);
    }
  });

  it('includes the 168px suggested sidebar as the tightest surface', () => {
    const tightest = SURFACES.reduce((a, s) => (s.cssWidth < a.cssWidth ? s : a), SURFACES[0]!);
    expect(tightest.cssWidth).toBe(168);
    expect(tightest.cssHeight).toBe(94);
  });
});

describe('thresholds', () => {
  it('orders the legibility bands sensibly', () => {
    expect(CAP_HEIGHT_FAIL_PX).toBeLessThan(CAP_HEIGHT_WARN_PX);
    expect(CAP_HEIGHT_FAIL_PX).toBeGreaterThan(0);
  });

  it('uses the WCAG 2.1 SC 1.4.3 values', () => {
    expect(CONTRAST_FAIL).toBe(3.0);
    expect(CONTRAST_WARN).toBe(4.5);
  });
});

describe('YTIMG_VARIANTS', () => {
  it('lists the derivative ladder in ascending size', () => {
    for (let i = 1; i < YTIMG_VARIANTS.length; i++) {
      expect(YTIMG_VARIANTS[i]!.width).toBeGreaterThanOrEqual(YTIMG_VARIANTS[i - 1]!.width);
    }
  });

  it('includes maxresdefault at 1280x720', () => {
    const max = YTIMG_VARIANTS.find((v) => v.name === 'maxresdefault.jpg');
    expect(max).toBeDefined();
    expect(max!.width).toBe(1280);
    expect(max!.height).toBe(720);
  });
});

describe('visualAngleDeg — the arithmetic README and docs/surfaces.md quote', () => {
  it('is zero-ish for a vanishing box and grows with box size', () => {
    expect(visualAngleDeg(0, 1920, 531, 600)).toBeCloseTo(0, 9);
    expect(visualAngleDeg(400, 1920, 531, 600)).toBeGreaterThan(visualAngleDeg(168, 1920, 531, 600));
  });

  it('shrinks as viewing distance grows', () => {
    expect(visualAngleDeg(400, 1920, 1218, 3000)).toBeLessThan(visualAngleDeg(400, 1920, 1218, 1000));
  });

  it('reproduces the three published figures', () => {
    const phone = visualAngleDeg(360, 390, panelWidthMm(6.1), 350);
    const sidebar = visualAngleDeg(168, 1920, panelWidthMm(24), 600);
    const tv = visualAngleDeg(400, 1920, panelWidthMm(55), 3000);

    expect(phone).toBeCloseTo(20.19, 1);
    expect(sidebar).toBeCloseTo(4.44, 1);
    expect(tv).toBeCloseTo(4.84, 1);
  });

  it('backs the claim that the TV is angularly close to the 168px sidebar', () => {
    const sidebar = visualAngleDeg(168, 1920, panelWidthMm(24), 600);
    const tv = visualAngleDeg(400, 1920, panelWidthMm(55), 3000);
    expect(tv / sidebar).toBeGreaterThan(1.0);
    expect(tv / sidebar).toBeLessThan(1.2);
  });

  it('backs the claim that the phone is the MOST forgiving surface', () => {
    const phone = visualAngleDeg(360, 390, panelWidthMm(6.1), 350);
    const sidebar = visualAngleDeg(168, 1920, panelWidthMm(24), 600);
    const tv = visualAngleDeg(400, 1920, panelWidthMm(55), 3000);
    expect(phone).toBeGreaterThan(tv);
    expect(phone).toBeGreaterThan(sidebar);
    expect(phone / sidebar).toBeGreaterThan(4);
  });
});

// A plane helper kept at the bottom so the imports above stay tidy.
export const _unusedPlane: Plane = { width: 0, height: 0, data: new Float32Array(0) };

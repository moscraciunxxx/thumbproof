import { describe, it, expect } from 'vitest';
import { solveScrimAlpha, applyScrim, planPunchIn, repair } from '../src/core/repair';
import { contrastRatio } from '../src/core/contrast';
import { analyze } from '../src/core/analyze';
import { CONTRAST_WARN } from '../src/core/surfaces';
import type { TextRegion } from '../src/core/types';
import { solid, fillRect, textLine, badThumb } from './synth';

const fixedClock = () => 0;

describe('solveScrimAlpha', () => {
  it('finds an alpha that actually reaches the target ratio', () => {
    const fg: [number, number, number] = [255, 255, 255];
    const bg: [number, number, number] = [200, 200, 200];
    const s = solveScrimAlpha(fg, bg, 4.5);
    expect(s).not.toBeNull();
    const blended: [number, number, number] = [
      bg[0] * (1 - s!.alpha) + s!.toward * s!.alpha,
      bg[1] * (1 - s!.alpha) + s!.toward * s!.alpha,
      bg[2] * (1 - s!.alpha) + s!.toward * s!.alpha,
    ];
    expect(contrastRatio(fg, blended)).toBeGreaterThanOrEqual(4.5 - 1e-6);
  });

  it('darkens behind light text and lightens behind dark text', () => {
    expect(solveScrimAlpha([255, 255, 255], [190, 190, 190], 4.5)?.toward).toBe(0);
    expect(solveScrimAlpha([0, 0, 0], [70, 70, 70], 4.5)?.toward).toBe(255);
  });

  it('returns the minimum alpha, not just any working alpha', () => {
    const s = solveScrimAlpha([255, 255, 255], [200, 200, 200], 4.5);
    expect(s).not.toBeNull();
    const weaker = Math.max(0, s!.alpha - 0.02);
    const blended: [number, number, number] = [
      200 * (1 - weaker) + s!.toward * weaker,
      200 * (1 - weaker) + s!.toward * weaker,
      200 * (1 - weaker) + s!.toward * weaker,
    ];
    expect(contrastRatio([255, 255, 255], blended)).toBeLessThan(4.5);
  });

  it('returns null when no scrim can reach an impossible target', () => {
    // 25:1 exceeds the 21:1 maximum contrast ratio available in sRGB.
    expect(solveScrimAlpha([128, 128, 128], [128, 128, 128], 25)).toBeNull();
  });

  it('is deterministic across calls', () => {
    const a = solveScrimAlpha([255, 255, 255], [180, 180, 180], CONTRAST_WARN);
    const b = solveScrimAlpha([255, 255, 255], [180, 180, 180], CONTRAST_WARN);
    expect(a?.alpha).toBe(b?.alpha);
  });
});

describe('applyScrim', () => {
  it('does not mutate the input bitmap', () => {
    const b = solid(200, 120, [190, 190, 190]);
    fillRect(b, 20, 20, 100, 40, [255, 255, 255]);
    const before = new Uint8ClampedArray(b.rgba);
    const region: TextRegion = { x: 20, y: 20, w: 100, h: 40, strokeWidth: 6, capHeightPx: 40, confidence: 1 };
    applyScrim(b, [region]);
    expect(Array.from(b.rgba)).toEqual(Array.from(before));
  });

  it('reports no-op when the text already clears WCAG', () => {
    // White glyph bars on black: real separation, already ~21:1.
    const b = solid(200, 120, [0, 0, 0]);
    textLine(b, 20, 20, 40, 6, 4, [255, 255, 255]);
    const region: TextRegion = { x: 20, y: 20, w: 100, h: 40, strokeWidth: 6, capHeightPx: 40, confidence: 1 };
    expect(applyScrim(b, [region]).step.applied).toBe(false);
  });

  it('declines to scrim a solid block with no foreground to separate', () => {
    const b = solid(200, 120, [128, 128, 128]);
    fillRect(b, 20, 20, 100, 40, [128, 128, 128]);
    const region: TextRegion = { x: 20, y: 20, w: 100, h: 40, strokeWidth: 6, capHeightPx: 40, confidence: 1 };
    expect(applyScrim(b, [region]).step.applied).toBe(false);
  });

  it('produces a bitmap of the same dimensions', () => {
    const b = solid(200, 120, [190, 190, 190]);
    fillRect(b, 20, 20, 100, 40, [255, 255, 255]);
    const region: TextRegion = { x: 20, y: 20, w: 100, h: 40, strokeWidth: 6, capHeightPx: 40, confidence: 1 };
    const out = applyScrim(b, [region]).bitmap;
    expect(out.width).toBe(200);
    expect(out.height).toBe(120);
    expect(out.rgba.length).toBe(200 * 120 * 4);
  });
});

describe('planPunchIn', () => {
  const regions: TextRegion[] = [
    { x: 500, y: 300, w: 200, h: 80, strokeWidth: 8, capHeightPx: 80, confidence: 1 },
  ];

  it('returns a 16:9 box that stays inside the source', () => {
    const b = solid(1280, 720, [0, 0, 0]);
    const plan = planPunchIn(b, regions, { x: 600, y: 340 });
    expect(plan).not.toBeNull();
    expect(plan!.w / plan!.h).toBeCloseTo(1280 / 720, 6);
    expect(plan!.x).toBeGreaterThanOrEqual(0);
    expect(plan!.y).toBeGreaterThanOrEqual(0);
    expect(plan!.x + plan!.w).toBeLessThanOrEqual(1280 + 1e-6);
    expect(plan!.y + plan!.h).toBeLessThanOrEqual(720 + 1e-6);
  });

  it('contains every input region', () => {
    const b = solid(1280, 720, [0, 0, 0]);
    const plan = planPunchIn(b, regions, { x: 600, y: 340 })!;
    for (const r of regions) {
      expect(r.x).toBeGreaterThanOrEqual(plan.x - 1e-6);
      expect(r.y).toBeGreaterThanOrEqual(plan.y - 1e-6);
      expect(r.x + r.w).toBeLessThanOrEqual(plan.x + plan.w + 1e-6);
      expect(r.y + r.h).toBeLessThanOrEqual(plan.y + plan.h + 1e-6);
    }
  });

  it('declines to crop when the headline already fills the frame', () => {
    const b = solid(1280, 720, [0, 0, 0]);
    const wide: TextRegion[] = [
      { x: 10, y: 10, w: 1260, h: 700, strokeWidth: 20, capHeightPx: 700, confidence: 1 },
    ];
    expect(planPunchIn(b, wide, { x: 640, y: 360 })).toBeNull();
  });

  it('returns null with no regions to preserve', () => {
    expect(planPunchIn(solid(1280, 720, [0, 0, 0]), [], { x: 0, y: 0 })).toBeNull();
  });
});

describe('repair (end to end)', () => {
  it('returns a bitmap at the source dimensions and never lowers the score', () => {
    const src = badThumb();
    const before = analyze(src, fixedClock);
    const result = repair(src, before);
    expect(result.bitmap.width).toBe(src.width);
    expect(result.bitmap.height).toBe(src.height);
    const after = analyze(result.bitmap, fixedClock);
    expect(after.score).toBeGreaterThanOrEqual(before.score);
  });

  it('always explains both steps, applied or not', () => {
    const src = badThumb();
    const result = repair(src, analyze(src, fixedClock));
    expect(result.steps.map((s) => s.id).sort()).toEqual(['punch-in', 'scrim']);
    for (const s of result.steps) expect(s.detail.length).toBeGreaterThan(20);
  });

  it('is deterministic', () => {
    const a = repair(badThumb(), analyze(badThumb(), fixedClock));
    const b = repair(badThumb(), analyze(badThumb(), fixedClock));
    expect(Array.from(a.bitmap.rgba)).toEqual(Array.from(b.bitmap.rgba));
    expect(JSON.stringify(a.steps)).toBe(JSON.stringify(b.steps));
  });

  it('leaves an already-clean thumbnail alone', () => {
    const b = solid(1280, 720, [10, 10, 10]);
    textLine(b, 100, 220, 260, 40, 4, [255, 255, 255]);
    const result = repair(b, analyze(b, fixedClock));
    expect(result.steps.every((s) => !s.applied)).toBe(true);
    expect(result.crop).toBeNull();
  });
});

import { describe, it, expect } from 'vitest';
import { analyze, deliveredCapHeight, badgeRect, saliencyOnRegions, WEIGHTS } from '../src/core/analyze';
import { SURFACES } from '../src/core/surfaces';
import type { Plane, TextRegion } from '../src/core/types';
import { goodThumb, badThumb, solid } from './synth';

const fixedClock = () => 0;

describe('scoring weights', () => {
  it('sum to 100 so the score is a true percentage', () => {
    const total = Object.values(WEIGHTS).reduce((a, v) => a + v, 0);
    expect(total).toBe(100);
  });
});

describe('deliveredCapHeight', () => {
  it('scales cap height by the surface box / source width ratio', () => {
    const s = SURFACES.find((x) => x.id === 'mobile-feed');
    expect(s).toBeDefined();
    // 200px of cap height in a 1280px-wide source, delivered into an N-px box.
    const expected = 200 * (s!.cssWidth / 1280);
    expect(deliveredCapHeight(200, 1280, s!)).toBeCloseTo(expected, 10);
  });

  it('is linear in the source cap height', () => {
    const s = SURFACES[0]!;
    const a = deliveredCapHeight(100, 1280, s);
    const b = deliveredCapHeight(200, 1280, s);
    expect(b / a).toBeCloseTo(2, 10);
  });
});

describe('badgeRect', () => {
  const b = solid(1280, 720, [0, 0, 0]);

  it('lands in the bottom-right quadrant for every surface that has a badge', () => {
    for (const s of SURFACES) {
      const r = badgeRect(b, s);
      if (!r) continue;
      expect(r.x).toBeGreaterThan(1280 / 2);
      expect(r.y).toBeGreaterThan(720 / 2);
      expect(r.x + r.w).toBeLessThanOrEqual(1280 + 1e-9);
      expect(r.y + r.h).toBeLessThanOrEqual(720 + 1e-9);
      expect(r.w).toBeGreaterThan(0);
      expect(r.h).toBeGreaterThan(0);
    }
  });
});

describe('saliencyOnRegions', () => {
  const src = solid(100, 100, [0, 0, 0]);

  it('returns 1 when every unit of saliency falls inside a region', () => {
    const map: Plane = { width: 10, height: 10, data: new Float32Array(100) };
    map.data[0] = 1; // top-left cell
    const region: TextRegion = { x: 0, y: 0, w: 20, h: 20, strokeWidth: 1, capHeightPx: 20, confidence: 1 };
    expect(saliencyOnRegions(map, [region], src)).toBeCloseTo(1, 10);
  });

  it('returns 0 when saliency sits entirely outside the regions', () => {
    const map: Plane = { width: 10, height: 10, data: new Float32Array(100) };
    map.data[99] = 1; // bottom-right cell
    const region: TextRegion = { x: 0, y: 0, w: 10, h: 10, strokeWidth: 1, capHeightPx: 10, confidence: 1 };
    expect(saliencyOnRegions(map, [region], src)).toBeCloseTo(0, 10);
  });

  it('returns 0 for an all-zero map rather than NaN', () => {
    const map: Plane = { width: 4, height: 4, data: new Float32Array(16) };
    expect(saliencyOnRegions(map, [], src)).toBe(0);
  });
});

describe('analyze', () => {
  it('is deterministic — identical pixels give a bit-identical report', () => {
    const a = analyze(goodThumb(), fixedClock);
    const b = analyze(goodThumb(), fixedClock);
    expect(b.fingerprint).toBe(a.fingerprint);
    expect(b.score).toBe(a.score);
    expect(JSON.stringify(b.checks)).toBe(JSON.stringify(a.checks));
    expect(JSON.stringify(b.textRegions)).toBe(JSON.stringify(a.textRegions));
  });

  it('gives different pixels a different fingerprint', () => {
    expect(analyze(badThumb(), fixedClock).fingerprint)
      .not.toBe(analyze(goodThumb(), fixedClock).fingerprint);
  });

  it('scores a big high-contrast headline above tiny low-contrast body text', () => {
    const good = analyze(goodThumb(), fixedClock);
    const bad = analyze(badThumb(), fixedClock);
    expect(good.score).toBeGreaterThan(bad.score);
  });

  it('keeps the score inside 0..100 for a degenerate flat image', () => {
    const r = analyze(solid(1280, 720, [17, 17, 17]), fixedClock);
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
    expect(Number.isFinite(r.score)).toBe(true);
  });

  it('never emits a NaN value or penalty', () => {
    for (const r of [analyze(goodThumb(), fixedClock), analyze(badThumb(), fixedClock)]) {
      for (const c of r.checks) {
        expect(Number.isFinite(c.value), `${c.id} value`).toBe(true);
        expect(Number.isFinite(c.penalty), `${c.id} penalty`).toBe(true);
        expect(c.penalty).toBeGreaterThanOrEqual(0);
        expect(c.penalty).toBeLessThanOrEqual(c.weight + 1e-9);
      }
    }
  });

  it('emits one cap-height check per delivery surface', () => {
    const r = analyze(goodThumb(), fixedClock);
    const capChecks = r.checks.filter((c) => c.id.startsWith('cap-height:'));
    expect(capChecks.length).toBe(SURFACES.length);
    expect(new Set(capChecks.map((c) => c.surface)).size).toBe(SURFACES.length);
  });
});

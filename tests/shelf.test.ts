import { describe, it, expect } from 'vitest';
import { signature, shelfTest, palette, inkLayout } from '../src/core/shelf';
import { solid, fillRect, noise } from './synth';

describe('palette', () => {
  it('returns the fill colour for a solid image', () => {
    const p = palette(solid(64, 36, [200, 30, 40]), 6);
    const top = p[0]!;
    expect((top >> 16) & 255).toBeGreaterThan(180);
    expect((top >> 8) & 255).toBeLessThan(70);
  });

  it('is deterministic and respects the requested count', () => {
    const b = fillRect(solid(64, 36, [10, 20, 30]), 0, 0, 32, 36, [240, 200, 20]);
    expect(palette(b, 4)).toEqual(palette(b, 4));
    expect(palette(b, 4).length).toBe(4);
  });
});

describe('inkLayout', () => {
  it('sums to 1 (or 0 for a perfectly flat image)', () => {
    const busy = noise(solid(128, 72, [128, 128, 128]), 7, 60);
    const sum = inkLayout(busy).reduce((a, v) => a + v, 0);
    expect(sum).toBeCloseTo(1, 6);
  });

  it('puts the energy in the cell that holds the edge', () => {
    const b = solid(128, 72, [0, 0, 0]);
    fillRect(b, 4, 4, 24, 18, [255, 255, 255]); // top-left
    const cells = inkLayout(b);
    const topLeft = cells[0]!;
    const bottomRight = cells[cells.length - 1]!;
    expect(topLeft).toBeGreaterThan(bottomRight);
  });

  it('returns exactly 12 cells (4x3)', () => {
    expect(inkLayout(solid(128, 72, [50, 50, 50])).length).toBe(12);
  });
});

describe('shelfTest', () => {
  const makeA = () => fillRect(solid(256, 144, [20, 40, 200]), 10, 10, 100, 80, [255, 255, 255]);
  const makeB = () => fillRect(solid(256, 144, [220, 60, 20]), 140, 60, 100, 70, [10, 10, 10]);

  it('flags an identical thumbnail as maximally similar', () => {
    const r = shelfTest(signature('new', makeA()), [signature('old', makeA())]);
    expect(r.nearest!.dhashHamming).toBe(0);
    expect(r.nearest!.similarity).toBe(100);
    expect(r.distinctiveness).toBe(0);
  });

  it('scores a genuinely different thumbnail as more distinct than a clone', () => {
    const cat = [signature('old', makeA())];
    const clone = shelfTest(signature('new', makeA()), cat).distinctiveness;
    const different = shelfTest(signature('new', makeB()), cat).distinctiveness;
    expect(different).toBeGreaterThan(clone);
  });

  it('returns full distinctiveness and a prompt when the catalogue is empty', () => {
    const r = shelfTest(signature('new', makeA()), []);
    expect(r.distinctiveness).toBe(100);
    expect(r.nearest).toBeNull();
    expect(r.neighbours).toEqual([]);
  });

  it('sorts neighbours most-similar first', () => {
    const r = shelfTest(signature('new', makeA()), [
      signature('different', makeB()),
      signature('identical', makeA()),
    ]);
    expect(r.neighbours[0]!.id).toBe('identical');
    expect(r.neighbours[0]!.similarity).toBeGreaterThanOrEqual(r.neighbours[1]!.similarity);
  });

  it('keeps distinctiveness inside 0..100', () => {
    const r = shelfTest(signature('new', makeB()), [signature('a', makeA()), signature('b', makeB())]);
    expect(r.distinctiveness).toBeGreaterThanOrEqual(0);
    expect(r.distinctiveness).toBeLessThanOrEqual(100);
  });

  it('is deterministic', () => {
    const cat = [signature('old', makeA())];
    const a = shelfTest(signature('new', makeB()), cat);
    const b = shelfTest(signature('new', makeB()), cat);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

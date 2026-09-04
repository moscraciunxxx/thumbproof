/**
 * ThumbProof — the shelf test.
 *
 * A thumbnail is never seen alone. It is seen in a column of twelve, and about
 * half of those are usually your own back catalogue. The question that actually
 * predicts a click is not "is this good?" but "is this DIFFERENT from the ones
 * beside it?" Creators who nail a house style quietly destroy their own
 * distinctiveness, and no tool tells them.
 *
 * Three independent signatures, because any one of them alone is easy to fool:
 *   - dHash        : structure / composition
 *   - palette      : colour identity, the thing a scrolling eye samples first
 *   - ink layout   : WHERE the busy regions sit, on a coarse grid
 */

import type { Bitmap } from './types';
import { resizeBox, toGray } from './image';
import { perceptualHash, hammingHex } from './hash';

export interface ShelfSignature {
  id: string;
  dhash: string;
  /** 6 dominant colours as packed 0xRRGGBB, ordered by coverage. */
  palette: number[];
  /** 4x3 grid of local contrast energy, normalised to sum 1. */
  layout: number[];
}

export interface ShelfNeighbour {
  id: string;
  /** 0..100. 100 = indistinguishable at a glance. */
  similarity: number;
  dhashHamming: number;
  paletteDistance: number;
  layoutDistance: number;
}

export interface ShelfReport {
  /** 0..100. 100 = stands out completely from the catalogue. */
  distinctiveness: number;
  nearest: ShelfNeighbour | null;
  neighbours: ShelfNeighbour[];
  detail: string;
}

const GRID_X = 4;
const GRID_Y = 3;

/** Median-cut-free palette: quantise to a 4x4x4 cube and take the top cells. Deterministic. */
export function palette(b: Bitmap, count = 6): number[] {
  const bins = new Uint32Array(64);
  const sums = new Float64Array(64 * 3);
  for (let i = 0; i < b.rgba.length; i += 4) {
    const r = b.rgba[i] ?? 0, g = b.rgba[i + 1] ?? 0, bl = b.rgba[i + 2] ?? 0;
    const idx = (r >> 6) * 16 + (g >> 6) * 4 + (bl >> 6);
    bins[idx] = (bins[idx] ?? 0) + 1;
    sums[idx * 3] = (sums[idx * 3] ?? 0) + r;
    sums[idx * 3 + 1] = (sums[idx * 3 + 1] ?? 0) + g;
    sums[idx * 3 + 2] = (sums[idx * 3 + 2] ?? 0) + bl;
  }
  const order = Array.from({ length: 64 }, (_, i) => i)
    // Tie-break on index so the ordering is stable across engines.
    .sort((a, z) => (bins[z]! - bins[a]!) || (a - z))
    .slice(0, count);
  return order.map((i) => {
    const n = Math.max(1, bins[i] ?? 0);
    const r = Math.round((sums[i * 3] ?? 0) / n);
    const g = Math.round((sums[i * 3 + 1] ?? 0) / n);
    const bl = Math.round((sums[i * 3 + 2] ?? 0) / n);
    return (r << 16) | (g << 8) | bl;
  });
}

/** Local-contrast energy per grid cell — a cheap proxy for "where the busy stuff is". */
export function inkLayout(b: Bitmap): number[] {
  const small = resizeBox(b, 64, 36);
  const g = toGray(small);
  const cells = new Array<number>(GRID_X * GRID_Y).fill(0);

  for (let y = 1; y < g.height - 1; y++) {
    for (let x = 1; x < g.width - 1; x++) {
      const c = g.data[y * g.width + x] ?? 0;
      const dx = Math.abs((g.data[y * g.width + x + 1] ?? 0) - c);
      const dy = Math.abs((g.data[(y + 1) * g.width + x] ?? 0) - c);
      const cx = Math.min(GRID_X - 1, Math.floor((x / g.width) * GRID_X));
      const cy = Math.min(GRID_Y - 1, Math.floor((y / g.height) * GRID_Y));
      cells[cy * GRID_X + cx] = (cells[cy * GRID_X + cx] ?? 0) + dx + dy;
    }
  }
  const total = cells.reduce((a, v) => a + v, 0) || 1;
  return cells.map((v) => v / total);
}

export function signature(id: string, b: Bitmap): ShelfSignature {
  return { id, dhash: perceptualHash(b), palette: palette(b), layout: inkLayout(b) };
}

/** Mean nearest-colour distance between two palettes, normalised to 0..1. */
function paletteDistance(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0) return 1;
  let sum = 0;
  for (const ca of a) {
    let best = Infinity;
    for (const cb of b) {
      const dr = ((ca >> 16) & 255) - ((cb >> 16) & 255);
      const dg = ((ca >> 8) & 255) - ((cb >> 8) & 255);
      const db = (ca & 255) - (cb & 255);
      best = Math.min(best, Math.sqrt(dr * dr + dg * dg + db * db));
    }
    sum += best;
  }
  // 441.7 is the max euclidean distance in RGB (sqrt(3)*255).
  return Math.min(1, sum / a.length / 441.673);
}

/** Total-variation distance between two normalised layout histograms, 0..1. */
function layoutDistance(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < GRID_X * GRID_Y; i++) s += Math.abs((a[i] ?? 0) - (b[i] ?? 0));
  return Math.min(1, s / 2);
}

/**
 * Score the candidate against a back catalogue.
 * Similarity blends the three signals; the weights say composition and colour
 * carry a glance, and layout breaks ties.
 */
export function shelfTest(candidate: ShelfSignature, catalogue: readonly ShelfSignature[]): ShelfReport {
  if (catalogue.length === 0) {
    return {
      distinctiveness: 100, nearest: null, neighbours: [],
      detail: 'Add your last few thumbnails to see whether this one stands out beside them.',
    };
  }

  const neighbours: ShelfNeighbour[] = catalogue.map((c) => {
    const ham = hammingHex(candidate.dhash, c.dhash);
    const pd = paletteDistance(candidate.palette, c.palette);
    const ld = layoutDistance(candidate.layout, c.layout);
    // dHash over 64 bits: ~10 bits apart is already visibly different.
    const structural = 1 - Math.min(1, ham / 22);
    const similarity = 100 * (0.45 * structural + 0.35 * (1 - pd) + 0.2 * (1 - ld));
    return {
      id: c.id,
      similarity: Math.round(similarity),
      dhashHamming: ham,
      paletteDistance: Math.round(pd * 1000) / 1000,
      layoutDistance: Math.round(ld * 1000) / 1000,
    };
  }).sort((a, b) => b.similarity - a.similarity || a.id.localeCompare(b.id));

  const nearest = neighbours[0]!;
  const distinctiveness = Math.max(0, Math.min(100, Math.round(100 - nearest.similarity)));

  const detail =
    distinctiveness < 25
      ? `This is ${nearest.similarity}% the same as "${nearest.id}" — same structure (${nearest.dhashHamming}/64 bits differ), same palette. Side by side in a sidebar these read as one video, and a returning viewer will scroll past thinking they already watched it.`
      : distinctiveness < 50
        ? `Closest match is "${nearest.id}" at ${nearest.similarity}% similar. Recognisably your channel, which is good, but it needs one loud difference — colour or subject position — to win the glance.`
        : `Stands clear of the catalogue. Nearest is "${nearest.id}" at ${nearest.similarity}% similar.`;

  return { distinctiveness, nearest, neighbours, detail };
}

/**
 * ThumbProof — the competing feed.
 *
 * The shelf test asks whether your thumbnail is distinct from your OWN back
 * catalogue. This asks the harder question: your thumbnail does not appear alone or
 * only beside itself — it appears in a suggested rail beside eleven videos from
 * other channels, all of them fighting for the same glance, all of them rendered at
 * 168 px.
 *
 * So: put the candidate in that column and rank it. "Glance pull" is deliberately
 * crude and deliberately explainable — three things a peripheral glance can resolve
 * at 168 px before any reading happens:
 *
 *   - CONTRAST ENERGY : how much local contrast survives at delivered size
 *   - COLOUR PUNCH    : chroma spread, the thing that separates a thumbnail from a grey rail
 *   - ODDITY          : how far it sits from the MEAN of the column
 *
 * Oddity is the interesting term and the reason this is not just "score each one".
 * A thumbnail is not competing on being good, it is competing on being *different
 * from its neighbours* — the same bright red that wins in a muted column loses in a
 * column of bright red. Rank therefore depends on the company you keep.
 *
 * This predicts nothing about clickthrough and does not pretend to. It answers a
 * narrower question a creator cannot otherwise see: at the size these are delivered,
 * does mine stand out from the ones it will actually sit next to?
 */

import type { Bitmap } from './types';
import { resizeLanczos, toGray } from './image';
import { SURFACES } from './surfaces';
import { palette } from './shelf';

export interface FeedEntry {
  id: string;
  /** 0..100 — contrast energy surviving at delivered size. */
  contrastEnergy: number;
  /** 0..100 — chroma spread across the dominant palette. */
  colourPunch: number;
  /** 0..100 — distance from the column mean. Filled in by rankFeed. */
  oddity: number;
  /** 0..100 — the blend that decides the ranking. */
  glancePull: number;
}

export interface FeedResult {
  entries: FeedEntry[];
  /** 1-based position of the candidate in the column. */
  candidateRank: number;
  candidateId: string;
  detail: string;
}

/** The box these are actually delivered into — the tightest surface. */
function railWidth(): number {
  return SURFACES.reduce((a, s) => (s.cssWidth < a.cssWidth ? s : a), SURFACES[0]!).cssWidth;
}

/**
 * Mean absolute local gradient AFTER the downscale to rail size. Detail that does
 * not survive the downscale cannot pull a glance, so this must be measured on the
 * delivered raster, never on the source.
 */
export function contrastEnergy(b: Bitmap): number {
  const w = railWidth();
  const small = resizeLanczos(b, w, Math.round((w * b.height) / b.width));
  const g = toGray(small);
  let sum = 0;
  let n = 0;
  for (let y = 1; y < g.height - 1; y++) {
    for (let x = 1; x < g.width - 1; x++) {
      const c = g.data[y * g.width + x] ?? 0;
      sum += Math.abs((g.data[y * g.width + x + 1] ?? 0) - c)
           + Math.abs((g.data[(y + 1) * g.width + x] ?? 0) - c);
      n++;
    }
  }
  // Scaled so a typical thumbnail lands mid-range rather than near zero.
  return n === 0 ? 0 : Math.min(100, (sum / n) * 420);
}

/** Mean chroma of the dominant palette: how far from grey the thumbnail reads. */
export function colourPunch(b: Bitmap): number {
  const pal = palette(b, 6);
  if (pal.length === 0) return 0;
  let sum = 0;
  for (const c of pal) {
    const r = (c >> 16) & 255, g = (c >> 8) & 255, bl = c & 255;
    const mx = Math.max(r, g, bl), mn = Math.min(r, g, bl);
    sum += mx - mn;
  }
  return Math.min(100, (sum / pal.length / 255) * 260);
}

/** Feature vector used for the oddity term. */
function featureOf(e: { contrastEnergy: number; colourPunch: number }): [number, number] {
  return [e.contrastEnergy, e.colourPunch];
}

/**
 * Rank a column. `candidateId` must be present in `items`.
 * Deterministic: ties break on id so the order never wobbles between runs.
 */
export function rankFeed(
  items: readonly { id: string; bitmap: Bitmap }[],
  candidateId: string,
): FeedResult {
  if (items.length === 0) {
    return { entries: [], candidateRank: 0, candidateId, detail: 'Add the videos yours will sit beside.' };
  }

  const base: FeedEntry[] = items.map((it) => ({
    id: it.id,
    contrastEnergy: Math.round(contrastEnergy(it.bitmap) * 10) / 10,
    colourPunch: Math.round(colourPunch(it.bitmap) * 10) / 10,
    oddity: 0,
    glancePull: 0,
  }));

  // Column mean, then distance from it. This is what makes rank depend on company.
  const feats = base.map(featureOf);
  const mean: [number, number] = [
    feats.reduce((a, f) => a + f[0], 0) / feats.length,
    feats.reduce((a, f) => a + f[1], 0) / feats.length,
  ];
  const dists = feats.map((f) => Math.hypot(f[0] - mean[0], f[1] - mean[1]));
  const maxDist = Math.max(...dists, 1e-6);

  for (let i = 0; i < base.length; i++) {
    const e = base[i]!;
    e.oddity = Math.round(((dists[i] ?? 0) / maxDist) * 1000) / 10;
    e.glancePull = Math.round(
      (0.45 * e.contrastEnergy + 0.3 * e.colourPunch + 0.25 * e.oddity) * 10,
    ) / 10;
  }

  const sorted = [...base].sort((a, b) => b.glancePull - a.glancePull || a.id.localeCompare(b.id));
  const rank = sorted.findIndex((e) => e.id === candidateId) + 1;
  const me = sorted.find((e) => e.id === candidateId);
  const top = sorted[0]!;

  const detail = !me
    ? 'Candidate not present in the column.'
    : rank === 1
      ? `Yours pulls hardest in this column of ${sorted.length} — glance pull ${me.glancePull}, next is ${sorted[1]?.id ?? '—'} at ${sorted[1]?.glancePull ?? 0}.`
      : `Yours ranks ${rank} of ${sorted.length}. "${top.id}" pulls harder (${top.glancePull} vs your ${me.glancePull})`
        + (me.oddity < 40
          ? ` — and your oddity is only ${me.oddity}, meaning you look like the column average. Being good is not enough here; being different is what wins the glance.`
          : `, but your oddity is ${me.oddity}, so you are at least not blending in.`);

  return { entries: sorted, candidateRank: rank, candidateId, detail };
}

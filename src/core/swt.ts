/**
 * Stroke Width Transform text detection (Epshtein, Ofek & Wexler, CVPR 2010).
 *
 * "Detecting Text in Natural Scenes with Stroke Width Transform". Text is the one
 * thing in an image made of strokes of near-constant width, so if you measure the
 * width of the stroke every edge pixel belongs to, letters fall out of the noise
 * without a classifier, a font list, or a training set.
 *
 * We need WHERE text is and HOW TALL it is, not what it says — so this is the right
 * tool and OCR would be the wrong one. It is also deterministic, which is the whole
 * reason a claim like "your headline is 6.3 px tall when delivered" is worth stating.
 *
 * Thumbnail typography is adversarial for SWT: heavy outlines and drop shadows create
 * double edges that fragment a letter into pieces. Two mitigations below — running
 * both polarities and merging components into text LINES — are what make it usable on
 * real thumbnails, because a creator's headline is one object, not eleven letters.
 */

import type { Bitmap, Plane, TextRegion } from './types';
import { toGray, gaussianBlurPlane, resizeLanczos } from './image';
import { otsuThreshold } from './contrast';

/** Rays longer than this fraction of the image are not strokes. */
const MAX_RAY_FRACTION = 0.08;
/** Opposing-gradient tolerance, per the paper. */
const ANGLE_TOLERANCE = Math.PI / 6;
/** Neighbouring pixels join a component if their stroke widths are within this ratio. */
const SW_RATIO = 3.0;
/** Detection working width. Quarter of the pixels of a 1280px source, same answers. */
const WORK_WIDTH = 640;

export interface SobelResult { mag: Plane; gx: Plane; gy: Plane }

/** 3x3 Sobel. Returns gradient magnitude and both components. O(w*h). */
export function sobel(p: Plane): SobelResult {
  const { width: w, height: h } = p;
  const mag = new Float32Array(w * h);
  const gx = new Float32Array(w * h);
  const gy = new Float32Array(w * h);
  const at = (x: number, y: number) =>
    p.data[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))] ?? 0;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx =
        -at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1) +
        at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1);
      const sy =
        -at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1) +
        at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1);
      const i = y * w + x;
      gx[i] = sx; gy[i] = sy;
      mag[i] = Math.hypot(sx, sy);
    }
  }
  return {
    mag: { width: w, height: h, data: mag },
    gx: { width: w, height: h, data: gx },
    gy: { width: w, height: h, data: gy },
  };
}

/**
 * Canny edges as a 0/1 plane: Gaussian blur, Sobel, non-maximum suppression,
 * then hysteresis with an Otsu-derived high threshold so it is parameter-stable
 * across bright and dark thumbnails. Hysteresis uses an explicit stack, never
 * recursion, so a large connected edge set cannot blow the call stack. O(w*h).
 */
export function cannyEdges(p: Plane, lowRatio = 0.4, sigma = 1.2): Plane {
  const { width: w, height: h } = p;
  const s = sobel(gaussianBlurPlane(p, sigma));
  const mag = s.mag.data;

  let maxMag = 0;
  for (let i = 0; i < mag.length; i++) maxMag = Math.max(maxMag, mag[i] ?? 0);
  if (maxMag <= 0) return { width: w, height: h, data: new Float32Array(w * h) };

  // Non-maximum suppression along the quantised gradient direction.
  const thin = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const m = mag[i] ?? 0;
      if (m <= 0) continue;
      const ang = Math.atan2(s.gy.data[i] ?? 0, s.gx.data[i] ?? 0);
      const sector = (Math.round(ang / (Math.PI / 4)) + 4) % 4;
      const dx = sector === 0 ? 1 : sector === 1 ? 1 : sector === 2 ? 0 : -1;
      const dy = sector === 0 ? 0 : sector === 1 ? 1 : sector === 2 ? 1 : 1;
      const a = mag[i + dy * w + dx] ?? 0;
      const b = mag[i - dy * w - dx] ?? 0;
      if (m >= a && m >= b) thin[i] = m;
    }
  }

  const hist = new Int32Array(256);
  for (let i = 0; i < thin.length; i++) {
    const v = thin[i] ?? 0;
    if (v > 0) hist[Math.min(255, Math.round((v / maxMag) * 255))]!++;
  }
  const high = (otsuThreshold(hist) / 255) * maxMag;
  const low = high * lowRatio;

  const out = new Float32Array(w * h);
  const stack: number[] = [];
  for (let i = 0; i < thin.length; i++) {
    if ((thin[i] ?? 0) >= high) { out[i] = 1; stack.push(i); }
  }
  while (stack.length > 0) {
    const i = stack.pop()!;
    const x = i % w;
    const y = (i - x) / w;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if ((out[j] ?? 0) === 0 && (thin[j] ?? 0) >= low) { out[j] = 1; stack.push(j); }
      }
    }
  }
  return { width: w, height: h, data: out };
}

/**
 * The transform itself. From every edge pixel, cast a ray along the gradient and
 * look for an edge pixel facing roughly the opposite way; the distance between them
 * is the stroke width, written to every pixel on the ray. The documented second pass
 * then replaces each ray's pixels with the ray's median, which is what stops corners
 * and junctions from reporting a width far larger than the stroke that made them.
 *
 * Unwritten pixels are Infinity. O(edges * ray length).
 */
export function strokeWidthTransform(
  p: Plane,
  darkOnLight: boolean,
  cache?: { edges: Plane; grad: SobelResult },
): Plane {
  const { width: w, height: h } = p;
  // Edges and gradients do not depend on polarity, so the caller can compute them
  // once and hand them to both passes. That halves the cost of the whole detector.
  const edges = cache?.edges ?? cannyEdges(p);
  const s = cache?.grad ?? sobel(gaussianBlurPlane(p, 1.2));
  const out = new Float32Array(w * h).fill(Infinity);
  const maxRay = Math.max(8, Math.round(Math.min(w, h) * MAX_RAY_FRACTION));
  const cosTol = Math.cos(ANGLE_TOLERANCE);
  const rays: number[][] = [];
  const sign = darkOnLight ? 1 : -1;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if ((edges.data[i] ?? 0) === 0) continue;
      const g0x = s.gx.data[i] ?? 0;
      const g0y = s.gy.data[i] ?? 0;
      const n0 = Math.hypot(g0x, g0y);
      if (n0 < 1e-6) continue;
      const dx = (sign * g0x) / n0;
      const dy = (sign * g0y) / n0;

      const ray: number[] = [i];
      let found = -1;
      for (let step = 1; step <= maxRay; step++) {
        const cx = Math.round(x + dx * step);
        const cy = Math.round(y + dy * step);
        if (cx < 0 || cy < 0 || cx >= w || cy >= h) break;
        const j = cy * w + cx;
        if (j === ray[ray.length - 1]) continue; // rounding produced the same pixel
        ray.push(j);
        if ((edges.data[j] ?? 0) === 0) continue;

        const g1x = s.gx.data[j] ?? 0;
        const g1y = s.gy.data[j] ?? 0;
        const n1 = Math.hypot(g1x, g1y);
        if (n1 < 1e-6) break;
        // Opposing edge: the far gradient points back along the ray.
        if ((dx * -(g1x / n1) + dy * -(g1y / n1)) >= cosTol) found = j;
        break;
      }
      if (found < 0) continue;

      const fx = found % w;
      const fy = (found - fx) / w;
      const width = Math.hypot(fx - x, fy - y);
      if (width <= 0) continue;
      for (const k of ray) if (width < (out[k] ?? Infinity)) out[k] = width;
      rays.push(ray);
    }
  }

  // Second pass: median of the ray suppresses junction over-estimates.
  for (const ray of rays) {
    const vals = ray.map((k) => out[k] ?? Infinity).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
    if (vals.length === 0) continue;
    const mid = vals.length % 2 === 1
      ? vals[(vals.length - 1) / 2]!
      : ((vals[vals.length / 2 - 1]! + vals[vals.length / 2]!) / 2);
    for (const k of ray) if (mid < (out[k] ?? Infinity)) out[k] = mid;
  }

  return { width: w, height: h, data: out };
}

// ------------------------------------------------------------------ components

interface Component {
  x: number; y: number; w: number; h: number;
  pixels: number;
  meanSW: number; stdSW: number; medianSW: number;
}

/** Union-find with path compression. Deterministic given a fixed scan order. */
class DSU {
  private parent: Int32Array;
  constructor(n: number) {
    this.parent = new Int32Array(n);
    for (let i = 0; i < n; i++) this.parent[i] = i;
  }
  find(a: number): number {
    let r = a;
    while ((this.parent[r] ?? r) !== r) r = this.parent[r] ?? r;
    let c = a;
    while ((this.parent[c] ?? c) !== c) { const n = this.parent[c] ?? c; this.parent[c] = r; c = n; }
    return r;
  }
  union(a: number, b: number): void {
    const ra = this.find(a), rb = this.find(b);
    if (ra !== rb) this.parent[Math.max(ra, rb)] = Math.min(ra, rb);
  }
}

/** Group pixels whose stroke widths are within SW_RATIO, 8-connected. */
function components(swt: Plane): Component[] {
  const { width: w, height: h, data } = swt;
  const dsu = new DSU(w * h);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const a = data[i] ?? Infinity;
      if (!Number.isFinite(a)) continue;
      // Only look backwards, so each pair is considered exactly once.
      for (const [dx, dy] of [[-1, 0], [0, -1], [-1, -1], [1, -1]] as const) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        const b = data[j] ?? Infinity;
        if (!Number.isFinite(b)) continue;
        const hi = Math.max(a, b), lo = Math.min(a, b);
        if (lo > 0 && hi / lo <= SW_RATIO) dsu.union(i, j);
      }
    }
  }

  const acc = new Map<number, { x0: number; y0: number; x1: number; y1: number; n: number; sum: number; sumSq: number; vals: number[] }>();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const v = data[i] ?? Infinity;
      if (!Number.isFinite(v)) continue;
      const r = dsu.find(i);
      let e = acc.get(r);
      if (!e) { e = { x0: x, y0: y, x1: x, y1: y, n: 0, sum: 0, sumSq: 0, vals: [] }; acc.set(r, e); }
      e.x0 = Math.min(e.x0, x); e.y0 = Math.min(e.y0, y);
      e.x1 = Math.max(e.x1, x); e.y1 = Math.max(e.y1, y);
      e.n++; e.sum += v; e.sumSq += v * v; e.vals.push(v);
    }
  }

  const out: Component[] = [];
  for (const e of acc.values()) {
    const mean = e.sum / e.n;
    const variance = Math.max(0, e.sumSq / e.n - mean * mean);
    e.vals.sort((a, b) => a - b);
    out.push({
      x: e.x0, y: e.y0, w: e.x1 - e.x0 + 1, h: e.y1 - e.y0 + 1,
      pixels: e.n, meanSW: mean, stdSW: Math.sqrt(variance),
      medianSW: e.vals[Math.floor(e.vals.length / 2)] ?? mean,
    });
  }
  // Stable order regardless of Map iteration behaviour.
  out.sort((a, b) => a.y - b.y || a.x - b.x);
  return out;
}

/** The paper's letter-candidate heuristics. */
function isLetterLike(c: Component, imgW: number, imgH: number): boolean {
  if (c.pixels < 12) return false;
  if (c.meanSW <= 0) return false;
  // A stroke of constant width is the entire premise.
  if (c.stdSW / c.meanSW > 0.5) return false;
  const aspect = c.w / c.h;
  if (aspect < 0.05 || aspect > 12) return false;
  // Long thin things (borders, rules, gradients) are not glyphs.
  if (Math.hypot(c.w, c.h) / c.medianSW > 14) return false;
  // ...and neither are FAT things. This is the filter that matters most on real
  // thumbnails: a silhouette, a glow or a colour wedge reports a stroke width equal
  // to its own height, whereas a glyph is at least a couple of strokes tall.
  // Measured floors: Arial Black ~2.9, Impact ~4.0, regular weights 5-10.
  if (c.h / c.medianSW < 2.2) return false;
  // A solid rectangle is not a letter.
  if (c.pixels / (c.w * c.h) > 0.9) return false;
  if (c.h < imgH * 0.012 || c.h > imgH * 0.85) return false;
  if (c.w > imgW * 0.95) return false;
  // A glyph fills a decent share of its own box; a hollow frame does not.
  if (c.pixels / (c.w * c.h) < 0.05) return false;
  return true;
}

/**
 * Chain letter candidates into text lines. A headline is one object to a reader, so
 * it must be one region to us — otherwise cap height gets measured per letter and
 * the badge-collision check sees eleven tiny boxes instead of one word.
 */
function mergeIntoLines(letters: Component[]): Component[][] {
  const sorted = [...letters].sort((a, b) => a.x - b.x || a.y - b.y);
  const dsu = new DSU(sorted.length);

  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i]!;
    for (let j = i + 1; j < sorted.length; j++) {
      const b = sorted[j]!;
      const gap = b.x - (a.x + a.w);
      if (gap > Math.max(a.h, b.h) * 1.2) break; // sorted by x, nothing further can match
      const swRatio = Math.max(a.medianSW, b.medianSW) / Math.max(1e-6, Math.min(a.medianSW, b.medianSW));
      const hRatio = Math.max(a.h, b.h) / Math.max(1e-6, Math.min(a.h, b.h));
      const dyCenter = Math.abs((a.y + a.h / 2) - (b.y + b.h / 2));
      if (swRatio <= 2.2 && hRatio <= 2.2 && dyCenter <= Math.max(a.h, b.h) * 0.45 && gap >= -a.w) {
        dsu.union(i, j);
      }
    }
  }

  const groups = new Map<number, Component[]>();
  for (let i = 0; i < sorted.length; i++) {
    const r = dsu.find(i);
    const g = groups.get(r);
    if (g) g.push(sorted[i]!); else groups.set(r, [sorted[i]!]);
  }
  return [...groups.values()];
}

function lineToRegion(group: Component[]): TextRegion {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const c of group) {
    x0 = Math.min(x0, c.x); y0 = Math.min(y0, c.y);
    x1 = Math.max(x1, c.x + c.w); y1 = Math.max(y1, c.y + c.h);
  }
  const heights = group.map((c) => c.h).sort((a, b) => a - b);
  const sws = group.map((c) => c.medianSW).sort((a, b) => a - b);
  const medH = heights[Math.floor(heights.length / 2)] ?? (y1 - y0);
  const medSW = sws[Math.floor(sws.length / 2)] ?? 1;

  const meanH = heights.reduce((a, v) => a + v, 0) / heights.length;
  const meanSW = sws.reduce((a, v) => a + v, 0) / sws.length;
  const sdH = Math.sqrt(heights.reduce((a, v) => a + (v - meanH) ** 2, 0) / heights.length);
  const sdSW = Math.sqrt(sws.reduce((a, v) => a + (v - meanSW) ** 2, 0) / sws.length);

  const swConsistency = 1 - Math.min(1, meanSW > 0 ? sdSW / meanSW : 1);
  const sizeConsistency = 1 - Math.min(1, meanH > 0 ? sdH / meanH : 1);
  const support = Math.min(1, group.length / 2);
  const confidence = Math.max(0, Math.min(1,
    0.5 * swConsistency + 0.25 * sizeConsistency + 0.25 * support));

  return {
    x: x0, y: y0, w: x1 - x0, h: y1 - y0,
    strokeWidth: Math.round(medSW * 100) / 100,
    // Cap height is the median GLYPH height, not the line box: the box picks up
    // ascenders, descenders and punctuation across a whole word.
    capHeightPx: Math.round(medH * 100) / 100,
    confidence: Math.round(confidence * 1000) / 1000,
  };
}

/**
 * Detect text lines. Runs both polarities (light-on-dark and dark-on-light, both
 * ubiquitous in thumbnails) and keeps whichever produces the stronger evidence,
 * scored as total confident text area. Returns regions largest-first.
 */
export function detectTextSWT(b: Bitmap): TextRegion[] {
  // SWT is the expensive stage and its cost is linear in pixel count. Half the
  // width is a quarter of the work, and stroke widths at thumbnail scale are far
  // wider than one pixel, so nothing that matters is lost. Regions are scaled back
  // to source coordinates before returning, so every reported number stays in the
  // creator's own pixel space.
  const scale = b.width > WORK_WIDTH ? WORK_WIDTH / b.width : 1;
  const work = scale < 1
    ? resizeLanczos(b, Math.round(b.width * scale), Math.round(b.height * scale))
    : b;
  const gray = toGray(work);
  const up = 1 / scale;

  // Computed once, shared by both polarity passes.
  const cache = { edges: cannyEdges(gray), grad: sobel(gaussianBlurPlane(gray, 1.2)) };

  const run = (darkOnLight: boolean): TextRegion[] => {
    const swt = strokeWidthTransform(gray, darkOnLight, cache);
    const letters = components(swt).filter((c) => isLetterLike(c, work.width, work.height));
    if (letters.length === 0) return [];
    return mergeIntoLines(letters)
      .map(lineToRegion)
      .map((r) => (scale === 1 ? r : {
        ...r,
        x: r.x * up, y: r.y * up, w: r.w * up, h: r.h * up,
        strokeWidth: Math.round(r.strokeWidth * up * 100) / 100,
        capHeightPx: Math.round(r.capHeightPx * up * 100) / 100,
      }))
      .filter((r) => r.w > 0 && r.h > 0);
  };

  const score = (rs: TextRegion[]) => rs.reduce((a, r) => a + r.w * r.h * r.confidence, 0);
  const dark = run(true);
  const light = run(false);
  const chosen = score(light) > score(dark) ? light : dark;

  return chosen.sort((a, b2) => b2.w * b2.h - a.w * a.h || a.x - b2.x || a.y - b2.y);
}

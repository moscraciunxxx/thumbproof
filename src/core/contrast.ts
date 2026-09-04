/**
 * ThumbProof — WCAG 2.1 contrast measurement.
 *
 * Implements the contrast definitions from WCAG 2.1 Success Criterion 1.4.3
 * (https://www.w3.org/TR/WCAG21/#dfn-relative-luminance and #dfn-contrast-ratio)
 * verbatim, including WCAG's 0.03928 transfer-function knee — which differs by
 * ~3e-4 from the IEC 61966-2-1 value of 0.04045 used in `image.ts`. That
 * discrepancy is a known erratum in the spec text; we reproduce WCAG's numbers
 * here because these values are the ones a creator will be held to, and we
 * reproduce IEC's in `image.ts` because that is the real display pipeline.
 */

import type { Bitmap } from './types';

/**
 * WCAG 2.1 relative luminance. Channels are 0..255 and are clamped.
 * Returns 0 for black, exactly 1 for white. O(1).
 */
export function relativeLuminance(r: number, g: number, b: number): number {
  return 0.2126 * wcagChannel(r) + 0.7152 * wcagChannel(g) + 0.0722 * wcagChannel(b);
}

function wcagChannel(v: number): number {
  const c = (v < 0 ? 0 : v > 255 ? 255 : v) / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/**
 * WCAG 2.1 contrast ratio `(L_lighter + 0.05) / (L_darker + 0.05)`.
 * Returns a value in [1, 21]; black vs white is exactly 21. O(1).
 */
export function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
  const la = relativeLuminance(a[0], a[1], a[2]);
  const lb = relativeLuminance(b[0], b[1], b[2]);
  const hi = la > lb ? la : lb;
  const lo = la > lb ? lb : la;
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Otsu's method (Otsu 1979) on a 256-bin histogram: returns the bin index `t`
 * such that splitting into [0,t] / [t+1,255] maximises between-class variance.
 * Ties resolve to the lowest qualifying `t`, which makes the result
 * order-independent. Returns -1 when the histogram has fewer than two occupied
 * bins (no meaningful split). O(256).
 *
 * Exported because `swt.ts` thresholds gradient magnitude with the same routine.
 */
export function otsuThreshold(hist: ArrayLike<number>): number {
  let total = 0;
  let sumAll = 0;
  let occupied = 0;
  for (let i = 0; i < 256; i++) {
    const c = hist[i] ?? 0;
    if (c > 0) occupied++;
    total += c;
    sumAll += i * c;
  }
  if (total === 0 || occupied < 2) return -1;

  let wB = 0;
  let sumB = 0;
  let best = -1;
  let bestVar = -1;
  for (let t = 0; t < 256; t++) {
    wB += hist[t] ?? 0;
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * (hist[t] ?? 0);
    const mB = sumB / wB;
    const mF = (sumAll - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > bestVar) {
      bestVar = between;
      best = t;
    }
  }
  return best;
}

/** Perceptual grey byte (0..255) matching `toGray`'s definition, without allocating a Plane. */
function grayByte(r: number, g: number, b: number): number {
  const lin =
    0.2126 * srgbLin(r / 255) + 0.7152 * srgbLin(g / 255) + 0.0722 * srgbLin(b / 255);
  const enc = lin <= 0.0031308 ? lin * 12.92 : 1.055 * Math.pow(lin, 1 / 2.4) - 0.055;
  const v = Math.round(enc * 255);
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

function srgbLin(c: number): number {
  const x = c < 0 ? 0 : c > 1 ? 1 : c;
  return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
}

/** Marginal (per-channel) median. Even counts take the lower middle element, so the result is a real observed level. */
function medianColor(vals: number[][], n: number): [number, number, number] {
  const pick = (ch: number): number => {
    const col = new Array<number>(n);
    for (let i = 0; i < n; i++) col[i] = vals[ch]![i]!;
    col.sort((p, q) => p - q);
    return col[(n - 1) >> 1]!;
  };
  return [pick(0), pick(1), pick(2)];
}

/**
 * Measure the real foreground/background contrast of a text box.
 *
 * Pixels inside `region` are split into two clusters by an Otsu threshold on
 * perceptual luma (`toGray`'s definition, quantised to 256 bins). The
 * FOREGROUND is defined as the MINORITY cluster — glyph strokes always occupy
 * less of a text box than the background does — with a darker-wins tie-break.
 * Each cluster is summarised by its per-channel MEDIAN, not its mean, so a
 * handful of outlier pixels (a stray highlight, JPEG ringing, an anti-aliased
 * rim) cannot move the reported number.
 *
 * Degenerate regions (a single occupied luma bin, or an empty cluster) return
 * a ratio of exactly 1 with both colours set to the region median.
 *
 * O(region.w * region.h + k log k) where k is the larger cluster size.
 */
export function localTextContrast(
  b: Bitmap,
  region: { x: number; y: number; w: number; h: number },
): { ratio: number; fg: [number, number, number]; bg: [number, number, number] } {
  const x0 = Math.max(0, Math.floor(region.x));
  const y0 = Math.max(0, Math.floor(region.y));
  const x1 = Math.min(b.width, Math.floor(region.x) + Math.floor(region.w));
  const y1 = Math.min(b.height, Math.floor(region.y) + Math.floor(region.h));
  if (x1 <= x0 || y1 <= y0) {
    throw new Error(
      `localTextContrast: region (${region.x},${region.y},${region.w},${region.h}) does not intersect the ${b.width}x${b.height} image`,
    );
  }

  const n = (x1 - x0) * (y1 - y0);
  const hist = new Int32Array(256);
  const lum = new Uint8Array(n);
  const rs = new Array<number>(n);
  const gs = new Array<number>(n);
  const bs = new Array<number>(n);

  let k = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const o = (y * b.width + x) * 4;
      const r = b.rgba[o]!;
      const g = b.rgba[o + 1]!;
      const bl = b.rgba[o + 2]!;
      const gy = grayByte(r, g, bl);
      lum[k] = gy;
      hist[gy] = hist[gy]! + 1;
      rs[k] = r;
      gs[k] = g;
      bs[k] = bl;
      k++;
    }
  }

  const t = otsuThreshold(hist);
  const all = medianColor([rs, gs, bs], n);
  if (t < 0) return { ratio: 1, fg: all, bg: all };

  // Cluster A = luma <= t (darker), cluster B = luma > t (lighter).
  const aR: number[] = [];
  const aG: number[] = [];
  const aB: number[] = [];
  const bR: number[] = [];
  const bG: number[] = [];
  const bB: number[] = [];
  for (let i = 0; i < n; i++) {
    if (lum[i]! <= t) {
      aR.push(rs[i]!);
      aG.push(gs[i]!);
      aB.push(bs[i]!);
    } else {
      bR.push(rs[i]!);
      bG.push(gs[i]!);
      bB.push(bs[i]!);
    }
  }
  if (aR.length === 0 || bR.length === 0) return { ratio: 1, fg: all, bg: all };

  const darkMed = medianColor([aR, aG, aB], aR.length);
  const lightMed = medianColor([bR, bG, bB], bR.length);

  // Foreground = minority cluster; on an exact tie the darker cluster is foreground.
  const darkIsFg = aR.length < bR.length || (aR.length === bR.length);
  const fg = darkIsFg ? darkMed : lightMed;
  const bg = darkIsFg ? lightMed : darkMed;
  return { ratio: contrastRatio(fg, bg), fg, bg };
}

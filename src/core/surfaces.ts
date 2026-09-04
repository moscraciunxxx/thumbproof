import type { Surface } from './types';

/**
 * Delivery surfaces and thresholds. Every value is sourced in docs/surfaces.md,
 * and anything not sourced is marked ESTIMATE here and there.
 *
 * Read docs/surfaces.md before changing a number in this file. The whole product
 * rests on these being defensible, and a wrong one is worse than a missing one.
 */

/**
 * `cssWidth`/`cssHeight` are the CSS px box the thumbnail occupies. That — not
 * cssWidth * dpr — is what an eye resolves; device pixel ratio only buys back
 * sharpness within the same angular size.
 *
 * `impressionShare` is a WEIGHTING, not a measured statistic. YouTube publishes
 * watch time by device, never thumbnail impressions by surface, so this is a
 * documented proxy. It is why the score is a weighted blend rather than a single
 * surface's verdict. See docs/surfaces.md § 4. ESTIMATE.
 */
export const SURFACES: readonly Surface[] = [
  {
    // Modern YouTube mobile home feed is full-bleed: the card spans the viewport.
    // 360x202 is a 360px-wide viewport, the common Android baseline. Confidence: medium.
    id: 'mobile-feed',
    label: 'Mobile home feed',
    cssWidth: 360,
    cssHeight: 202,
    dpr: 3,
    impressionShare: 0.32, // ESTIMATE — see docs/surfaces.md § 4
    background: 'dark',
    chrome: {
      durationBadge: { rightPct: 0.02, bottomPct: 0.03, widthPct: 0.115, heightPct: 0.10 },
      progressBar: { heightPct: 0.02 },
      cornerRadiusPct: 0.055,
    },
  },
  {
    // Connected TV is now the largest US watch surface (~60% of US watch time).
    // 400x225 in a 1920-wide TV UI. Angularly this is NOT large: at a 3 m viewing
    // distance it subtends about the same visual angle as the 168 px desktop
    // sidebar at desk distance. Arithmetic in docs/surfaces.md § 3. Confidence: medium.
    id: 'tv',
    label: 'TV, at 3 m',
    cssWidth: 400,
    cssHeight: 225,
    dpr: 1,
    impressionShare: 0.24, // ESTIMATE — see docs/surfaces.md § 4
    background: 'dark',
    chrome: {
      durationBadge: { rightPct: 0.03, bottomPct: 0.04, widthPct: 0.13, heightPct: 0.10 },
      cornerRadiusPct: 0.03,
    },
  },
  {
    // The smallest box YouTube delivers a thumbnail into, and the one creators
    // never check. Desktop watch-page "up next" rail. Confidence: high.
    id: 'desktop-sidebar',
    label: 'Desktop suggested sidebar',
    cssWidth: 168,
    cssHeight: 94,
    dpr: 2,
    impressionShare: 0.20, // ESTIMATE — see docs/surfaces.md § 4
    background: 'dark',
    chrome: {
      durationBadge: { rightPct: 0.03, bottomPct: 0.05, widthPct: 0.26, heightPct: 0.17 },
      progressBar: { heightPct: 0.04 },
      cornerRadiusPct: 0.085,
    },
  },
  {
    // Mobile search uses a compact list row, materially smaller than the feed card.
    // ESTIMATE — measured from a 390 px viewport, not documented by YouTube.
    id: 'mobile-search',
    label: 'Mobile search result',
    cssWidth: 168,
    cssHeight: 94,
    dpr: 3,
    impressionShare: 0.12, // ESTIMATE — see docs/surfaces.md § 4
    background: 'dark',
    chrome: {
      durationBadge: { rightPct: 0.03, bottomPct: 0.05, widthPct: 0.26, heightPct: 0.17 },
      cornerRadiusPct: 0.085,
    },
  },
  {
    // Desktop home grid at ~1920 px, four columns with gutters. Responsive: the
    // real range is roughly 210-360 px. Confidence: medium.
    id: 'desktop-grid',
    label: 'Desktop home grid',
    cssWidth: 360,
    cssHeight: 202,
    dpr: 2,
    impressionShare: 0.12, // ESTIMATE — see docs/surfaces.md § 4
    background: 'dark',
    chrome: {
      durationBadge: { rightPct: 0.02, bottomPct: 0.03, widthPct: 0.115, heightPct: 0.10 },
      progressBar: { heightPct: 0.02 },
      cornerRadiusPct: 0.055,
    },
  },
];

/**
 * Minimum cap height for reliable reading, in DELIVERED px.
 *
 * Grounded in the standard typographic floor for screen reading rather than in
 * any YouTube-specific study, because no such study is public. A 9 px cap height
 * is roughly a 12-13 px font size, the usual lower bound for sustained screen
 * reading; below ~7 px glyph discrimination collapses at normal viewing distance
 * regardless of contrast. docs/surfaces.md § 6. Confidence: medium.
 */
export const CAP_HEIGHT_FAIL_PX = 7;
export const CAP_HEIGHT_WARN_PX = 11;

/**
 * WCAG 2.1 SC 1.4.3 (Contrast Minimum): 4.5:1 for normal text, 3:1 for large text
 * (>= 18.66 px bold or >= 24 px regular). Thumbnail headlines are large text, so
 * 3:1 is the conformance floor and 4.5:1 is the target we hold them to.
 * https://www.w3.org/TR/WCAG21/#contrast-minimum  Confidence: high.
 */
export const CONTRAST_FAIL = 3.0;
export const CONTRAST_WARN = 4.5;

/**
 * The rasters YouTube actually generates and serves from i.ytimg.com. Note that
 * three of them are 4:3 and letterbox a 16:9 upload. Confidence: high.
 */
export const YTIMG_VARIANTS: readonly { name: string; width: number; height: number }[] = [
  { name: 'default.jpg', width: 120, height: 90 },
  { name: 'mqdefault.jpg', width: 320, height: 180 },
  { name: 'hqdefault.jpg', width: 480, height: 360 },
  { name: 'sddefault.jpg', width: 640, height: 480 },
  { name: 'hq720.jpg', width: 1280, height: 720 },
  { name: 'maxresdefault.jpg', width: 1280, height: 720 },
];

/**
 * Visual angle subtended by a thumbnail, in degrees — the honest way to compare a
 * TV at 3 m against a monitor at 0.6 m. Two thumbnails with the same angular size
 * present the same legibility problem no matter how many pixels each one has.
 *
 * `boxPx` is the thumbnail width in device px, `screenPx` the screen width in
 * device px, `screenWidthMm` its physical width, `distanceMm` the viewing distance.
 */
export function visualAngleDeg(
  boxPx: number, screenPx: number, screenWidthMm: number, distanceMm: number,
): number {
  const widthMm = (boxPx / screenPx) * screenWidthMm;
  return (2 * Math.atan(widthMm / 2 / distanceMm) * 180) / Math.PI;
}

/**
 * ThumbProof — shared contract.
 *
 * Every value this tool shows a creator is a MEASUREMENT, not an opinion.
 * That means: pure functions, no network, no model weights, no randomness.
 * Given the same pixels you get the same numbers, on any machine, forever.
 */

/** Raw pixels. `rgba.length === width * height * 4`, non-premultiplied, sRGB. */
export interface Bitmap {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8ClampedArray;
}

/** Single-channel float plane, values in [0,1] unless stated otherwise. */
export interface Plane {
  readonly width: number;
  readonly height: number;
  readonly data: Float32Array;
}

export type SurfaceId =
  | 'mobile-feed'
  | 'mobile-search'
  | 'desktop-grid'
  | 'desktop-sidebar'
  | 'tv';

/** Chrome YouTube stamps ON TOP of the creator's artwork, as fractions of the box. */
export interface ChromeSpec {
  /** Duration pill, anchored bottom-right. */
  durationBadge?: { rightPct: number; bottomPct: number; widthPct: number; heightPct: number };
  /** Red watched-progress bar along the bottom edge. */
  progressBar?: { heightPct: number };
  cornerRadiusPct?: number;
}

/**
 * A place a thumbnail is actually delivered. `cssWidth`/`cssHeight` are the CSS px
 * of the thumbnail box; `dpr` is the typical device pixel ratio there. The pixels a
 * human eye resolves is cssWidth (NOT cssWidth*dpr) — dpr only buys back sharpness.
 */
export interface Surface {
  readonly id: SurfaceId;
  readonly label: string;
  readonly cssWidth: number;
  readonly cssHeight: number;
  readonly dpr: number;
  /** Approximate share of impressions. Must sum to ~1 across surfaces. Sourced in docs/surfaces.md. */
  readonly impressionShare: number;
  readonly background: 'dark' | 'light';
  readonly chrome: ChromeSpec;
}

/** One connected text-like component found by the Stroke Width Transform. */
export interface TextRegion {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Median stroke width in source px. */
  strokeWidth: number;
  /** Cap height in SOURCE px (the glyph body height, excluding descenders). */
  capHeightPx: number;
  /** 0..1 — how text-like this component is (stroke-width variance, aspect, fill ratio). */
  confidence: number;
}

export type CheckStatus = 'pass' | 'warn' | 'fail';

/** One measured verdict. `value`/`unit`/`threshold` must be literally true and checkable. */
export interface CheckResult {
  id: string;
  label: string;
  status: CheckStatus;
  value: number;
  unit: string;
  threshold: number;
  /** Human sentence naming the number and what to do. No hedging, no LLM prose. */
  detail: string;
  surface?: SurfaceId;
  /** Points lost, 0..weight. */
  penalty: number;
  weight: number;
  /**
   * Advisory checks inform but never gate the score. Used where the measurement is
   * real but its interpretation is ambiguous — the saliency model cannot tell
   * "attention is on your subject" from "attention is on background clutter",
   * so it must not be able to condemn a thumbnail on its own.
   */
  advisory?: boolean;
}

export interface SaliencyResult {
  map: Plane;
  peak: { x: number; y: number };
  /** Fraction of total saliency mass inside the detected subject/text regions, 0..1. */
  onSubject: number;
}

export interface Report {
  /** 0..100. 100 = survives every surface intact. */
  score: number;
  checks: CheckResult[];
  textRegions: TextRegion[];
  saliency: SaliencyResult;
  /** Deterministic 16-hex-char digest of the input pixels. Same image ⇒ same hash, always. */
  fingerprint: string;
  /** Wall-clock ms, for the "it ran locally in N ms" claim. */
  elapsedMs: number;
}

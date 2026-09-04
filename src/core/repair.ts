/**
 * ThumbProof — deterministic repair.
 *
 * A linter that only complains is a worse product than one that fixes things.
 * These are the two repairs you can honestly make to a finished raster without
 * re-typesetting it, and both are what a creator would do by hand:
 *
 *   1. SCRIM   — lay a soft, correctly-computed darkening/lightening pad behind
 *                the headline until it actually clears WCAG. The opacity is
 *                solved for, not eyeballed.
 *   2. PUNCH-IN — recrop 16:9 tighter around the headline and the attention peak,
 *                so the same type is delivered larger. Costs you framing, buys
 *                you legibility. We report exactly what it bought.
 *
 * No generative model touches the pixels. Everything here is reversible and
 * explainable to the creator in one sentence.
 */

import type { Bitmap, TextRegion, Report } from './types';
import { resizeLanczos, cropRect } from './image';
import { contrastRatio, localTextContrast, otsuThreshold } from './contrast';
import { CONTRAST_WARN, CAP_HEIGHT_WARN_PX, SURFACES } from './surfaces';

export interface RepairStep {
  id: 'scrim' | 'punch-in';
  applied: boolean;
  /** One sentence a creator can act on, naming the number. */
  detail: string;
}

export interface RepairResult {
  bitmap: Bitmap;
  steps: RepairStep[];
  /** Crop actually used, in source px. Null when no punch-in was warranted. */
  crop: { x: number; y: number; w: number; h: number } | null;
}

function clamp(v: number, lo: number, hi: number) { return v < lo ? lo : v > hi ? hi : v; }

/** Blend a colour toward `target` by alpha, per channel. */
function blend(c: [number, number, number], target: number, a: number): [number, number, number] {
  return [
    c[0] * (1 - a) + target * a,
    c[1] * (1 - a) + target * a,
    c[2] * (1 - a) + target * a,
  ];
}

/**
 * Solve for the minimum scrim alpha that lifts fg/bg contrast to `targetRatio`.
 * Binary search on alpha — monotone in alpha, so 24 iterations is exact to ~1e-7.
 * Returns null when even a full-strength scrim cannot reach the target.
 */
export function solveScrimAlpha(
  fg: [number, number, number],
  bg: [number, number, number],
  targetRatio: number,
): { alpha: number; toward: 0 | 255 } | null {
  for (const toward of [0, 255] as const) {
    if (contrastRatio(fg, blend(bg, toward, 1)) < targetRatio) continue;
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (contrastRatio(fg, blend(bg, toward, mid)) >= targetRatio) hi = mid;
      else lo = mid;
    }
    return { alpha: hi, toward };
  }
  return null;
}

/** Otsu luma threshold computed inside one text region. O(region area). */
function regionOtsuCut(b: Bitmap, r: { x: number; y: number; w: number; h: number }): number {
  const x0 = clamp(Math.floor(r.x), 0, b.width);
  const y0 = clamp(Math.floor(r.y), 0, b.height);
  const x1 = clamp(Math.ceil(r.x + r.w), 0, b.width);
  const y1 = clamp(Math.ceil(r.y + r.h), 0, b.height);
  const hist = new Int32Array(256);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * b.width + x) * 4;
      const luma = 0.299 * (b.rgba[i] ?? 0) + 0.587 * (b.rgba[i + 1] ?? 0) + 0.114 * (b.rgba[i + 2] ?? 0);
      hist[Math.min(255, Math.max(0, Math.round(luma)))]!++;
    }
  }
  return otsuThreshold(hist);
}

/** Cosine-feathered rounded-rect mask value at (x,y). Deterministic, no randomness. */
function scrimMask(
  x: number, y: number,
  r: { x: number; y: number; w: number; h: number },
  feather: number,
): number {
  const dx = Math.max(r.x - x, 0, x - (r.x + r.w));
  const dy = Math.max(r.y - y, 0, y - (r.y + r.h));
  const d = Math.hypot(dx, dy);
  if (d <= 0) return 1;
  if (d >= feather) return 0;
  return 0.5 * (1 + Math.cos((d / feather) * Math.PI));
}

/**
 * Pad the headline regions with a solved scrim. Mutates a copy, never the input.
 * O(w*h*regions) but regions is small (<=6) so this is a single-digit-ms pass.
 */
export function applyScrim(b: Bitmap, regions: readonly TextRegion[]): { bitmap: Bitmap; step: RepairStep } {
  const out: Bitmap = { width: b.width, height: b.height, rgba: new Uint8ClampedArray(b.rgba) };
  const pads: {
    rect: { x: number; y: number; w: number; h: number };
    alpha: number; toward: 0 | 255;
    /** Luma cut separating glyph from background, and which side the glyph is on. */
    cut: number; glyphAbove: boolean;
  }[] = [];

  for (const r of regions) {
    const m = localTextContrast(b, r);
    if (m.ratio >= CONTRAST_WARN) continue;
    // A region with no foreground/background separation (a solid block) has no
    // contrast problem a scrim can fix — darkening it moves the text with it.
    // localTextContrast reports ratio 1 with fg === bg for that degenerate case.
    if (m.fg[0] === m.bg[0] && m.fg[1] === m.bg[1] && m.fg[2] === m.bg[2]) continue;
    const solved = solveScrimAlpha(m.fg, m.bg, CONTRAST_WARN);
    if (!solved) continue;

    // Otsu cut inside the region so the scrim can be masked OFF the glyphs. Laying
    // it over everything scales foreground and background together and leaves the
    // ratio essentially unchanged — that is a tint, not a scrim.
    const cut = regionOtsuCut(b, r);
    const fgLuma = 0.299 * m.fg[0] + 0.587 * m.fg[1] + 0.114 * m.fg[2];

    const grow = Math.max(6, r.h * 0.18);
    pads.push({
      rect: {
        x: clamp(r.x - grow, 0, b.width), y: clamp(r.y - grow, 0, b.height),
        w: Math.min(r.w + grow * 2, b.width), h: Math.min(r.h + grow * 2, b.height),
      },
      alpha: solved.alpha,
      toward: solved.toward,
      cut,
      glyphAbove: fgLuma >= cut,
    });
  }

  if (pads.length === 0) {
    return { bitmap: out, step: { id: 'scrim', applied: false, detail: 'Headline already clears 4.5:1 — no scrim needed.' } };
  }

  const feather = Math.max(8, b.height * 0.02);
  let peak = 0;
  for (const p of pads) {
    peak = Math.max(peak, p.alpha);
    const x0 = clamp(Math.floor(p.rect.x - feather), 0, b.width);
    const x1 = clamp(Math.ceil(p.rect.x + p.rect.w + feather), 0, b.width);
    const y0 = clamp(Math.floor(p.rect.y - feather), 0, b.height);
    const y1 = clamp(Math.ceil(p.rect.y + p.rect.h + feather), 0, b.height);
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const geom = p.alpha * scrimMask(x, y, p.rect, feather);
        if (geom <= 0) continue;
        const i = (y * b.width + x) * 4;
        // Mask the scrim off the glyph pixels — this is what makes it a scrim.
        const luma = 0.299 * (b.rgba[i] ?? 0) + 0.587 * (b.rgba[i + 1] ?? 0) + 0.114 * (b.rgba[i + 2] ?? 0);
        const isGlyph = p.glyphAbove ? luma >= p.cut : luma < p.cut;
        if (isGlyph) continue;
        const a = geom;
        for (let c = 0; c < 3; c++) {
          const cur = out.rgba[i + c] ?? 0;
          out.rgba[i + c] = cur * (1 - a) + p.toward * a;
        }
      }
    }
  }

  return {
    bitmap: out,
    step: {
      id: 'scrim',
      applied: true,
      detail: `Solved a ${Math.round(peak * 100)}% ${pads[0]!.toward === 0 ? 'dark' : 'light'} scrim behind ${pads.length} text ${pads.length === 1 ? 'block' : 'blocks'} — the minimum that reaches ${CONTRAST_WARN}:1.`,
    },
  };
}

/**
 * Find the tightest 16:9 crop that still contains every headline region and the
 * attention peak, with a margin. Tighter crop ⇒ the same type is delivered larger.
 * Deterministic: no search randomness, one closed-form box plus a clamp.
 */
export function planPunchIn(
  b: Bitmap,
  regions: readonly TextRegion[],
  peak: { x: number; y: number },
): { x: number; y: number; w: number; h: number } | null {
  if (regions.length === 0) return null;

  // Preserve the DOMINANT text only. Requiring every detected line to survive means
  // a thumbnail with scattered small print can never be cropped, which is backwards:
  // sacrificing the small print to deliver the headline larger is exactly the trade
  // a creator would make by hand.
  const tallest = regions.reduce((a, r) => (r.capHeightPx > a.capHeightPx ? r : a), regions[0]!);
  const keep = regions.filter((r) => r.capHeightPx >= tallest.capHeightPx * 0.6);

  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of keep) {
    x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h);
  }
  x0 = Math.min(x0, peak.x); y0 = Math.min(y0, peak.y);
  x1 = Math.max(x1, peak.x); y1 = Math.max(y1, peak.y);

  const padX = b.width * 0.06;
  const padY = b.height * 0.06;
  x0 -= padX; y0 -= padY; x1 += padX; y1 += padY;

  // Grow the box to exactly 16:9 about its own centre.
  const aspect = b.width / b.height;
  let w = x1 - x0;
  let h = y1 - y0;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  if (w / h < aspect) w = h * aspect; else h = w / aspect;

  // Never exceed the source, and keep the box on-canvas.
  const scaleDown = Math.min(1, b.width / w, b.height / h);
  w *= scaleDown; h *= scaleDown;
  const x = clamp(cx - w / 2, 0, b.width - w);
  const y = clamp(cy - h / 2, 0, b.height - h);

  // Below ~8% tighter it is not worth trading away framing.
  if (b.width / w < 1.08) return null;
  return { x, y, w, h };
}

/**
 * Full repair pass. Returns a NEW bitmap at the source dimensions plus a plain-English
 * record of what changed, so the creator can accept or reject each step.
 */
export function repair(b: Bitmap, report: Report): RepairResult {
  const heads = report.textRegions.filter((r) => r.confidence >= 0.5).slice(0, 6);
  const steps: RepairStep[] = [];

  const scrimmed = applyScrim(b, heads);
  steps.push(scrimmed.step);

  // Decide against the TIGHTEST surface, not the most-trafficked one. Cap height is
  // almost always fine on the big surfaces, so keying off those meant punch-in never
  // fired for the surface that actually failed.
  const primary = SURFACES.reduce((a, s) => (s.cssWidth < a.cssWidth ? s : a), SURFACES[0]!);
  const tallest = heads.length
    ? heads.reduce((a, r) => (r.capHeightPx > a.capHeightPx ? r : a), heads[0]!)
    : null;
  const deliveredNow = tallest ? tallest.capHeightPx * (primary.cssWidth / b.width) : Infinity;

  let outBitmap = scrimmed.bitmap;
  let crop: RepairResult['crop'] = null;

  if (tallest && deliveredNow < CAP_HEIGHT_WARN_PX) {
    const plan = planPunchIn(scrimmed.bitmap, heads, report.saliency.peak);
    if (plan) {
      const cropped = cropRect(
        scrimmed.bitmap,
        Math.round(plan.x), Math.round(plan.y),
        Math.round(plan.w), Math.round(plan.h),
      );
      outBitmap = resizeLanczos(cropped, b.width, b.height);
      crop = plan;
      const gain = b.width / plan.w;
      steps.push({
        id: 'punch-in',
        applied: true,
        detail: `Recropped ${((1 - plan.w / b.width) * 100).toFixed(0)}% tighter around your headline and attention peak — delivers the same type ${gain.toFixed(2)}× larger (${deliveredNow.toFixed(1)}px → ${(deliveredNow * gain).toFixed(1)}px on ${primary.label}).`,
      });
    } else {
      steps.push({
        id: 'punch-in',
        applied: false,
        // Be specific about WHY, and do not pretend a mechanical fix exists. Text
        // spread corner to corner leaves no 16:9 crop that delivers it larger.
        detail:
          'Your text is spread across the whole frame, so no 16:9 crop delivers it larger without dropping part of it. This one cannot be fixed by cropping — it needs fewer, bigger words.',
      });
    }
  } else {
    steps.push({ id: 'punch-in', applied: false, detail: 'Headline already clears the comfort threshold — no recrop needed.' });
  }

  return { bitmap: outBitmap, steps, crop };
}

/**
 * ThumbProof — analysis orchestrator.
 *
 * Takes one 16:9 bitmap and answers a single question per delivery surface:
 * "does this still work when YouTube hands it to a human at THAT size?"
 *
 * Every check returns a measured number with a stated threshold. Nothing here
 * is an opinion, a model output, or a network call.
 */

import type {
  Bitmap, CheckResult, Report, Surface, TextRegion, SaliencyResult, Plane, FaceRegion,
} from './types';
import { SURFACES, CAP_HEIGHT_FAIL_PX, CAP_HEIGHT_WARN_PX, CONTRAST_FAIL, CONTRAST_WARN } from './surfaces';
import { toGray, resizeLanczos } from './image';
import { localTextContrast } from './contrast';
import { detectTextSWT } from './swt';
import { detectFaces } from './face';
import { spectralResidualSaliency } from './saliency';
import { ssim } from './ssim';
import { fnv1a64 } from './hash';

/**
 * Score band ceilings. Any hard failure caps the score inside the fail band; any
 * warning caps it inside the warn band. See the gate in `analyze`.
 */
export const GATE_FAIL_CEILING = 44;
export const GATE_WARN_CEILING = 74;

/**
 * Points lost per point of weighted penalty, descending from the band ceiling.
 * Tuned against 14 real YouTube thumbnails plus the six authored samples: 1.5 spread
 * the warn band nicely but drove failing thumbnails to single digits, and a "2/100"
 * reads as a broken tool rather than a bad thumbnail.
 */
export const PENALTY_RATE = 1.0;

/** Band floors, so no band can collapse to an uninformative number. */
export const BAND_FLOORS = { fail: 5, warn: 46, pass: 76 } as const;

/** Weights sum to 100. Tuned so the two things that actually kill a thumbnail dominate. */
export const WEIGHTS = {
  /** Can they read your hook? Measured on the tallest line, per surface. */
  capHeight: 19,
  /** How much of everything else is already lost? Measured on every line. */
  unreadableShare: 18,
  contrast: 18,
  detailSurvival: 16,
  badgeCollision: 12,
  /** Is the presenter still a person at delivered size, or a smudge? */
  faceSize: 3,
  /** Advisory only — see CheckResult.advisory. */
  saliencyFocus: 4,
  textLoad: 5,
  edgeSafety: 5,
} as const;

/** Cap height in DELIVERED px once the source is scaled into a surface's box. */
export function deliveredCapHeight(capHeightPx: number, srcWidth: number, s: Surface): number {
  return capHeightPx * (s.cssWidth / srcWidth);
}

/** The rectangle YouTube stamps its duration pill into, in source-image px. */
export function badgeRect(b: Bitmap, s: Surface): { x: number; y: number; w: number; h: number } | null {
  const c = s.chrome.durationBadge;
  if (!c) return null;
  const w = b.width * c.widthPct;
  const h = b.height * c.heightPct;
  return {
    x: b.width * (1 - c.rightPct) - w,
    y: b.height * (1 - c.bottomPct) - h,
    w,
    h,
  };
}

function overlapArea(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): number {
  const x = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return x * y;
}

function statusFor(value: number, warnAt: number, failAt: number, higherIsBetter: boolean) {
  if (higherIsBetter) return value < failAt ? 'fail' : value < warnAt ? 'warn' : 'pass';
  return value > failAt ? 'fail' : value > warnAt ? 'warn' : 'pass';
}

/** Linear penalty ramp: 0 at `good`, full weight at `bad`. */
function ramp(value: number, good: number, bad: number, weight: number): number {
  if (good === bad) return 0;
  const t = (value - good) / (bad - good);
  return Math.max(0, Math.min(1, t)) * weight;
}

/** Every line we trust — used when the QUANTITY of text is the thing being judged. */
function confidentRegions(regions: readonly TextRegion[]): TextRegion[] {
  return regions.filter((r) => r.confidence >= 0.5);
}

/** The few lines that carry the message — used for headline-quality checks. */
function headlineRegions(regions: readonly TextRegion[]): TextRegion[] {
  return confidentRegions(regions).slice(0, 6);
}

/** The surface that squeezes text hardest — the honest place to judge legibility. */
function tightestSurface(): Surface {
  return SURFACES.reduce((a, s) => (s.cssWidth < a.cssWidth ? s : a), SURFACES[0]!);
}

// ---------------------------------------------------------------- checks

function checkCapHeight(b: Bitmap, regions: readonly TextRegion[]): CheckResult[] {
  const heads = headlineRegions(regions);
  if (heads.length === 0) return [];

  // The headline is the tallest confident line — that is what has to survive.
  const tallest = heads.reduce((a, r) => (r.capHeightPx > a.capHeightPx ? r : a), heads[0]!);

  return SURFACES.map((s) => {
    const delivered = deliveredCapHeight(tallest.capHeightPx, b.width, s);
    const penalty = ramp(delivered, CAP_HEIGHT_WARN_PX, CAP_HEIGHT_FAIL_PX * 0.5,
      WEIGHTS.capHeight * s.impressionShare);
    return {
      id: `cap-height:${s.id}`,
      label: `Headline legibility — ${s.label}`,
      status: statusFor(delivered, CAP_HEIGHT_WARN_PX, CAP_HEIGHT_FAIL_PX, true),
      value: Math.round(delivered * 10) / 10,
      unit: 'px cap height',
      threshold: CAP_HEIGHT_FAIL_PX,
      surface: s.id,
      penalty,
      weight: WEIGHTS.capHeight * s.impressionShare,
      detail:
        delivered < CAP_HEIGHT_FAIL_PX
          ? `Your largest text is ${delivered.toFixed(1)}px tall here — below the ${CAP_HEIGHT_FAIL_PX}px floor for reliable reading. Nobody on ${s.label.toLowerCase()} can read it.`
          : delivered < CAP_HEIGHT_WARN_PX
            ? `${delivered.toFixed(1)}px cap height — readable but effortful. ${CAP_HEIGHT_WARN_PX}px is comfortable.`
            : `${delivered.toFixed(1)}px cap height — clears the ${CAP_HEIGHT_WARN_PX}px comfort threshold.`,
    };
  });
}

/**
 * A big headline can pass while everything underneath it is already gone. This
 * measures the share of detected text that cannot be read on the tightest surface,
 * which is what separates "one bold hook" from "a wall of text".
 */
function checkUnreadableShare(b: Bitmap, regions: readonly TextRegion[]): CheckResult[] {
  const all = confidentRegions(regions);
  if (all.length < 2) return [];
  const s = tightestSurface();

  // Weighted by text AREA, not line count. Counting lines makes a single small
  // kicker under a huge headline look like "a third of your thumbnail is illegible",
  // which is false. Area asks the honest question: how much of the ink you laid down
  // is not delivered?
  const unreadable = all.filter(
    (r) => deliveredCapHeight(r.capHeightPx, b.width, s) < CAP_HEIGHT_FAIL_PX,
  );
  const totalArea = all.reduce((acc, r) => acc + r.w * r.h, 0);
  const lostArea = unreadable.reduce((acc, r) => acc + r.w * r.h, 0);
  const pct = totalArea > 0 ? (lostArea / totalArea) * 100 : 0;

  return [{
    id: 'unreadable-share',
    label: `Text already lost on ${s.label}`,
    status: statusFor(pct, 20, 55, false),
    value: Math.round(pct),
    unit: `% of text area below ${CAP_HEIGHT_FAIL_PX}px`,
    threshold: 20,
    surface: s.id,
    penalty: ramp(pct, 20, 85, WEIGHTS.unreadableShare),
    weight: WEIGHTS.unreadableShare,
    detail:
      pct > 55
        ? `${Math.round(pct)}% of your text — ${unreadable.length} of ${all.length} lines — falls under ${CAP_HEIGHT_FAIL_PX}px on ${s.label.toLowerCase()}. Most of what you wrote is not delivered to anyone. You are designing for a reader who does not exist.`
        : pct > 20
          ? `${Math.round(pct)}% of your text area falls below the ${CAP_HEIGHT_FAIL_PX}px floor here (${unreadable.length} of ${all.length} lines). The supporting copy is decoration, not information.`
          : `${Math.round(pct)}% of your text area drops below the floor — the message survives.`,
  }];
}

function checkContrast(b: Bitmap, regions: readonly TextRegion[]): CheckResult[] {
  const heads = headlineRegions(regions);
  if (heads.length === 0) return [];

  let worst = Infinity;
  let worstFg: [number, number, number] = [0, 0, 0];
  let worstBg: [number, number, number] = [255, 255, 255];
  for (const r of heads) {
    const m = localTextContrast(b, r);
    if (m.ratio < worst) {
      worst = m.ratio;
      worstFg = m.fg;
      worstBg = m.bg;
    }
  }
  if (!Number.isFinite(worst)) return [];

  const hex = (c: [number, number, number]) =>
    '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

  return [{
    id: 'contrast',
    label: 'Text vs its own background',
    status: statusFor(worst, CONTRAST_WARN, CONTRAST_FAIL, true),
    value: Math.round(worst * 100) / 100,
    unit: ':1 WCAG contrast',
    threshold: CONTRAST_WARN,
    penalty: ramp(worst, CONTRAST_WARN, 1.5, WEIGHTS.contrast),
    weight: WEIGHTS.contrast,
    detail:
      worst < CONTRAST_FAIL
        ? `${worst.toFixed(2)}:1 between ${hex(worstFg)} and ${hex(worstBg)}. WCAG needs 4.5:1. This text is fighting its background — add a scrim or change the type colour.`
        : worst < CONTRAST_WARN
          ? `${worst.toFixed(2)}:1 — passes for large type but not body text. Tighten it toward 4.5:1.`
          : `${worst.toFixed(2)}:1 — clears WCAG 4.5:1.`,
  }];
}

/**
 * The core measurement: downscale to the delivered box with real Lanczos, scale
 * back up, and compare. Detail that does not survive the round trip was never
 * delivered to the viewer in the first place.
 */
function checkDetailSurvival(b: Bitmap, gray: Plane): CheckResult[] {
  const target = SURFACES.reduce((a, s) => (s.impressionShare > a.impressionShare ? s : a), SURFACES[0]!);
  const small = resizeLanczos(b, target.cssWidth, target.cssHeight);
  const back = resizeLanczos(small, b.width, b.height);
  const s = ssim(gray, toGray(back));

  return [{
    id: 'detail-survival',
    label: `Detail surviving the trip to ${target.label}`,
    status: statusFor(s, 0.85, 0.75, true),
    value: Math.round(s * 1000) / 1000,
    unit: 'SSIM after 1280→' + target.cssWidth + '→1280',
    threshold: 0.85,
    surface: target.id,
    penalty: ramp(s, 0.85, 0.55, WEIGHTS.detailSurvival),
    weight: WEIGHTS.detailSurvival,
    detail:
      s < 0.75
        ? `SSIM ${s.toFixed(3)}. Most of your fine detail is destroyed by the downscale to ${target.cssWidth}px — the composition is too busy to read at delivered size.`
        : s < 0.82
          ? `SSIM ${s.toFixed(3)}. Noticeable detail loss at ${target.cssWidth}px. Fewer, bigger elements would survive better.`
          : `SSIM ${s.toFixed(3)}. The composition holds together at ${target.cssWidth}px.`,
  }];
}

function checkBadgeCollision(b: Bitmap, regions: readonly TextRegion[]): CheckResult[] {
  const heads = headlineRegions(regions);
  const surface = SURFACES.find((s) => s.chrome.durationBadge) ?? SURFACES[0]!;
  const rect = badgeRect(b, surface);
  if (!rect || heads.length === 0) return [];

  // The question is "is any ONE of my text blocks buried?", not "what share of all
  // my ink is buried?" Averaging over every region lets a big headline hide the fact
  // that the payoff word is completely under the pill.
  let pct = 0;
  for (const r of heads) {
    const area = r.w * r.h;
    if (area <= 0) continue;
    pct = Math.max(pct, (overlapArea(r, rect) / area) * 100);
  }

  return [{
    id: 'badge-collision',
    label: 'Text under the duration badge',
    status: statusFor(pct, 2, 12, false),
    value: Math.round(pct * 10) / 10,
    unit: '% of the worst-hit text block covered',
    threshold: 2,
    penalty: ramp(pct, 2, 30, WEIGHTS.badgeCollision),
    weight: WEIGHTS.badgeCollision,
    detail:
      pct > 12
        ? `${pct.toFixed(1)}% of one of your text blocks sits under YouTube's duration pill. You never see this in your design tool — YouTube stamps it on after upload.`
        : pct > 2
          ? `${pct.toFixed(1)}% of your text clips the duration pill. Keep the bottom-right corner clear.`
          : `Bottom-right is clear of the duration pill.`,
  }];
}

function checkSaliencyFocus(sal: SaliencyResult): CheckResult[] {
  const pct = sal.onSubject * 100;
  return [{
    id: 'saliency-focus',
    label: 'Where the eye lands first (advisory)',
    advisory: true,
    // Capped at 'warn': a low score here can mean a cluttered background, or it can
    // mean a perfectly good composition whose subject is a face we cannot detect.
    status: pct < 45 ? 'warn' : 'pass',
    value: Math.round(pct),
    unit: '% of visual attention on your subject',
    threshold: 45,
    penalty: ramp(pct, 45, 10, WEIGHTS.saliencyFocus),
    weight: WEIGHTS.saliencyFocus,
    detail:
      pct < 25
        ? `Only ${Math.round(pct)}% of predicted attention lands on your headline or subject — the rest is pulled to background clutter.`
        : pct < 45
          ? `${Math.round(pct)}% of predicted attention is on your subject. Competing elements are splitting the gaze.`
          : `${Math.round(pct)}% of predicted attention lands on your subject.`,
  }];
}

/**
 * A thumbnail's subject is usually a person, and a face has to survive the downscale
 * just like type does. Below roughly 14px of delivered height a face stops being a
 * specific person and becomes a smudge — you lose the recognition that makes a
 * regular viewer click.
 *
 * Only emitted for a high-confidence detection: the detector is a skin-chroma
 * heuristic with known false positives (hands, wood, sand), and a phantom face must
 * never be able to fail a thumbnail.
 */
function checkFaceSize(b: Bitmap, faces: readonly FaceRegion[]): CheckResult[] {
  // Two deliberate asymmetries here, both learned the hard way.
  //
  // FALSE NEGATIVES: emitted only when a face IS found, so a thumbnail where none is
  // detected is never penalised. The detector's misses are not evenly distributed — a
  // fixed Cb/Cr box with a luma floor misses deeply pigmented skin in low or cool
  // light far more often than pale skin in warm light. A missed face must cost the
  // creator nothing.
  //
  // FALSE POSITIVES: advisory, so it can never gate the score. The first version of
  // this check gated, and it promptly failed the "clean" sample — a bright amber
  // field with no person in it at all. Warm gradients are the single highest-volume
  // false positive for skin chroma, and they are endemic to thumbnail design. A
  // detector that cannot tell a sunset from a cheek has no business condemning
  // anyone's thumbnail, so this informs and never condemns.
  const strong = faces.filter((f) => f.confidence >= 0.75);
  if (strong.length === 0) return [];
  const s = tightestSurface();
  const biggest = strong.reduce((a, f) => (f.h > a.h ? f : a), strong[0]!);
  const delivered = biggest.h * (s.cssWidth / b.width);

  return [{
    id: 'face-size',
    label: `Face at ${s.label} (advisory)`,
    advisory: true,
    // Capped at 'warn' for the same reason it is advisory: a phantom face must not
    // be able to produce a hard failure.
    status: delivered < 24 ? 'warn' : 'pass',
    value: Math.round(delivered * 10) / 10,
    unit: 'px face height',
    threshold: 24,
    surface: s.id,
    penalty: ramp(delivered, 24, 8, WEIGHTS.faceSize),
    weight: WEIGHTS.faceSize,
    detail:
      delivered < 14
        ? `The face in your thumbnail is delivered ${delivered.toFixed(1)}px tall here — below the point where it reads as a specific person rather than a smudge. Crop tighter on the face.`
        : delivered < 24
          ? `Face delivered at ${delivered.toFixed(1)}px. Recognisable, but a tighter crop would let a returning viewer identify you at a glance.`
          : `Face delivered at ${delivered.toFixed(1)}px — comfortably recognisable.`,
  }];
}

function checkTextLoad(b: Bitmap, regions: readonly TextRegion[]): CheckResult[] {
  // Only lines a viewer can actually READ count as reading load. Lines below the
  // legibility floor are already charged to unreadable-share; billing them twice
  // would also let detector noise on a low-contrast image invent reading load that
  // no human is being asked to do.
  const s = tightestSurface();
  const all = confidentRegions(regions).filter(
    (r) => deliveredCapHeight(r.capHeightPx, b.width, s) >= CAP_HEIGHT_FAIL_PX,
  );
  if (all.length === 0) return [];
  const area = all.reduce((acc, r) => acc + r.w * r.h, 0);
  const pct = (area / (b.width * b.height)) * 100;
  const words = all.length;

  return [{
    id: 'text-load',
    label: 'How much text you are asking for',
    status: statusFor(words, 4, 8, false),
    value: words,
    unit: 'readable text lines',
    threshold: 3,
    penalty: ramp(words, 3, 14, WEIGHTS.textLoad),
    weight: WEIGHTS.textLoad,
    detail:
      words > 5
        ? `${words} readable text lines covering ${pct.toFixed(1)}% of the frame. In a scroll a viewer takes in roughly three words. Cut it.`
        : words > 3
          ? `${words} readable text lines. Three or fewer reads cleanly at delivered size.`
          : `${words} readable text line${words === 1 ? '' : 's'} — inside what a viewer can absorb in a scroll.`,
  }];
}

function checkEdgeSafety(b: Bitmap, regions: readonly TextRegion[]): CheckResult[] {
  const heads = headlineRegions(regions);
  if (heads.length === 0) return [];
  const margin = 0.04;
  const mx = b.width * margin;
  const my = b.height * margin;

  let worst = 0;
  for (const r of heads) {
    const out =
      Math.max(0, mx - r.x) + Math.max(0, r.x + r.w - (b.width - mx)) +
      Math.max(0, my - r.y) + Math.max(0, r.y + r.h - (b.height - my));
    worst = Math.max(worst, out);
  }
  const pct = (worst / Math.min(b.width, b.height)) * 100;

  return [{
    id: 'edge-safety',
    label: 'Content inside the safe area',
    status: statusFor(pct, 2, 14, false),
    value: Math.round(pct * 10) / 10,
    unit: '% past the 4% safe margin',
    threshold: 2,
    penalty: ramp(pct, 2, 18, WEIGHTS.edgeSafety),
    weight: WEIGHTS.edgeSafety,
    detail:
      pct > 3
        ? `Text runs ${pct.toFixed(1)}% past the safe margin and will be clipped by rounded corners and surface-specific crops.`
        : pct > 0.5
          ? `Text touches the safe margin. Some surfaces will shave it.`
          : `All text sits inside the 4% safe area.`,
  }];
}

// ---------------------------------------------------------------- entry point

/**
 * Fraction of saliency mass that falls inside the given regions.
 * Takes bare boxes so text regions and face regions can be pooled — attention on the
 * presenter counts as attention on the subject just as much as attention on the headline.
 */
export function saliencyOnRegions(
  map: Plane,
  regions: readonly { x: number; y: number; w: number; h: number }[],
  src: Bitmap,
): number {
  let total = 0;
  let inside = 0;
  const sx = map.width / src.width;
  const sy = map.height / src.height;
  const boxes = regions.map((r) => ({
    x0: Math.floor(r.x * sx), y0: Math.floor(r.y * sy),
    x1: Math.ceil((r.x + r.w) * sx), y1: Math.ceil((r.y + r.h) * sy),
  }));

  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const v = map.data[y * map.width + x] ?? 0;
      total += v;
      for (const b of boxes) {
        if (x >= b.x0 && x < b.x1 && y >= b.y0 && y < b.y1) { inside += v; break; }
      }
    }
  }
  return total > 0 ? inside / total : 0;
}

/**
 * Run every check. Deterministic: same pixels in, same report out.
 * Typical cost on a 1280x720 source is a few hundred ms, entirely on-device.
 */
export function analyze(b: Bitmap, now: () => number = () => performance.now()): Report {
  const t0 = now();

  const gray = toGray(b);
  const textRegions = detectTextSWT(b);
  const faces = detectFaces(b);
  const sal = spectralResidualSaliency(b);
  const heads = headlineRegions(textRegions);

  // "On subject" means on the headline OR on the presenter. Before faces were
  // detected this could only count text, so a thumbnail with a big clear face and a
  // short headline scored as though attention were landing on nothing.
  // Same confidence bar as the face check — a warm background must not be allowed to
  // masquerade as "attention is landing on your presenter".
  const subject = [...heads, ...faces.filter((f) => f.confidence >= 0.75)];
  const onSubject = subject.length > 0 ? saliencyOnRegions(sal.map, subject, b) : sal.onSubject;
  const saliency: SaliencyResult = { ...sal, onSubject };

  const checks: CheckResult[] = [
    ...checkCapHeight(b, textRegions),
    ...checkUnreadableShare(b, textRegions),
    ...checkContrast(b, textRegions),
    ...checkDetailSurvival(b, gray),
    ...checkBadgeCollision(b, textRegions),
    ...checkFaceSize(b, faces),
    ...checkSaliencyFocus(saliency),
    ...checkTextLoad(b, textRegions),
    ...checkEdgeSafety(b, textRegions),
  ];

  const totalWeight = checks.reduce((a, c) => a + c.weight, 0);
  const totalPenalty = checks.reduce((a, c) => a + c.penalty, 0);
  const weighted = totalWeight > 0
    ? Math.max(0, Math.min(100, Math.round(((totalWeight - totalPenalty) / totalWeight) * 100)))
    : 0;

  // A weighted average lets one catastrophic flaw hide behind everything that is
  // fine — a thumbnail whose payoff word is entirely under the duration pill should
  // not score 71 because its contrast is good. That is not how a viewer experiences
  // it: one fatal flaw makes the thumbnail fail, full stop.
  //
  // But clamping to the band ceiling ALSO destroys information. Measured against 14
  // real YouTube thumbnails, a hard clamp put nine of them on exactly 74, because
  // almost every real thumbnail trips at least one warning and every weighted score
  // above the ceiling collapsed onto it. A creator comparing three of their own
  // videos would have seen three identical numbers and concluded the tool measures
  // nothing.
  //
  // So the gate picks the BAND, and you descend from that band's ceiling in
  // proportion to the penalty you actually accrued.
  //
  // Mapping the full 0..100 weighted range into the band was the first attempt and it
  // did not work either: real thumbnails pass most checks, so `weighted` lives in a
  // narrow 88..100 strip, and stretching that across a 29-point band still put ten of
  // fourteen real thumbnails within three points of each other. Descending from the
  // ceiling at a fixed rate spends the band on the range that actually varies.
  //
  // PENALTY_RATE is the points lost per point of weighted penalty. Above 1 so that a
  // handful of small warnings is still visibly worse than a clean sheet.
  const gating = checks.filter((c) => !c.advisory);
  const [floor, ceiling] = gating.some((c) => c.status === 'fail')
    ? [BAND_FLOORS.fail, GATE_FAIL_CEILING]
    : gating.some((c) => c.status === 'warn')
      ? [BAND_FLOORS.warn, GATE_WARN_CEILING]
      : [BAND_FLOORS.pass, 100];
  const lost = (100 - weighted) * PENALTY_RATE;
  const score = Math.max(0, Math.min(100, Math.round(Math.max(floor, ceiling - lost))));

  return {
    score,
    checks,
    textRegions,
    faces,
    saliency,
    fingerprint: fnv1a64(b.rgba),
    elapsedMs: Math.round(now() - t0),
  };
}

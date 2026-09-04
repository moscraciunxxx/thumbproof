/**
 * ThumbProof — computed guidance.
 *
 * The repair pass fixes what a raster edit honestly can: contrast, and delivered
 * type size via a recrop. Plenty of thumbnails fail for reasons no raster edit can
 * fix — you wrote fourteen lines of copy, or your composition is too busy to survive
 * a downscale. Telling those creators "no mechanical fix exists" is true and useless.
 *
 * So this module answers the next question: *then what should I change?* Every item
 * below is arithmetic on the measurements, not advice-shaped prose. Where it says
 * "move it 84 px left", 84 is the computed distance that clears the duration pill.
 * Where it says "scale the headline to 96 px", that is the size at which it reaches
 * the legibility floor on the tightest surface it will be delivered into.
 */

import type { Bitmap, Report, TextRegion } from './types';
import { SURFACES, CAP_HEIGHT_WARN_PX, CAP_HEIGHT_FAIL_PX, CONTRAST_WARN } from './surfaces';
import { badgeRect, deliveredCapHeight } from './analyze';
import { localTextContrast } from './contrast';
import { toGray, resizeBox } from './image';

export interface Advice {
  id: string;
  /** Imperative, five words or so. */
  title: string;
  /** One or two sentences carrying the computed number. */
  detail: string;
  /** Region the creator should look at, in source px. */
  focus?: { x: number; y: number; w: number; h: number };
  /** Ordering hint — bigger is more urgent. */
  weight: number;
}

/** The surface that squeezes a thumbnail hardest. Everything here is judged there. */
function tightest() {
  return SURFACES.reduce((a, s) => (s.cssWidth < a.cssWidth ? s : a), SURFACES[0]!);
}

function confident(regions: readonly TextRegion[]): TextRegion[] {
  return regions.filter((r) => r.confidence >= 0.5);
}

/**
 * Minimum source cap height that survives on the tightest surface.
 * Inverts deliveredCapHeight: delivered = cap * (cssWidth / srcWidth).
 */
export function requiredCapHeightPx(srcWidth: number, targetDelivered = CAP_HEIGHT_WARN_PX): number {
  const s = tightest();
  return (targetDelivered * srcWidth) / s.cssWidth;
}

/** How far to move a box so it stops overlapping the badge, on each axis. */
export function badgeEscape(
  r: { x: number; y: number; w: number; h: number },
  badge: { x: number; y: number; w: number; h: number },
): { left: number; up: number } | null {
  const overlapX = Math.min(r.x + r.w, badge.x + badge.w) - Math.max(r.x, badge.x);
  const overlapY = Math.min(r.y + r.h, badge.y + badge.h) - Math.max(r.y, badge.y);
  if (overlapX <= 0 || overlapY <= 0) return null;
  return { left: Math.ceil(r.x + r.w - badge.x), up: Math.ceil(r.y + r.h - badge.y) };
}

/** Index of the busiest cell on a 3x3 grid of local contrast energy, plus its share. */
export function busiestCell(b: Bitmap): { col: number; row: number; share: number } {
  const g = toGray(resizeBox(b, 96, 54));
  const cells = new Array<number>(9).fill(0);
  for (let y = 1; y < g.height - 1; y++) {
    for (let x = 1; x < g.width - 1; x++) {
      const c = g.data[y * g.width + x] ?? 0;
      const e = Math.abs((g.data[y * g.width + x + 1] ?? 0) - c)
              + Math.abs((g.data[(y + 1) * g.width + x] ?? 0) - c);
      const col = Math.min(2, Math.floor((x / g.width) * 3));
      const row = Math.min(2, Math.floor((y / g.height) * 3));
      cells[row * 3 + col] = (cells[row * 3 + col] ?? 0) + e;
    }
  }
  const total = cells.reduce((a, v) => a + v, 0) || 1;
  let best = 0;
  for (let i = 1; i < 9; i++) if ((cells[i] ?? 0) > (cells[best] ?? 0)) best = i;
  return { col: best % 3, row: Math.floor(best / 3), share: (cells[best] ?? 0) / total };
}

const THIRDS = ['left', 'centre', 'right'] as const;
const BANDS = ['top', 'middle', 'bottom'] as const;

/**
 * Turn a report into concrete next actions, most urgent first.
 * Returns [] only for a thumbnail with nothing wrong.
 */
export function advise(b: Bitmap, report: Report): Advice[] {
  const out: Advice[] = [];
  const s = tightest();
  const heads = confident(report.textRegions);

  // --- 1. Type that cannot be delivered at all.
  if (heads.length > 0) {
    const needed = requiredCapHeightPx(b.width);
    const dead = heads.filter(
      (r) => deliveredCapHeight(r.capHeightPx, b.width, s) < CAP_HEIGHT_FAIL_PX,
    );
    const live = heads.filter(
      (r) => deliveredCapHeight(r.capHeightPx, b.width, s) >= CAP_HEIGHT_FAIL_PX,
    );

    if (dead.length > 0) {
      const deadArea = dead.reduce((a, r) => a + r.w * r.h, 0);
      const allArea = heads.reduce((a, r) => a + r.w * r.h, 0) || 1;
      out.push({
        id: 'cut-copy',
        title: `Cut ${dead.length} text ${dead.length === 1 ? 'block' : 'blocks'}`,
        detail:
          `${dead.length} of your ${heads.length} text blocks — ${Math.round((deadArea / allArea) * 100)}% of the ink you laid down — land under ${CAP_HEIGHT_FAIL_PX}px on ${s.label.toLowerCase()} and deliver nothing. ` +
          (live.length > 0
            ? `Keep the ${live.length} that survive and delete the rest; the space buys you size on what is left.`
            : `Nothing you have written survives at that size. Start from three words.`),
        focus: dead[0],
        weight: 90 + dead.length,
      });
    }

    const tallest = heads.reduce((a, r) => (r.capHeightPx > a.capHeightPx ? r : a), heads[0]!);
    const deliveredNow = deliveredCapHeight(tallest.capHeightPx, b.width, s);
    if (deliveredNow < CAP_HEIGHT_WARN_PX) {
      const factor = needed / tallest.capHeightPx;
      out.push({
        id: 'scale-headline',
        title: 'Set the headline bigger',
        detail:
          `Your largest type has a ${tallest.capHeightPx.toFixed(0)}px cap height, delivered as ${deliveredNow.toFixed(1)}px. ` +
          `In a ${b.width}px-wide design it needs to be at least ${needed.toFixed(0)}px — about ${factor.toFixed(2)}× what it is now — to clear the ${CAP_HEIGHT_WARN_PX}px comfort floor on ${s.label.toLowerCase()}.`,
        focus: tallest,
        weight: 80,
      });
    }
  }

  // --- 2. Content under the duration pill: give the exact distance.
  const badgeSurface = SURFACES.find((x) => x.chrome.durationBadge) ?? SURFACES[0]!;
  const badge = badgeRect(b, badgeSurface);
  if (badge) {
    for (const r of heads) {
      const esc = badgeEscape(r, badge);
      if (!esc) continue;
      const cheaper = esc.left <= esc.up ? `${esc.left}px to the left` : `${esc.up}px up`;
      out.push({
        id: 'clear-badge',
        title: 'Move it out of the pill',
        detail:
          `A text block overlaps the duration pill YouTube stamps on after upload. Move it ${cheaper} ` +
          `(or ${esc.left}px left / ${esc.up}px up) and it clears. You will never see this in your design tool — the pill does not exist there.`,
        focus: r,
        weight: 85,
      });
      break;
    }
  }

  // --- 3. Contrast a scrim cannot rescue.
  for (const r of heads) {
    const m = localTextContrast(b, r);
    if (m.ratio >= CONTRAST_WARN) continue;
    const hex = (c: [number, number, number]) =>
      '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
    out.push({
      id: 'contrast-colour',
      title: 'Change the type colour',
      detail:
        `Your text reads ${m.ratio.toFixed(2)}:1 against its own background (${hex(m.fg)} on ${hex(m.bg)}), below the ${CONTRAST_WARN}:1 target. ` +
        `A scrim can carry some of this, but the durable fix is to push the type toward ${m.bg[0] + m.bg[1] + m.bg[2] > 382 ? 'near-black' : 'near-white'} or add a hard outline.`,
      focus: r,
      weight: 70,
    });
    break;
  }

  // --- 4. Composition too busy to survive the downscale.
  const detail = report.checks.find((c) => c.id === 'detail-survival');
  if (detail && detail.status !== 'pass') {
    const cell = busiestCell(b);
    out.push({
      id: 'simplify',
      title: 'Simplify the busiest area',
      detail:
        `SSIM ${detail.value} after the round trip to ${s.cssWidth}px — fine detail is being destroyed on the way to the viewer. ` +
        `The densest ${Math.round(cell.share * 100)}% of the edge energy sits ${BANDS[cell.row]}-${THIRDS[cell.col]}. Fewer, larger shapes there will survive; thin strokes and small textures will not.`,
      weight: 60,
    });
  }

  // --- 5. Too much to read in a scroll.
  const load = report.checks.find((c) => c.id === 'text-load');
  if (load && load.status !== 'pass') {
    out.push({
      id: 'fewer-words',
      title: 'Ask for less reading',
      detail:
        `${load.value} readable text blocks. In a scroll a viewer takes in roughly three words before deciding. ` +
        `Pick the one promise the video makes and delete the supporting copy — the description field is where that belongs.`,
      weight: 50,
    });
  }

  return out.sort((a, b2) => b2.weight - a.weight || a.id.localeCompare(b2.id));
}

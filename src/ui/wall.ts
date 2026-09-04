/**
 * The wall: your thumbnail drawn at the TRUE CSS pixel size each YouTube surface
 * delivers it at, with YouTube's own chrome stamped on top.
 *
 * This is the whole argument of the product in one screen. You designed at 1280.
 * Here is 168. Downscaling goes through the same Lanczos path the analysis uses,
 * so what you are looking at is literally what was measured — not a CSS scale
 * of a big image, which would flatter the thumbnail with the browser's filtering.
 */

import type { Bitmap, Surface, Report } from '../core/types';
import { SURFACES } from '../core/surfaces';
import { resizeLanczos } from '../core/image';
import { deliveredCapHeight, badgeRect } from '../core/analyze';
import { CAP_HEIGHT_FAIL_PX, CAP_HEIGHT_WARN_PX } from '../core/surfaces';
import { bitmapToCanvas } from './bitmap';
import { el } from './dom';

const SAMPLE_TITLES: Record<string, string> = {
  'mobile-feed': 'I Tried This For 30 Days',
  'mobile-search': 'I Tried This For 30 Days',
  'desktop-grid': 'I Tried This For 30 Days',
  'desktop-sidebar': 'I Tried This For 30 Days — Full Breakdown',
  tv: 'I Tried This For 30 Days',
};

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/**
 * Render one surface tile at true size. `dpr` only controls the backing-store
 * resolution so the tile is not blurry on a retina display — the CSS box stays
 * at the real delivered dimensions, because that is what an eye actually resolves.
 */
export function renderSurfaceTile(src: Bitmap, s: Surface): HTMLCanvasElement {
  const backing = Math.min(3, Math.max(1, Math.round(window.devicePixelRatio || 1)));
  const w = s.cssWidth;
  const h = s.cssHeight;

  // Downscale with OUR Lanczos at the true delivered resolution, then let the
  // backing store draw those exact pixels larger. No browser resampling of detail.
  const delivered = resizeLanczos(src, w, h);
  const deliveredCanvas = bitmapToCanvas(delivered);

  const c = document.createElement('canvas');
  c.width = w * backing;
  c.height = h * backing;
  c.style.width = `${w}px`;
  c.style.height = `${h}px`;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  ctx.scale(backing, backing);
  ctx.imageSmoothingEnabled = false;

  const radius = (s.chrome.cornerRadiusPct ?? 0) * h;
  ctx.save();
  roundRectPath(ctx, 0, 0, w, h, radius);
  ctx.clip();
  ctx.drawImage(deliveredCanvas, 0, 0, w, h);
  ctx.restore();

  // Duration pill — YouTube stamps this on after upload. Creators never design for it.
  const badge = s.chrome.durationBadge;
  if (badge) {
    const bw = w * badge.widthPct;
    const bh = h * badge.heightPct;
    const bx = w * (1 - badge.rightPct) - bw;
    const by = h * (1 - badge.bottomPct) - bh;
    ctx.fillStyle = 'rgba(0,0,0,0.8)';
    roundRectPath(ctx, bx, by, bw, bh, Math.min(3, bh * 0.25));
    ctx.fill();
    ctx.fillStyle = '#fff';
    const fs = Math.max(6, Math.min(11, bh * 0.72));
    ctx.font = `500 ${fs}px system-ui, -apple-system, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('12:04', bx + bw / 2, by + bh / 2 + 0.5);
  }

  // Watched-progress bar, the other thing that eats the bottom edge.
  const bar = s.chrome.progressBar;
  if (bar) {
    const barH = Math.max(1, h * bar.heightPct);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(0, h - barH, w, barH);
    ctx.fillStyle = '#f00';
    ctx.fillRect(0, h - barH, w * 0.42, barH);
  }

  return c;
}

function verdictFor(report: Report | null, src: Bitmap, s: Surface) {
  if (!report) return null;
  const heads = report.textRegions.filter((r) => r.confidence >= 0.5);
  if (heads.length === 0) return null;
  const tallest = heads.reduce((a, r) => (r.capHeightPx > a.capHeightPx ? r : a), heads[0]!);
  const px = deliveredCapHeight(tallest.capHeightPx, src.width, s);
  const status = px < CAP_HEIGHT_FAIL_PX ? 'fail' : px < CAP_HEIGHT_WARN_PX ? 'warn' : 'pass';
  return { px, status };
}

/** Build the whole wall. Surfaces are ordered by how many impressions they carry. */
export function renderWall(src: Bitmap, report: Report | null): HTMLElement {
  const wrap = el('div', { class: 'wall' });

  const ordered = [...SURFACES].sort((a, b) => b.impressionShare - a.impressionShare);
  for (const s of ordered) {
    const v = verdictFor(report, src, s);
    const tile = el('figure', { class: `tile tile--${v?.status ?? 'none'}` });

    const head = el('figcaption', { class: 'tile__head' });
    head.append(
      el('span', { class: 'tile__label' }, s.label),
      el('span', { class: 'tile__dims' }, `${s.cssWidth}×${s.cssHeight} px · ${Math.round(s.impressionShare * 100)}% of impressions`),
    );

    const stage = el('div', { class: `tile__stage tile__stage--${s.background}` });
    const shot = el('div', { class: 'tile__shot' });
    shot.append(renderSurfaceTile(src, s));

    // A line of real UI underneath, so the thumbnail is judged in context.
    const meta = el('div', { class: 'tile__meta' });
    meta.style.width = `${s.cssWidth}px`;
    meta.append(
      el('div', { class: 'tile__title' }, SAMPLE_TITLES[s.id] ?? 'Your video title'),
      el('div', { class: 'tile__channel' }, 'Your Channel · 84K views · 2 days ago'),
    );
    shot.append(meta);
    stage.append(shot);

    tile.append(head, stage);

    if (v) {
      const chip = el('div', { class: `tile__verdict tile__verdict--${v.status}` });
      chip.append(
        el('strong', {}, `${v.px.toFixed(1)}px`),
        el('span', {}, v.status === 'fail'
          ? 'cap height — unreadable'
          : v.status === 'warn'
            ? 'cap height — effortful'
            : 'cap height — reads clean'),
      );
      tile.append(chip);
    }
    wrap.append(tile);
  }
  return wrap;
}

/**
 * Diagnostic overlay on the full-size image: detected text lines, the attention
 * peak, and the badge keep-out zone. Shows the creator what the tool actually saw,
 * which is the difference between a measurement and a magic number.
 */
export function renderDiagnostic(src: Bitmap, report: Report): HTMLCanvasElement {
  const c = bitmapToCanvas(src);
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');

  const primary = SURFACES.reduce((a, s) => (s.impressionShare > a.impressionShare ? s : a), SURFACES[0]!);
  const rect = badgeRect(src, primary);
  if (rect) {
    ctx.fillStyle = 'rgba(255,64,64,0.22)';
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    ctx.strokeStyle = 'rgba(255,64,64,0.9)';
    ctx.setLineDash([8, 6]);
    ctx.lineWidth = 3;
    ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
    ctx.setLineDash([]);
  }

  for (const r of report.textRegions.filter((t) => t.confidence >= 0.5)) {
    ctx.strokeStyle = 'rgba(64,220,255,0.95)';
    ctx.lineWidth = 3;
    ctx.strokeRect(r.x, r.y, r.w, r.h);
    ctx.fillStyle = 'rgba(64,220,255,0.95)';
    ctx.font = '600 20px system-ui, sans-serif';
    ctx.fillText(`${r.capHeightPx.toFixed(0)}px`, r.x + 4, Math.max(20, r.y - 6));
  }

  const p = report.saliency.peak;
  ctx.strokeStyle = 'rgba(255,214,64,0.95)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(p.x, p.y, 26, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(p.x - 38, p.y); ctx.lineTo(p.x - 12, p.y);
  ctx.moveTo(p.x + 12, p.y); ctx.lineTo(p.x + 38, p.y);
  ctx.moveTo(p.x, p.y - 38); ctx.lineTo(p.x, p.y - 12);
  ctx.moveTo(p.x, p.y + 12); ctx.lineTo(p.x, p.y + 38);
  ctx.stroke();

  return c;
}

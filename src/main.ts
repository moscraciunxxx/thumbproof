/**
 * ThumbProof — app wiring.
 *
 * Boot order matters for the ten-second try: a sample is analysed and drawn
 * before the user does anything, so the first paint already carries a real
 * measured number rather than an empty state.
 */

import './styles.css';
import type { Bitmap, Report } from './core/types';
import { analyze } from './core/analyze';
import { repair, type RepairResult } from './core/repair';
import { signature, shelfTest, type ShelfSignature } from './core/shelf';
import { SAMPLES, BACK_CATALOGUE, type Sample } from './fixtures/samples';
import { svgToImage, normalizeTo16x9, fileToBitmap, bitmapToCanvas } from './ui/bitmap';
import { renderWall, renderDiagnostic } from './ui/wall';
import { renderScore, renderChecks, renderRepair, renderShelf } from './ui/panels';
import { el, clear, mustGet } from './ui/dom';
import { resizeLanczos } from './core/image';

interface State {
  bitmap: Bitmap | null;
  report: Report | null;
  label: string;
  catalogue: ShelfSignature[];
}

const state: State = { bitmap: null, report: null, label: '', catalogue: [] };

const nodes = {
  score: mustGet('score'),
  samples: mustGet('samples'),
  wall: mustGet('wall'),
  checks: mustGet<HTMLUListElement>('checks'),
  diagnostic: mustGet('diagnostic'),
  repairBtn: mustGet<HTMLButtonElement>('repair'),
  repairOut: mustGet('repairOut'),
  repairWall: mustGet('repairWall'),
  shelf: mustGet('shelf'),
  shelfStrip: mustGet('shelfStrip'),
  drop: mustGet<HTMLLabelElement>('drop'),
  file: mustGet<HTMLInputElement>('file'),
};

async function sampleToBitmap(s: Sample): Promise<Bitmap> {
  return normalizeTo16x9(await svgToImage(s.svg));
}

/**
 * Yield to the compositor so the "measuring…" state actually paints.
 *
 * Raced against a timer on purpose: requestAnimationFrame does NOT fire in a
 * backgrounded or hidden tab, so awaiting it alone means the app never boots for
 * anyone who opens the link in a background tab and switches to it later. The
 * timer guarantees forward progress; the rAF keeps the paint smooth when visible.
 */
const nextFrame = () => new Promise<void>((resolve) => {
  let settled = false;
  const finish = () => { if (!settled) { settled = true; resolve(); } };
  requestAnimationFrame(finish);
  setTimeout(finish, 50);
});

async function setImage(bitmap: Bitmap, label: string): Promise<void> {
  state.bitmap = bitmap;
  state.label = label;
  document.body.classList.add('busy');
  await nextFrame();

  try {
    const report = analyze(bitmap);
    state.report = report;

    renderScore(nodes.score, report);
    clear(nodes.wall).append(renderWall(bitmap, report));
    renderChecks(nodes.checks, report);
    clear(nodes.diagnostic).append(renderDiagnostic(bitmap, report));

    clear(nodes.repairOut);
    clear(nodes.repairWall);
    nodes.repairBtn.disabled = false;
    nodes.repairBtn.textContent = 'Repair & re-measure';

    renderShelfPanel(bitmap, label);
  } finally {
    document.body.classList.remove('busy');
  }
}

function renderShelfPanel(bitmap: Bitmap, label: string): void {
  const candidate = signature(label || 'this thumbnail', bitmap);
  renderShelf(nodes.shelf, shelfTest(candidate, state.catalogue));
}

function thumbStrip(items: { id: string; bitmap: Bitmap; candidate?: boolean }[]): HTMLElement {
  const wrap = el('div', { class: 'strip' });
  for (const it of items) {
    const small = resizeLanczos(it.bitmap, 160, 90);
    const c = bitmapToCanvas(small);
    c.style.width = '160px';
    c.style.height = '90px';
    const fig = el('figure', { class: it.candidate ? 'is-candidate' : '' });
    fig.append(c, el('figcaption', {}, it.candidate ? `${it.id} (this one)` : it.id));
    wrap.append(fig);
  }
  return wrap;
}

async function buildCatalogue(): Promise<void> {
  const items: { id: string; bitmap: Bitmap }[] = [];
  for (const s of BACK_CATALOGUE) {
    items.push({ id: s.id, bitmap: await sampleToBitmap(s) });
  }
  state.catalogue = items.map((i) => signature(i.id, i.bitmap));
  clear(nodes.shelfStrip).append(thumbStrip(items));
  if (state.bitmap) renderShelfPanel(state.bitmap, state.label);
}

function onRepair(): void {
  const { bitmap, report } = state;
  if (!bitmap || !report) return;

  document.body.classList.add('busy');
  void nextFrame().then(() => {
    try {
      const result: RepairResult = repair(bitmap, report);
      const after = analyze(result.bitmap);
      renderRepair(nodes.repairOut, result, report.score, after.score);
      clear(nodes.repairWall).append(renderWall(result.bitmap, after));
      renderScore(nodes.score, after, report.score);
      renderChecks(nodes.checks, after);
      clear(nodes.diagnostic).append(renderDiagnostic(result.bitmap, after));

      // The repaired image becomes the working image, so the shelf test and any
      // further action operate on what the creator would actually ship.
      state.bitmap = result.bitmap;
      state.report = after;
      renderShelfPanel(result.bitmap, state.label);
      nodes.repairBtn.disabled = true;
      nodes.repairBtn.textContent = 'Repaired';
    } finally {
      document.body.classList.remove('busy');
    }
  });
}

function buildSampleChips(): void {
  clear(nodes.samples);
  for (const s of SAMPLES) {
    const chip = el('button', { class: 'chip', type: 'button', 'aria-pressed': 'false' });
    chip.append(el('span', { class: `chip__dot chip__dot--${s.expect}` }), document.createTextNode(s.title));
    chip.title = s.teaches;
    chip.addEventListener('click', () => {
      for (const other of nodes.samples.querySelectorAll('.chip')) {
        other.setAttribute('aria-pressed', 'false');
      }
      chip.setAttribute('aria-pressed', 'true');
      void sampleToBitmap(s).then((b) => setImage(b, s.id));
    });
    nodes.samples.append(chip);
  }
}

function wireDropZone(): void {
  nodes.file.addEventListener('change', () => {
    const f = nodes.file.files?.[0];
    if (f) void fileToBitmap(f).then((b) => setImage(b, f.name));
  });

  for (const type of ['dragenter', 'dragover'] as const) {
    nodes.drop.addEventListener(type, (e) => {
      e.preventDefault();
      nodes.drop.classList.add('is-over');
    });
  }
  for (const type of ['dragleave', 'drop'] as const) {
    nodes.drop.addEventListener(type, () => nodes.drop.classList.remove('is-over'));
  }
  nodes.drop.addEventListener('drop', (e) => {
    e.preventDefault();
    const f = e.dataTransfer?.files?.[0];
    if (f) void fileToBitmap(f).then((b) => setImage(b, f.name));
  });

  // Paste straight from a design tool — the fastest path for a real creator.
  window.addEventListener('paste', (e) => {
    const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'));
    const f = item?.getAsFile();
    if (f) void fileToBitmap(f).then((b) => setImage(b, 'pasted image'));
  });
}

async function boot(): Promise<void> {
  buildSampleChips();
  wireDropZone();
  nodes.repairBtn.addEventListener('click', onRepair);

  // Open on a thumbnail that fails AND that the repair pass can genuinely improve,
  // so the first screen carries a real number and the first click carries a real delta.
  const first = SAMPLES.find((s) => s.id === 'low-contrast')
    ?? SAMPLES.find((s) => s.expect === 'fail')
    ?? SAMPLES[0];
  if (first) {
    const chips = [...nodes.samples.querySelectorAll('.chip')];
    const idx = SAMPLES.findIndex((s) => s.id === first.id);
    chips[idx >= 0 ? idx : 0]?.setAttribute('aria-pressed', 'true');
    await setImage(await sampleToBitmap(first), first.id);
  }
  await buildCatalogue();
}

void boot();

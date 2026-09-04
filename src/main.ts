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
  notice: mustGet('notice'),
};

/** Largest source we will decode. Beyond this, browsers start failing silently. */
const MAX_FILE_BYTES = 32 * 1024 * 1024;

function showNotice(title: string, body: string, kind: 'error' | 'info' = 'error'): void {
  clear(nodes.notice);
  nodes.notice.className = kind === 'info' ? 'notice notice--info' : 'notice';
  nodes.notice.append(el('b', {}, title), document.createTextNode(body));
  nodes.notice.hidden = false;
}

function hideNotice(): void {
  nodes.notice.hidden = true;
  clear(nodes.notice);
}

/**
 * Every entry point funnels through here. A dropped file that is not a decodable
 * image used to reject into the void: nothing rendered, nothing said, and an
 * unhandled rejection in the console. Silence is the worst possible response to
 * someone trying their own thumbnail.
 */
function loadUserFile(file: File): void {
  hideNotice();

  if (file.size > MAX_FILE_BYTES) {
    showNotice('That file is too large to decode.',
      ` ${(file.size / 1048576).toFixed(1)} MB exceeds the ${MAX_FILE_BYTES / 1048576} MB ceiling. Export your thumbnail at 1280x720 and try again — YouTube caps uploads at 2 MB from mobile anyway.`);
    return;
  }

  if (file.type && !file.type.startsWith('image/')) {
    showNotice('That is not an image.',
      ` "${file.name}" is ${file.type}. Drop a PNG, JPG or WebP thumbnail.`);
    return;
  }

  void fileToBitmap(file)
    .then((b) => setImage(b, file.name))
    .catch((err: unknown) => {
      const detail = err instanceof Error ? err.message : String(err);
      showNotice('Could not decode that image.',
        ` "${file.name}" did not load. It may be corrupt, or a format this browser cannot read. Original error: ${detail}`);
    });
}

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

    // A text-free thumbnail is a legitimate result, but the check list collapses to
    // two rows and that reads like a failure. Say what happened instead.
    const confident = report.textRegions.filter((r) => r.confidence >= 0.5);
    if (confident.length === 0) {
      showNotice('No text detected in this thumbnail.',
        ' Legibility, contrast and badge-collision checks need text to measure, so they are omitted. If your thumbnail does have a headline, it may be too stylised for stroke-width detection to segment — the diagnostic panel shows exactly what was found.',
        'info');
    }

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
      hideNotice();
      void sampleToBitmap(s)
        .then((b) => setImage(b, s.id))
        .catch(() => showNotice('Could not render that sample.', ' Reload the page and try again.'));
    });
    nodes.samples.append(chip);
  }
}

function wireDropZone(): void {
  nodes.file.addEventListener('change', () => {
    const f = nodes.file.files?.[0];
    if (f) loadUserFile(f);
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
    if (f) loadUserFile(f);
  });

  // Paste straight from a design tool — the fastest path for a real creator.
  window.addEventListener('paste', (e) => {
    const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'));
    const f = item?.getAsFile();
    if (f) loadUserFile(f);
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

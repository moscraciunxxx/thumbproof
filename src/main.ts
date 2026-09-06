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
import { renderScore, renderChecks, renderRepair, renderShelf, renderAdvice, renderScoringModel } from './ui/panels';
import { advise } from './core/advice';
import { rankFeed } from './core/feed';
import { parseYouTubeId } from './core/ytimg';
import { bitmapFromYouTube } from './ui/bitmap';
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
  repairTop: mustGet<HTMLButtonElement>('repairTop'),
  repairOut: mustGet('repairOut'),
  repairWall: mustGet('repairWall'),
  shelf: mustGet('shelf'),
  shelfStrip: mustGet('shelfStrip'),
  drop: mustGet<HTMLLabelElement>('drop'),
  file: mustGet<HTMLInputElement>('file'),
  notice: mustGet('notice'),
  ytUrl: mustGet<HTMLInputElement>('ytUrl'),
  ytGo: mustGet<HTMLButtonElement>('ytGo'),
  advice: mustGet('advice'),
  downloads: mustGet('downloads'),
  model: mustGet('model'),
  abDrop: mustGet<HTMLLabelElement>('abDrop'),
  abFile: mustGet<HTMLInputElement>('abFile'),
  abOut: mustGet('abOut'),
  rivalUrls: mustGet<HTMLInputElement>('rivalUrls'),
  rivalGo: mustGet<HTMLButtonElement>('rivalGo'),
  feedStrip: mustGet('feedStrip'),
  feedOut: mustGet('feedOut'),
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
    nodes.repairTop.disabled = false;
    nodes.repairBtn.textContent = 'Repair & re-measure';
    nodes.repairTop.textContent = 'Repair & re-measure';

    // A text-free thumbnail is a legitimate result, but the check list collapses to
    // two rows and that reads like a failure. Say what happened instead.
    const confident = report.textRegions.filter((r) => r.confidence >= 0.5);
    if (confident.length === 0) {
      showNotice('No text detected in this thumbnail.',
        ' Legibility, contrast and badge-collision checks need text to measure, so they are omitted. If your thumbnail does have a headline, it may be too stylised for stroke-width detection to segment — the diagnostic panel shows exactly what was found.',
        'info');
    }

    renderAdvice(nodes.advice, advise(bitmap, report));
    renderScoringModel(nodes.model, report);
    renderDownloads(bitmap, report, label);
    renderShelfPanel(bitmap, label);
  } finally {
    document.body.classList.remove('busy');
  }
}

/**
 * Let the creator keep the result. The tool solves a scrim opacity, recrops and
 * re-scores — and without this the only way to get any of that out was a screenshot.
 */
function renderDownloads(bitmap: Bitmap, report: Report, label: string): void {
  clear(nodes.downloads);
  const safe = (label || 'thumbnail').replace(/[^a-z0-9._-]+/gi, '-').slice(0, 48);

  const pngBtn = el('button', { class: 'btn btn--sm', type: 'button' }, 'Download this thumbnail (PNG)');
  pngBtn.addEventListener('click', () => {
    bitmapToCanvas(bitmap).toBlob((b) => { if (b) saveBlob(b, `thumbproof-${safe}.png`); }, 'image/png');
  });

  const jsonBtn = el('button', { class: 'btn btn--sm btn--ghost', type: 'button' }, 'Download the measurements (JSON)');
  jsonBtn.addEventListener('click', () => {
    const payload = {
      tool: 'ThumbProof',
      source: label,
      fingerprint: report.fingerprint,
      score: report.score,
      measuredAt: new Date().toISOString(),
      checks: report.checks.map((c) => ({
        id: c.id, status: c.status, value: c.value, unit: c.unit,
        threshold: c.threshold, weight: c.weight, penalty: c.penalty, advisory: c.advisory ?? false,
      })),
      textRegions: report.textRegions.length,
      faces: report.faces.length,
    };
    saveBlob(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
      `thumbproof-${safe}.json`);
  });

  nodes.downloads.append(pngBtn, jsonBtn);
}

function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  // Revoke on the next tick so the navigation has started.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Load the real thumbnail for a pasted YouTube link.
 * The id also becomes a permalink (?v=...), so a result can be shared or reopened —
 * for a YouTube-sourced thumbnail the id reproduces the exact input, which is the
 * only honest way to make a result shareable without uploading anyone's image.
 */
async function loadFromYouTube(raw: string, pushUrl = true): Promise<void> {
  const id = parseYouTubeId(raw);
  if (!id) {
    showNotice('That does not look like a YouTube link.',
      ' Paste a full watch, youtu.be, Shorts or embed URL — or just the 11-character video id.');
    return;
  }
  hideNotice();
  nodes.ytGo.disabled = true;
  nodes.ytGo.textContent = 'Fetching…';
  try {
    const { bitmap, variant } = await bitmapFromYouTube(id);
    if (pushUrl) {
      const u = new URL(window.location.href);
      u.searchParams.set('v', id);
      history.replaceState(null, '', u.toString());
    }
    await setImage(bitmap, id);
    showNotice(`Loaded ${variant.name} (${variant.width}×${variant.height}) for ${id}.`,
      ' Fetched from YouTube\u2019s public image CDN directly into this page. This URL now permalinks the result.',
      'info');
  } catch (err) {
    showNotice('Could not load that thumbnail.',
      ` ${err instanceof Error ? err.message : String(err)}. Private, deleted and age-restricted videos do not expose a public thumbnail.`);
  } finally {
    nodes.ytGo.disabled = false;
    nodes.ytGo.textContent = 'Fetch';
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
      nodes.repairTop.disabled = true;
      nodes.repairBtn.textContent = 'Repaired';
      nodes.repairTop.textContent = 'Repaired';
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

function wireYouTube(): void {
  const go = () => void loadFromYouTube(nodes.ytUrl.value.trim());
  nodes.ytGo.addEventListener('click', go);
  nodes.ytUrl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
  // Pasting a link is the whole interaction — do not make them press a button too.
  nodes.ytUrl.addEventListener('paste', () => setTimeout(go, 0));
}

/**
 * A/B: measure every variant against the same thresholds and rank by what survives
 * delivery. Creators choose thumbnails by looking at them at full size, which is the
 * one size no viewer ever sees them at.
 */
async function runCompare(files: File[]): Promise<void> {
  clear(nodes.abOut);
  if (files.length < 2) {
    nodes.abOut.append(el('p', { class: 'advice__none' }, 'Drop at least two variants — #1 is the one that survives delivery.'));
    return;
  }
  document.body.classList.add('busy');
  await nextFrame();
  try {
    const rows: { name: string; bitmap: Bitmap; report: Report }[] = [];
    for (const f of files.slice(0, 4)) {
      const bmp = await fileToBitmap(f);
      rows.push({ name: f.name.replace(/\.[^.]+$/, '').slice(0, 28), bitmap: bmp, report: analyze(bmp) });
    }
    rows.sort((a, b) => b.report.score - a.report.score || a.name.localeCompare(b.name));

    const wrap = el('div', { class: 'ab' });
    rows.forEach((r, i) => {
      const band = r.report.score >= 75 ? 'pass' : r.report.score >= 45 ? 'warn' : 'fail';
      const card = el('figure', { class: `ab__card ab__card--${band}` });
      const tile = bitmapToCanvas(resizeLanczos(r.bitmap, 320, 180));
      tile.style.width = '320px'; tile.style.height = '180px';
      const fails = r.report.checks.filter((c) => c.status === 'fail');
      card.append(
        el('figcaption', { class: 'ab__head' },
          el('span', { class: 'ab__rank' }, i === 0 ? 'Upload this — survives delivery' : `#${i + 1}`),
          el('span', { class: 'ab__name' }, r.name),
          el('span', { class: `ab__score ab__score--${band}` }, String(r.report.score)),
        ),
        tile,
        el('p', { class: 'ab__why' },
          fails.length === 0
            ? 'Nothing failing at delivered size.'
            : `Fails: ${fails.map((c) => `${c.id} (${c.value} ${c.unit})`).join(', ')}`),
      );
      wrap.append(card);
    });

    const best = rows[0]!;
    const worst = rows[rows.length - 1]!;
    nodes.abOut.append(
      el('p', { class: 'ab__verdict' },
        `"${best.name}" survives delivery best at ${best.report.score}, against ${worst.report.score} for "${worst.name}". `
        + 'Ranked on what reaches the viewer, not on what looks strongest at full size.'),
      wrap,
    );
  } finally {
    document.body.classList.remove('busy');
  }
}

function wireCompare(): void {
  nodes.abFile.addEventListener('change', () => {
    const f = [...(nodes.abFile.files ?? [])];
    if (f.length) void runCompare(f);
  });
  for (const t of ['dragenter', 'dragover'] as const) {
    nodes.abDrop.addEventListener(t, (e) => { e.preventDefault(); nodes.abDrop.classList.add('is-over'); });
  }
  for (const t of ['dragleave', 'drop'] as const) {
    nodes.abDrop.addEventListener(t, () => nodes.abDrop.classList.remove('is-over'));
  }
  nodes.abDrop.addEventListener('drop', (e) => {
    e.preventDefault();
    const f = [...(e.dataTransfer?.files ?? [])].filter((x) => x.type.startsWith('image/'));
    if (f.length) void runCompare(f);
  });
}

/** Build the suggested rail this thumbnail will actually appear in, and rank it. */
async function runFeed(raw: string): Promise<void> {
  const ids = [...new Set(raw.split(/[\s,]+/).map((t) => parseYouTubeId(t)).filter((x): x is string => !!x))];
  clear(nodes.feedOut);
  clear(nodes.feedStrip);
  if (ids.length < 2) {
    nodes.feedOut.append(el('p', { class: 'advice__none' },
      'Paste at least two YouTube links — the ranking depends on the company your thumbnail keeps.'));
    return;
  }
  if (!state.bitmap) return;

  nodes.rivalGo.disabled = true;
  nodes.rivalGo.textContent = 'Building…';
  document.body.classList.add('busy');
  await nextFrame();
  try {
    const items: { id: string; bitmap: Bitmap }[] = [{ id: 'yours', bitmap: state.bitmap }];
    const failed: string[] = [];
    for (const id of ids.slice(0, 8)) {
      try { items.push({ id, bitmap: (await bitmapFromYouTube(id)).bitmap }); }
      catch { failed.push(id); }
    }
    if (items.length < 3) {
      nodes.feedOut.append(el('p', { class: 'advice__none' },
        'Could not load enough of those thumbnails to build a column.'));
      return;
    }

    const result = rankFeed(items, 'yours');
    const order = result.entries.map((e) => items.find((i) => i.id === e.id)!).filter(Boolean);
    nodes.feedStrip.append(thumbStrip(order.map((i) => ({ ...i, candidate: i.id === 'yours' }))));

    const table = el('table', { class: 'shelf__table' });
    table.append(el('thead', {}, el('tr', {},
      el('th', {}, '#'), el('th', {}, 'video'), el('th', {}, 'glance pull'),
      el('th', {}, 'contrast energy'), el('th', {}, 'colour punch'), el('th', {}, 'oddity'))));
    const body = el('tbody');
    result.entries.forEach((e, i) => {
      body.append(el('tr', { class: e.id === 'yours' ? 'is-close' : '' },
        el('td', {}, String(i + 1)), el('td', {}, e.id),
        el('td', {}, String(e.glancePull)), el('td', {}, String(e.contrastEnergy)),
        el('td', {}, String(e.colourPunch)), el('td', {}, String(e.oddity))));
    });
    table.append(body);

    nodes.feedOut.append(el('p', { class: 'shelf__detail' }, result.detail), table);
    if (failed.length) {
      nodes.feedOut.append(el('p', { class: 'advice__none' },
        `Skipped ${failed.length}: no public thumbnail (private, deleted or age-restricted).`));
    }
  } finally {
    nodes.rivalGo.disabled = false;
    nodes.rivalGo.textContent = 'Build the column';
    document.body.classList.remove('busy');
  }
}

function wireFeed(): void {
  const go = () => void runFeed(nodes.rivalUrls.value);
  nodes.rivalGo.addEventListener('click', go);
  nodes.rivalUrls.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
}

async function boot(): Promise<void> {
  buildSampleChips();
  wireDropZone();
  wireYouTube();
  wireCompare();
  wireFeed();
  nodes.repairBtn.addEventListener('click', onRepair);
  nodes.repairTop.addEventListener('click', onRepair);

  // A ?v= permalink reproduces a result exactly, so honour it before the sample.
  const shared = new URL(window.location.href).searchParams.get('v');
  if (shared && parseYouTubeId(shared)) {
    await loadFromYouTube(shared, false);
    await buildCatalogue();
    return;
  }

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

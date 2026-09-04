/** Result panels: the score, the measured checks, the repair diff, the shelf test. */

import type { Report, CheckResult } from '../core/types';
import type { RepairResult } from '../core/repair';
import type { ShelfReport } from '../core/shelf';
import { el, clear } from './dom';

function statusGlyph(s: CheckResult['status']) {
  return s === 'pass' ? '✓' : s === 'warn' ? '!' : '✕';
}

export function renderScore(host: HTMLElement, report: Report, previous?: number): void {
  clear(host);
  const band = report.score >= 75 ? 'pass' : report.score >= 45 ? 'warn' : 'fail';

  const dial = el('div', { class: `score score--${band}` });
  if (previous !== undefined && previous !== report.score) {
    dial.append(
      el('span', { class: 'score__was' }, String(previous)),
      el('span', { class: 'score__arrow' }, '→'),
    );
  }
  dial.append(
    el('span', { class: 'score__num' }, String(report.score)),
    el('span', { class: 'score__den' }, '/100'),
  );

  host.append(
    dial,
    el('div', { class: 'score__meta' },
      el('div', { class: 'score__verdict' },
        band === 'fail' ? 'Will not survive delivery'
          : band === 'warn' ? 'Survives, but leaks readers'
            : 'Survives delivery intact'),
      el('div', { class: 'score__fine' },
        `${report.checks.filter((c) => c.status === 'fail').length} failing · ${report.textRegions.length} text regions found · measured on-device in ${report.elapsedMs} ms · fingerprint ${report.fingerprint}`),
    ),
  );
}

export function renderChecks(host: HTMLElement, report: Report): void {
  clear(host);
  const order = { fail: 0, warn: 1, pass: 2 } as const;
  const sorted = [...report.checks].sort(
    (a, b) => order[a.status] - order[b.status] || b.weight - a.weight || a.id.localeCompare(b.id),
  );

  for (const c of sorted) {
    const row = el('li', { class: `check check--${c.status}` });
    row.append(
      el('span', { class: 'check__glyph', 'aria-hidden': 'true' }, statusGlyph(c.status)),
      el('div', { class: 'check__body' },
        el('div', { class: 'check__head' },
          el('span', { class: 'check__label' }, c.label),
          el('span', { class: 'check__value' }, `${c.value} ${c.unit}`),
        ),
        el('p', { class: 'check__detail' }, c.detail),
      ),
    );
    host.append(row);
  }
}

export function renderRepair(
  host: HTMLElement,
  result: RepairResult,
  before: number,
  after: number,
): void {
  clear(host);
  const delta = after - before;
  host.append(
    el('div', { class: 'repair__headline' },
      el('span', { class: 'repair__delta' }, `${before} → ${after}`),
      el('span', { class: 'repair__deltaNote' },
        delta > 0 ? `+${delta} points, no generative model involved`
          : 'No deterministic repair could improve this one'),
    ),
  );

  const list = el('ul', { class: 'repair__steps' });
  for (const s of result.steps) {
    list.append(el('li', { class: `repair__step repair__step--${s.applied ? 'on' : 'off'}` },
      el('span', { class: 'repair__stepName' }, s.id === 'scrim' ? 'Contrast scrim' : 'Punch-in recrop'),
      el('span', { class: 'repair__stepDetail' }, s.detail),
    ));
  }
  host.append(list);
}

export function renderShelf(host: HTMLElement, shelf: ShelfReport): void {
  clear(host);
  const band = shelf.distinctiveness >= 50 ? 'pass' : shelf.distinctiveness >= 25 ? 'warn' : 'fail';

  host.append(
    el('div', { class: `shelf__score shelf__score--${band}` },
      el('span', { class: 'shelf__num' }, String(shelf.distinctiveness)),
      el('span', { class: 'shelf__unit' }, '% distinct from your own catalogue'),
    ),
    el('p', { class: 'shelf__detail' }, shelf.detail),
  );

  if (shelf.neighbours.length > 0) {
    const table = el('table', { class: 'shelf__table' });
    table.append(el('thead', {}, el('tr', {},
      el('th', {}, 'Your video'),
      el('th', {}, 'Similar'),
      el('th', {}, 'dHash bits differ'),
      el('th', {}, 'Palette dist.'),
      el('th', {}, 'Layout dist.'),
    )));
    const body = el('tbody');
    for (const n of shelf.neighbours) {
      body.append(el('tr', { class: n.similarity >= 75 ? 'is-close' : '' },
        el('td', {}, n.id),
        el('td', {}, `${n.similarity}%`),
        el('td', {}, `${n.dhashHamming}/64`),
        el('td', {}, n.paletteDistance.toFixed(3)),
        el('td', {}, n.layoutDistance.toFixed(3)),
      ));
    }
    table.append(body);
    host.append(table);
  }
}

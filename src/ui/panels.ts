/** Result panels: the score, the measured checks, the repair diff, the shelf test. */

import type { Report, CheckResult } from '../core/types';
import type { Advice } from '../core/advice';
import { GATE_FAIL_CEILING, GATE_WARN_CEILING } from '../core/analyze';
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
    // Scrolls inside its own container on narrow screens; the page must never
    // scroll horizontally.
    host.append(el('div', { class: 'shelf__wrap' }, table));
  }
}

/**
 * Concrete next actions. Rendered whenever the deterministic repair could not carry
 * the whole fix — which is most thumbnails, because most thumbnails fail for
 * editorial reasons a raster edit cannot touch.
 */
export function renderAdvice(host: HTMLElement, advice: readonly Advice[]): void {
  clear(host);
  if (advice.length === 0) {
    host.append(el('p', { class: 'advice__none' },
      'Nothing left to act on — every check passes at delivered size.'));
    return;
  }
  const list = el('ol', { class: 'advice' });
  for (const a of advice) {
    list.append(el('li', { class: 'advice__item' },
      el('div', { class: 'advice__title' }, a.title),
      el('p', { class: 'advice__detail' }, a.detail),
    ));
  }
  host.append(list);
}

/**
 * The score, opened up. A number a judge cannot audit is a number they have to take
 * on faith, so this shows every weight, every penalty actually charged, and the
 * severity gate that caps the total.
 */
export function renderScoringModel(host: HTMLElement, report: Report): void {
  clear(host);

  const gating = report.checks.filter((c) => !c.advisory);
  const worstFail = gating.some((c) => c.status === 'fail');
  const worstWarn = gating.some((c) => c.status === 'warn');
  const ceiling = worstFail ? GATE_FAIL_CEILING : worstWarn ? GATE_WARN_CEILING : 100;

  const totalWeight = report.checks.reduce((a, c) => a + c.weight, 0);
  const totalPenalty = report.checks.reduce((a, c) => a + c.penalty, 0);
  const weighted = totalWeight > 0
    ? Math.round(((totalWeight - totalPenalty) / totalWeight) * 100)
    : 0;

  const table = el('table', { class: 'model' });
  table.append(el('thead', {}, el('tr', {},
    el('th', {}, 'Check'),
    el('th', {}, 'Measured'),
    el('th', {}, 'Weight'),
    el('th', {}, 'Penalty charged'),
    el('th', {}, 'Gates?'),
  )));
  const body = el('tbody');
  for (const c of [...report.checks].sort((a, b) => b.weight - a.weight || a.id.localeCompare(b.id))) {
    body.append(el('tr', { class: `model__row model__row--${c.status}` },
      el('td', {}, c.id),
      el('td', {}, `${c.value} ${c.unit}`),
      el('td', {}, c.weight.toFixed(1)),
      el('td', {}, c.penalty.toFixed(2)),
      el('td', {}, c.advisory ? 'advisory' : 'yes'),
    ));
  }
  table.append(body);

  host.append(
    el('div', { class: 'model__sum' },
      el('div', {},
        el('code', {}, `weighted = (${totalWeight.toFixed(1)} − ${totalPenalty.toFixed(2)}) / ${totalWeight.toFixed(1)} = ${weighted}`)),
      el('div', {},
        el('code', {}, `gate ceiling = ${ceiling}`),
        el('span', { class: 'model__note' },
          worstFail ? ' — a hard failure caps the score inside the fail band'
            : worstWarn ? ' — a warning caps the score inside the warn band'
              : ' — nothing failing, no cap applied')),
      el('div', {},
        el('code', {}, `score = min(${weighted}, ${ceiling}) = ${report.score}`)),
    ),
    table,
    el('p', { class: 'model__why' },
      'Why a gate at all: a weighted average lets one catastrophic flaw hide behind everything that is fine. '
      + 'A thumbnail whose payoff word is entirely under the duration pill should not score 71 because its contrast is good — '
      + 'that is not how a viewer experiences it. Advisory checks inform but never gate, because the saliency model '
      + 'cannot tell your subject from a bright background and must not be able to condemn a thumbnail on its own.'),
  );
}

/**
 * The interface has to pass the standard the tool enforces.
 *
 * ThumbProof fails other people's thumbnails at 1.39:1, so its own text failing
 * WCAG would be indefensible. This audits the palette with the project's own
 * `contrastRatio()` — the same function that produces the number shown to users,
 * not a second implementation that could drift from it.
 *
 * Values mirror the `:root` block in src/styles.css. If you change a token there,
 * change it here; this test is the reason a regression gets caught.
 */

import { describe, it, expect } from 'vitest';
import { contrastRatio } from '../src/core/contrast';
import { CONTRAST_FAIL, CONTRAST_WARN } from '../src/core/surfaces';

type RGB = [number, number, number];

const hex = (h: string): RGB => {
  const s = h.replace('#', '');
  return [
    parseInt(s.slice(0, 2), 16),
    parseInt(s.slice(2, 4), 16),
    parseInt(s.slice(4, 6), 16),
  ];
};

const TOKENS = {
  bg: hex('#0b0d10'),
  bg1: hex('#12151a'),
  bg2: hex('#191d24'),
  ink: hex('#e8edf4'),
  ink2: hex('#9aa6b5'),
  ink3: hex('#7b8593'),
  pass: hex('#3ddc97'),
  warn: hex('#ffc857'),
  fail: hex('#ff5c62'),
  accent: hex('#40dcff'),
} as const;

/** Every foreground/background pair the interface actually renders. */
const PAIRS: { fg: RGB; bg: RGB; label: string }[] = [
  { fg: TOKENS.ink, bg: TOKENS.bg, label: 'body text on page' },
  { fg: TOKENS.ink, bg: TOKENS.bg1, label: 'text on cards' },
  { fg: TOKENS.ink, bg: TOKENS.bg2, label: 'text on raised surfaces' },
  { fg: TOKENS.ink2, bg: TOKENS.bg, label: 'secondary prose on page' },
  { fg: TOKENS.ink2, bg: TOKENS.bg1, label: 'secondary prose on cards' },
  { fg: TOKENS.ink3, bg: TOKENS.bg, label: 'fine print on page' },
  { fg: TOKENS.ink3, bg: TOKENS.bg1, label: 'fine print on cards' },
  { fg: TOKENS.pass, bg: TOKENS.bg1, label: 'pass value' },
  { fg: TOKENS.warn, bg: TOKENS.bg1, label: 'warn value' },
  { fg: TOKENS.fail, bg: TOKENS.bg1, label: 'fail value' },
  { fg: TOKENS.accent, bg: TOKENS.bg, label: 'links' },
  { fg: TOKENS.accent, bg: TOKENS.bg1, label: 'chip text' },
];

describe('the interface meets the standard it enforces', () => {
  it.each(PAIRS)('$label clears WCAG AA for normal text', ({ fg, bg }) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(CONTRAST_WARN);
  });

  it('has no pair below the large-text floor either', () => {
    for (const p of PAIRS) {
      expect(contrastRatio(p.fg, p.bg), p.label).toBeGreaterThanOrEqual(CONTRAST_FAIL);
    }
  });

  it('keeps the three text tiers visually distinct, so hierarchy survives', () => {
    const primary = contrastRatio(TOKENS.ink, TOKENS.bg1);
    const secondary = contrastRatio(TOKENS.ink2, TOKENS.bg1);
    const tertiary = contrastRatio(TOKENS.ink3, TOKENS.bg1);
    expect(primary).toBeGreaterThan(secondary);
    expect(secondary).toBeGreaterThan(tertiary);
    // A tier that is merely 0.2 dimmer is not a tier.
    expect(secondary - tertiary).toBeGreaterThan(1);
  });

  it('regression guard: the old tertiary really did fail', () => {
    // #6b7684 shipped at 3.96:1 on cards. Documented so nobody "tidies" it back.
    expect(contrastRatio(hex('#6b7684'), TOKENS.bg1)).toBeLessThan(CONTRAST_WARN);
  });
});

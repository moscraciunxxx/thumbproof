# Measured results

Every number below was read off an actual run. Reproduce them by opening the tool
and clicking the named sample, or by opening `selftest.html`, which runs the whole
table live in your browser.

Recorded 2026-09-04, production build, after the SWT polarity fix and the
solitary-component confidence correction.

## Self-test — 6/6 samples land on their authored verdict

| Sample | Authored | Score | Verdict | Repaired | Δ | Primary failure |
|---|---|---|---|---|---|---|
| `wall-of-text` | fail | **44** | fail | 44 | +0 | 74% of text area below 7 px |
| `low-contrast` | fail | **44** | fail | **74** | **+30** | 1.39:1 contrast |
| `badge-collision` | fail | **44** | fail | 44 | +0 | 62.6% of a text block under the pill |
| `detail-collapse` | fail | **44** | fail | 44 | +0 | SSIM 0.743; 3.7 px cap height |
| `edge-bleed` | warn | **74** | warn | 74 | +0 | 10.3% past the safe margin |
| `clean` | pass | **99** | pass | 99 | +0 | none |

## The repair demo (`low-contrast`, the boot sample)

```
44  →  74        +30 points, no generative model involved
failing checks   →  0
```

- **Contrast scrim** — "Solved a 52% dark scrim behind 6 text blocks — the minimum that reaches 4.5:1."
- **Punch-in recrop** — "Recropped 28% tighter around your headline and attention peak — delivers the same type 1.39× larger (6.6px → 9.2px on Desktop suggested sidebar)."

The scrim opacity is binary-searched, not guessed, and masked off the glyph pixels via
a per-region Otsu cut — a scrim laid over everything scales foreground and background
together and barely moves the ratio at all, which is a tint, not a fix.

## Where repair correctly refuses

`wall-of-text` and `detail-collapse` are left at 44 on purpose. Their text is spread
corner to corner, so no 16:9 crop delivers it larger without dropping part of it, and
their contrast is already fine. The tool says so instead of pretending:

> "Your text is spread across the whole frame, so no 16:9 crop delivers it larger
> without dropping part of it. This one cannot be fixed by cropping — it needs fewer,
> bigger words."

Their problems are editorial (too many words) and compositional (too busy). A tool that
claimed to fix those mechanically would be lying.

## Shelf test

| Comparison | Distinctiveness | Nearest | dHash bits differing |
|---|---|---|---|
| `catalogue-1` vs its 4 siblings | **0** (want low) | `catalogue-5` at **100%** similar | **0 / 64** |
| `clean` vs the 5-entry catalogue | **57** (want high) | `catalogue-1` at 43% similar | 29 / 64 |

Five thumbnails from one channel built on the same template are bit-identical under
dHash. Stacked in a sidebar they read as one video.

## Performance and size

| | |
|---|---|
| Full analysis, 1280×720, visible tab | **~250 ms** on-device |
| First-paint payload, gzipped | **26.4 KB** (18.2 KB core + 4.1 KB app + 2.7 KB CSS + 2.0 KB HTML) |
| Runtime dependencies | **0** |
| Unit tests | **122 passing**, `tsc --noEmit` clean |

## Detector sanity — reported cap heights against the fonts that drew them

Cap height is measured on the glyph box, so it sits a little above pure cap height when
type is outlined. The point is that the numbers are in the right physical range:

| Sample | Reported sidebar cap | Implied source cap | Font that drew it |
|---|---|---|---|
| `clean` | 15.5 px | ~118 px | 156 px Arial Black (cap ≈ 112 px) |
| `edge-bleed` | 15.8 px | ~120 px | 150 px (cap ≈ 108 px) |
| `badge-collision` | 19.2 px | ~146 px | 152 px (cap ≈ 110 px) |
| `wall-of-text` | 9.5 px | ~72 px | 62 px outlined headline |
| `detail-collapse` | 3.7 px | ~28 px | 15-21 px dashboard labels |

Before the solitary-component fix, `wall-of-text` reported a 162 px source cap — it was
measuring the laptop graphic, not the headline.

## Determinism, verified

The same image produces the same FNV-1a fingerprint and the same score under the dev
server and the production bundle:

```
before repair   51e3852f3cea8e6e   score 44
after repair    c9e442c3293a91a1   score 74
```

Two different bundles, byte-identical results. That is the property that makes
"your headline is 6.6 px tall" a measurement rather than an opinion.

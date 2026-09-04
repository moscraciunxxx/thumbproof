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

## Validation on real JPEG content

Every bundled sample is SVG-drawn, so the detector was also checked against a real
JPEG: a two-colour gradient with film grain and lens blur, real anti-aliased Arial
Black with an outline, encoded by ffmpeg at two quality levels. Regenerate with:

```bash
ffmpeg -f lavfi -i "gradients=s=1280x720:c0=0x123a5e:c1=0xe0642c:x0=120:y0=80:x1=1180:y1=700:nb_colors=2:d=1" \
  -frames:v 1 -vf "noise=alls=14:allf=t+u,gblur=sigma=1.1,drawtext=..." -q:v 3 real-photo-hq.jpg
```

**Cap-height accuracy against the fonts that drew the type:**

| Element | Font | True cap height (~0.72 em) | Detected | Error |
|---|---|---|---|---|
| Headline | 148 px Arial Black | ~106 px | **106 px** | <1% |
| Kicker | 58 px Arial Bold | ~42 px | **44 px** | ~5% |
| Subtitle | 30 px Arial Bold | ~22 px | **20 px** | ~9% |

Contrast measured 10.48:1 for white-with-black-outline over the gradient, and
detail-survival 0.954. Repair correctly declined both steps: the type already clears
4.5:1 and the comfort threshold.

### A sensitivity worth knowing about

The same frame at high and low JPEG quality scored **74** and **99**. The measurements
barely moved — `unreadable-share` 20% vs 14%, both around the 20% warn line — but the
band gate turns a marginal warning into a 25-point headline swing, because compression
artifacts nudge fine text edges and change how the subtitle line is segmented.

This is inherent to any banded score and it is why the per-check numbers, not the
headline score, are the ground truth. Read the rows.

## Determinism, verified

The same image produces the same FNV-1a fingerprint and the same score under the dev
server and the production bundle:

```
before repair   51e3852f3cea8e6e   score 44
after repair    c9e442c3293a91a1   score 74
```

Two different bundles, byte-identical results. That is the property that makes
"your headline is 6.6 px tall" a measurement rather than an opinion.

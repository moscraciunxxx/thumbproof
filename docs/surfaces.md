# Where ThumbProof's numbers come from

Every threshold and dimension the tool reports is listed here with a source and a
confidence level. Anything not sourced is marked **ESTIMATE** in this memo *and* in
`src/core/surfaces.ts`. A wrong number presented as fact is worse than a missing one.

Last checked: 2026-09-04.

---

## 1. Thumbnail upload spec

Per [YouTube Help — Add video thumbnails](https://support.google.com/youtube/answer/72431):

| Property | Value |
|---|---|
| Recommended resolution | 3840 × 2160 (minimum width 640 px) |
| Aspect ratio | 16:9 |
| Max file size | 2 MB uploading from mobile, 50 MB from desktop |
| Formats | JPG, PNG |

Note the spec has moved: the widely-repeated "1280 × 720, 2 MB" figure is out of date
as a *recommendation*, though 1280 × 720 remains the de-facto working size in creator
tooling and is what ThumbProof normalises to internally. Normalising down to 1280 does
not affect any measurement, because every check is computed relative to the frame.

**Confidence: high.**

## 2. The i.ytimg.com derivative ladder

YouTube generates a fixed set of rasters per video. Three of them are 4:3 and letterbox
a 16:9 upload, which is why content pushed to the extreme top or bottom of the frame can
survive on the watch page and vanish in an embed preview.

| Variant | Pixels | Aspect |
|---|---|---|
| `default.jpg` | 120 × 90 | 4:3 |
| `mqdefault.jpg` | 320 × 180 | 16:9 |
| `hqdefault.jpg` | 480 × 360 | 4:3 |
| `sddefault.jpg` | 640 × 480 | 4:3 |
| `hq720.jpg` | 1280 × 720 | 16:9 |
| `maxresdefault.jpg` | 1280 × 720 | 16:9 |

**Confidence: high** (directly verifiable by requesting the URLs for any video id).

## 3. Delivered box sizes, and why pixels are the wrong unit

The five surfaces in `SURFACES`:

| Surface | CSS px box | Confidence |
|---|---|---|
| Mobile home feed | 360 × 202 (full-bleed card on a 360 px viewport) | medium |
| TV | 400 × 225 in a 1920-wide TV UI | medium |
| Desktop suggested sidebar | **168 × 94** | **high** |
| Mobile search result | 168 × 94 (compact list row) | **ESTIMATE** |
| Desktop home grid | 360 × 202 at ~1920 px, four columns | medium |

168 × 94 for the desktop suggested rail is the one number here that is widely and
consistently reported, and it is the **smallest box YouTube delivers a thumbnail into**
([vidIQ](https://vidiq.com/blog/post/youtube-thumbnail-size-measurements/)). All of these
are responsive and vary with viewport, platform version and A/B bucket; treat them as
representative, not universal.

### The finding that actually matters: visual angle, not pixel count

Pixel count is the wrong unit, because the surfaces are viewed from wildly different
distances. What determines whether a human can resolve a glyph is the **visual angle**
it subtends. Reproduce this with `visualAngleDeg()` in `src/core/surfaces.ts`:

| Surface | Screen | Distance | Physical width | **Visual angle** |
|---|---|---|---|---|
| Mobile feed, 360 px | 6.1″ phone (135 mm wide) | 0.35 m | 124.7 mm | **20.19°** |
| Desktop grid, 360 px | 24″ 1920 px (531 mm) | 0.60 m | 99.6 mm | 9.49° |
| **TV, 400 px** | 55″ 1920 px (1218 mm) | **3.0 m** | 253.7 mm | **4.84°** |
| **Sidebar, 168 px** | 24″ 1920 px (531 mm) | 0.60 m | 46.5 mm | **4.44°** |

Two consequences, both counter-intuitive:

1. **The TV has the most pixels and is angularly the second-smallest surface** — 1.09×
   the desktop sidebar. Connected TV is now ~60% of US YouTube watch time, so the
   surface with the largest audience share presents almost exactly the legibility
   problem of the 168 px sidebar.
2. **The phone is the most forgiving surface, not the least** — 20.19°, which is 4.55×
   the sidebar. The common advice to "design for mobile" has it backwards.

So the honest claim is not "most of your audience sees 168 px." It is: *your thumbnail
is comfortable on a phone and marginal in the suggested sidebar and on the TV — and
those are the two surfaces you never check from your desk.*

**Confidence: high for the arithmetic** (it is just trigonometry, and the function is
unit-tested). **Medium for the inputs** — screen sizes and viewing distances are
representative choices, not measured population averages. A 2 m TV distance or a 65″
panel moves the TV row materially.

## 4. Impression share — this is a weighting, not a statistic

`impressionShare` is **ESTIMATE** throughout, and the code says so.

YouTube publishes **watch time by device**; it does not publish **thumbnail impressions
by surface**. Those are different quantities — a thumbnail impression happens in a
browse feed, a search page or a suggested rail, and watch time accrues afterwards. A
20-minute TV session and a 20-second Short both follow exactly one impression.

What is sourced:

- **Connected TV ~60%, mobile ~28%, desktop ~8%, tablet ~4%** of *US* watch time; CTV
  overtook mobile in Q4 2025 ([Variety](https://variety.com/2025/digital/news/youtube-tv-viewing-surpasses-mobile-ceo-neal-mohan-creators-hollywood-startups-1236300440/),
  [netinfluencer](https://www.netinfluencer.com/youtube-reveals-connected-tv-tops-mobile-desktop-watch-time-in-u-s/)).
- **~69–70% of global watch time is mobile** ([Advanced Television](https://www.advanced-television.com/2025/06/25/data-69-of-youtube-viewership-on-mobile-devices/)).

Those two figures disagree because one is US-only and one is global; both are watch time,
neither is impressions. The weights in `SURFACES` are a defensible blend, not a
measurement, and they exist so the score is not dominated by whichever surface happens
to be worst. **Any creator whose analytics show a different mix should reweight them.**

**Confidence: low.** This is the weakest number in the project and it is labelled as such
everywhere it appears.

## 5. Chrome overlaid on the thumbnail

The duration pill and the red watched-progress bar are composited by the *client*, after
upload. They do not exist in the design file, which is exactly why creators put things
underneath them.

Values in `SURFACES[].chrome` are expressed as fractions of the thumbnail box and were
measured from rendered YouTube UI, not from documentation. The pill sits bottom-right and
covers roughly 11–13% of box width on large surfaces and up to ~26% on the 168 px
sidebar — it does not shrink proportionally, so **the smallest surface is also the one
where the badge eats the most of your frame.**

**Confidence: medium. ESTIMATE** — YouTube documents none of this.

## 6. Legibility thresholds

`CAP_HEIGHT_FAIL_PX = 7`, `CAP_HEIGHT_WARN_PX = 11`, in delivered px.

There is no public YouTube-specific study of thumbnail text legibility, so these are
grounded in general screen-typography practice rather than platform data. A ~9 px cap
height corresponds to roughly a 12–13 px font size (cap height is typically ~0.7 em),
which is the conventional lower bound for sustained screen reading. Below about 7 px of
cap height, glyph discrimination degrades sharply at normal viewing distance regardless
of how much contrast you add.

These are **heuristic thresholds from typographic practice, not measured perceptual
limits**, and they are deliberately conservative: the tool warns before it fails.

**Confidence: medium.**

## 7. Contrast

WCAG 2.1 [SC 1.4.3 Contrast (Minimum)](https://www.w3.org/TR/WCAG21/#contrast-minimum):
**4.5:1** for normal text, **3:1** for large text, where large means ≥ 18.66 px bold or
≥ 24 px regular.

A thumbnail headline is unambiguously large text, so 3:1 is the conformance floor —
which is why `CONTRAST_FAIL = 3.0`. ThumbProof still holds thumbnails to 4.5:1 as the
target (`CONTRAST_WARN`), because WCAG's large-text allowance assumes a reader at a
comfortable distance with the text at its authored size, and a thumbnail is neither.

Relative luminance uses the WCAG definition exactly, including the 0.05 offsets.

**Confidence: high.**

## 8. Does any of this actually move clickthrough?

**No credible public study establishes a causal link between thumbnail text legibility
and CTR**, and this project does not claim one.

What exists is platform advice and agency/tool-vendor blog content, all of it either
anecdotal, correlational, or commercially motivated. Vendors have an obvious interest in
"thumbnails matter" being true. Treat every "X% CTR lift" number you find in that
literature as marketing until someone publishes the methodology.

The defensible claim, and the only one ThumbProof makes, is narrower and does not need a
CTR study to stand up:

> Text below ~7 px of cap height cannot be read. Text below 3:1 contrast does not meet
> the accessibility floor. Detail destroyed by the downscale was never delivered.
> Whatever your CTR is, it is not being helped by a headline nobody can resolve.

**Confidence: high in the negative claim** (that no good causal evidence exists).

---

## What we do NOT know

Listed explicitly, because a reviewer who knows YouTube well will spot these anyway:

1. **Real impression distribution by surface.** Not public. § 4 is a weighting.
2. **Exact responsive breakpoints.** Box sizes shift with viewport, client version and
   experiment bucket. The five values are representative snapshots.
3. **Mobile search box size.** ESTIMATE, measured from one viewport on one client version.
4. **What YouTube's own downscaler does.** We simulate with Lanczos-3, which is a good
   general-purpose resampler, but YouTube's exact filter, sharpening and JPEG/WebP
   quality ladder are unpublished. Our SSIM is therefore a *relative* measure of how
   fragile a composition is, not a byte-accurate prediction of the served raster.
5. **Whether 7 px is the right floor.** It comes from typographic practice, not from a
   controlled perceptual study on thumbnails.
6. **Viewing distances.** 0.35 m / 0.60 m / 3.0 m are conventional figures, not measured
   population distributions. The TV row is the most sensitive to this.
7. **Shorts.** 9:16, a different UI, different chrome. Entirely out of scope here.

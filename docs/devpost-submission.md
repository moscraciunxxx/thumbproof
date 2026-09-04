# Devpost submission — ThumbProof

> All numbers below are read off real runs and cross-checked in `docs/MEASURED.md`,
> which `selftest.html` reproduces live in the reader's own browser.

**Project name:** ThumbProof

**Tagline (max ~200 chars):**
You design at 1280 px. The suggested sidebar delivers 168, and a TV at 3 m is angularly no bigger. ThumbProof measures what survives — then repairs it. Entirely in your browser.

**Built with:** typescript, vite, vitest, canvas, computer-vision, stroke-width-transform, spectral-residual-saliency, ssim, lanczos, wcag, github-pages

**Try it:** https://moscraciunxxx.github.io/thumbproof/
**Repo:** https://github.com/moscraciunxxx/thumbproof

---

## Inspiration

Creators check their thumbnails at full size, on a big monitor, in the tool they
designed them in. Viewers meet them in a 168 px suggested rail, or across a room on a
TV, in a column of eleven other videos, with a duration pill stamped over the
bottom-right corner that never existed in the design file.

Working out the visual angles turned up something I did not expect and that changed the
product: **the phone is the most forgiving surface, not the least.** A feed card at arm's
length subtends 20.2°; the 168 px sidebar 4.4°; a 400 px thumbnail on a 55″ TV at 3 m
just 4.8°. Connected TV is now ~60% of US watch time, so the surface with the most
pixels is angularly almost the smallest. The standard advice to "design for mobile" is
backwards, and the two surfaces that actually punish you are the two you never check.

The failure mode is invisible by construction — the tool you designed in cannot show
you the thing that goes wrong. So the same four mistakes ship over and over: text too
small to resolve, text fighting its own background, the subject buried under the
duration badge, and a composition so busy it turns to mush on the downscale.

Every thumbnail tool I could find *generates*. None of them *verify*.

## What it does — with the numbers it actually prints

Open it and it is already measuring a deliberately broken thumbnail: **44/100, "Will not
survive delivery", measured on-device in ~250 ms.** Press one button and
it becomes **74/100 with zero failing checks.**



Drop a thumbnail in and ThumbProof renders it at the true CSS pixel box of five
delivery surfaces — mobile feed, mobile search, desktop grid, desktop sidebar, TV —
downscaled through the same Lanczos filter the analysis measures, with YouTube's
duration pill and progress bar drawn on top. Then it measures seven things, each as a
number against a stated threshold:

- headline cap height in **delivered** px, per surface
- WCAG 2.1 contrast between the text and its own local background
- SSIM after a real 1280 → delivered → 1280 round trip (how much detail is actually lost)
- % of text sitting under the duration badge
- share of predicted visual attention landing on the subject
- how many text lines a viewer is being asked to read in a scroll
- content past the safe margin

Then it **repairs** it. Two deterministic fixes, both things a creator would do by
hand, and it reports exactly what each one did:

> **Contrast scrim** — Solved a 52% dark scrim behind 6 text blocks, the minimum that reaches 4.5:1.
> **Punch-in recrop** — Declined: the headline already clears the comfort threshold, so cropping would cost framing without buying legibility.

The opacity is binary-searched, not guessed. And it is masked off the glyph pixels via a
per-region Otsu cut — my first version laid the scrim over everything, which scales
foreground and background together and barely moved the ratio at all. That is a tint,
not a fix. Masking it off the type is what turned repair from +0 into +30.

Crucially, it also **refuses**. Two of the six samples are left untouched at 44, because
their text runs corner to corner and no 16:9 crop delivers it larger without dropping
part of it. The tool says exactly that rather than pretending: *"This one cannot be fixed
by cropping — it needs fewer, bigger words."* Their problems are editorial and
compositional, and a tool that claimed to fix those mechanically would be lying.

Finally, the **shelf test**: a thumbnail is never seen alone. Compare it against your
own back catalogue on structure (dHash), colour identity (quantised palette) and where
the busy regions sit (ink-layout histogram). It tells you when you have accidentally
made the same thumbnail five times — the thing a house style quietly does to you. The
five back-catalogue samples score **0 distinctiveness, 0 of 64 dHash bits apart**: built
from one template, they are bit-identical under a perceptual hash. Stacked in a sidebar
they read as one video.

## How I built it

Pure TypeScript, **zero runtime dependencies**, classical computer vision, no ML:

- **Stroke Width Transform** (Epshtein et al. 2010) for text detection — both polarities, components merged into text lines
- **Spectral Residual saliency** (Hou & Zhang 2007) for the attention model
- **Lanczos-3** separable resampling for the downscale simulation
- **SSIM** (Wang et al. 2004) for detail survival
- **WCAG 2.1** relative luminance and contrast, with **Otsu** thresholding to separate text from its local background
- **dHash + quantised palette + ink-layout histogram** for the shelf test

Deliberately no LLM anywhere in the pipeline. The whole value of the claim "your text
is 3.7 px tall" is that it is a measurement — so the pipeline had to be deterministic
end to end. Same pixels in, bit-identical numbers out, on any machine. The FNV-1a
fingerprint printed under the score is of the exact pixels measured, so any result in
the demo can be reproduced.

Static site, no backend, no telemetry. **122 unit tests**, clean `tsc --noEmit`, **zero
runtime dependencies**, **26.4 KB gzipped** on first paint. Deployed to GitHub Pages via
Actions, which typechecks and runs the suite before it will publish.

The determinism claim is checked, not asserted: the same image yields the same FNV-1a
fingerprint and the same score under the dev server and the production bundle
(`51e3852f3cea8e6e` → `c9e442c3293a91a1`). And `selftest.html` re-runs the analyser over
all six samples in the reader's own browser: **6/6 land on the verdict they were authored
to get.**

## Challenges

**The research overturned my own pitch.** I set out to build this around "you design at
1280 and everyone sees 168." Working out the actual visual angles killed that claim: the
phone subtends 20.2° and is the *most forgiving* surface, not the least. The honest
version is narrower and more interesting, and it is what the product now says.

**My first scrim was a tint.** It darkened the glyphs along with the background, so
the contrast ratio barely moved and the repair delta was zero. The fix — an Otsu cut per region
so the scrim lands only on background pixels — is the difference between a feature that
demos and a feature that works.

**Two detector bugs that only unit tests could have caught.** Writing direct tests for
the Stroke Width Transform — synthetic bars of a known width, checked against the
geometry that drew them — showed that I was applying the polarity sign when choosing the
ray direction but comparing against the raw gradient at the far edge. The two ends of
every ray used different conventions, so one of the two polarity passes found almost
nothing. End-to-end calibration had hidden it completely, because the detector ran both
passes and kept whichever won.

Fixing that exposed a second one. With both passes working, choosing between them by
total text area reliably preferred a big dark shape over real type: `wall-of-text` began
reporting a 162 px cap height when its largest font is 62 px — it was measuring the
laptop graphic. And that graphic scored 0.88 confidence because my formula rewarded
stroke-width and size *consistency*, and a single isolated component has zero variance,
so it looks perfectly consistent. Two fixes: merge both polarities instead of picking one
(thumbnails routinely mix dark and light type), and score a solitary component neutrally
so group support carries the weight. Reported cap heights are now within a few per cent
of the fonts that drew them.

**Three more bugs that only surfaced by actually running it.** Boot awaited
`requestAnimationFrame`, which never fires in a background tab, so opening the link in a
background tab left it blank forever. Re-rendering the wall never released canvas backing
stores, and WebKit budgets *total* canvas area per page, so tiles would have silently
stopped painting on iOS. And the text detector counted solid blobs as text — silhouettes
report a stroke width equal to their own height — which had one 3-word thumbnail
reporting 26 text lines until I added a stroke-width-to-height floor.

Making the wall **honest** was harder than making it look right. The obvious approach —
render the thumbnail big and CSS-scale it down — flatters the image, because the
browser's filtering is not the filter YouTube's downscale uses, and the tile stops
being evidence. So the tiles rasterise through the project's own Lanczos path at the
true delivered resolution and then draw those exact pixels into a scaled backing store.
What you look at is literally what was measured.

Getting SWT to behave on real thumbnail typography took the most iterations: heavy
outlines and drop shadows produce double edges, which fragments components. Running
both polarities and merging by stroke-width and height similarity into text *lines*
fixed it — a creator's headline is one object, not eleven letters.

## What I learned

That the most useful thing you can build for a creator is often not a generator. There
were five metadata generators in this hackathon's gallery when I started. Verification
was empty, and verification is where the unglamorous, repeated, expensive mistakes are.

## What's next

Batch mode across a whole channel export; a real face detector so "attention on
subject" can distinguish a face from a bright background; a headless CLI so this can
run as a pre-upload gate in CI.

## Try it in ten seconds

Open the link. No sign-up, no API key, nothing to install, and the first sample is already
measured when the page paints. `selftest.html` proves the analyser on all six samples live.

## Honest limits

- SWT finds *where* text is and how tall it is; it does not read it. Stylised type can be mis-segmented.
- Spectral-residual saliency is bottom-up and does not know what a face is. It is not a CTR predictor.
- Delivered box sizes are responsive and vary by platform version and A/B bucket; the values used are representative and sourced in `docs/surfaces.md`, with an explicit "what we do not know" section.
- **This measures legibility, not clickthrough.** A perfectly legible thumbnail can still be a bad thumbnail. What it rules out is the failure you cannot see from your own desk.

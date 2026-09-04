# Devpost submission — ThumbProof

> Draft. Numbers marked `<N>` must be replaced with values read off a real run
> before submitting. Do not ship a claim the tool does not print.

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

## What it does

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
hand: binary-search the minimum scrim opacity that lifts the headline to 4.5:1, and
compute the tightest 16:9 recrop that still contains the headline and the attention
peak so the same type is delivered larger. It re-scores in front of you and reports
exactly what the trade bought.

Finally, the **shelf test**: a thumbnail is never seen alone. Compare it against your
own back catalogue on structure (dHash), colour identity (quantised palette) and where
the busy regions sit (ink-layout histogram). It tells you when you have accidentally
made the same thumbnail five times — the thing a house style quietly does to you.

## How I built it

Pure TypeScript, **zero runtime dependencies**, classical computer vision, no ML:

- **Stroke Width Transform** (Epshtein et al. 2010) for text detection — both polarities, components merged into text lines
- **Spectral Residual saliency** (Hou & Zhang 2007) for the attention model
- **Lanczos-3** separable resampling for the downscale simulation
- **SSIM** (Wang et al. 2004) for detail survival
- **WCAG 2.1** relative luminance and contrast, with **Otsu** thresholding to separate text from its local background
- **dHash + quantised palette + ink-layout histogram** for the shelf test

Deliberately no LLM anywhere in the pipeline. The whole value of the claim "your text
is `<N>` px tall" is that it is a measurement — so the pipeline had to be deterministic
end to end. Same pixels in, bit-identical numbers out, on any machine. The FNV-1a
fingerprint printed under the score is of the exact pixels measured, so any result in
the demo can be reproduced.

Static site, no backend, no telemetry. Tested with vitest and deployed to GitHub Pages
via Actions, which typechecks and runs the suite before it will publish.

## Challenges

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

## Honest limits

- SWT finds *where* text is and how tall it is; it does not read it. Stylised type can be mis-segmented.
- Spectral-residual saliency is bottom-up and does not know what a face is. It is not a CTR predictor.
- Delivered box sizes are responsive and vary by platform version and A/B bucket; the values used are representative and sourced in `docs/surfaces.md`, with an explicit "what we do not know" section.
- **This measures legibility, not clickthrough.** A perfectly legible thumbnail can still be a bad thumbnail. What it rules out is the failure you cannot see from your own desk.

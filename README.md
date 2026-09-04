# ThumbProof

**Ten-second try:** https://moscraciunxxx.github.io/thumbproof/

You design a thumbnail at **1280 px**. The desktop suggested sidebar delivers it at **168 × 94** —
and a living-room TV at 3 m subtends *almost exactly the same visual angle*. Those are the two
surfaces you never check from your desk.

ThumbProof measures what survives that trip — and repairs it — entirely on your machine.

No upload. No account. No API key. No model weights. Nothing leaves the browser.

---

## What a judge should see

1. **Open the URL.** It boots on a deliberately broken thumbnail and the score is already on screen — no clicking, no setup, no sign-in.
2. **Look at the wall.** Each tile is your thumbnail drawn at the *actual CSS pixel box* that surface uses, downscaled through the same Lanczos filter the analysis measures, with YouTube's duration pill and progress bar stamped on top. That is not a CSS shrink of a big image — the pixels you're looking at are the pixels that were measured.
3. **Read the checks.** Every row is a number with a stated threshold: `6.3 px cap height`, `2.41:1 WCAG contrast`, `SSIM 0.612`. No adjectives, no model opinion.
4. **Press "Repair & re-measure".** Two deterministic fixes get applied and the whole thing is re-scored in front of you. The score moves.
5. **Scroll to the shelf test.** Your candidate is compared against a back catalogue on structure, colour and layout. It tells you when you have accidentally made the same thumbnail five times.

Every number is reproducible. The fingerprint under the score is an FNV-1a hash of the exact pixels measured — same image in, same numbers out, on any machine, forever.

## The problem this actually solves

Creators check thumbnails at full size on a 27-inch monitor. Viewers meet them in a
168 px-wide suggested rail, or across a room on a TV, in a column of eleven other videos,
with a duration pill stamped over the bottom-right corner that never existed in the design file.

The counter-intuitive part, worked out in [`docs/surfaces.md`](docs/surfaces.md): **the phone is
the most forgiving surface, not the least.** A 360 px feed card at arm's length subtends 20.2°.
The 168 px sidebar subtends 4.4°, and a 400 px thumbnail on a 55″ TV at 3 m subtends 4.8° — the
surface with the most pixels is angularly the second *smallest*. "Design for mobile" has it backwards.

The failure mode is invisible by construction: the tool you designed in cannot show you
the thing that goes wrong. So the same four mistakes ship over and over — text too small
to resolve, text fighting its own background, the subject buried under the duration pill,
and a composition so busy it turns to mush on the downscale.

Nothing measures this. Thumbnail tools generate; they do not verify.

## What it measures

| Check | What it computes | Threshold |
|---|---|---|
| **Headline legibility** | Cap height of the largest detected text line, in *delivered* px, per surface | fail below the px floor in `docs/surfaces.md` |
| **Text vs its own background** | WCAG 2.1 contrast between Otsu-separated fore/background *inside the text box*, median-sampled | 4.5:1 |
| **Detail survival** | SSIM after a real 1280 → delivered → 1280 Lanczos round trip | 0.82 |
| **Duration-badge collision** | % of detected text area under YouTube's pill | 2% |
| **Attention focus** | Spectral-residual saliency mass landing on the headline/subject | 45% |
| **Text load** | Number of distinct text lines a viewer is asked to read in a scroll | 3 |
| **Edge safety** | Content past the 4% safe margin that surface crops will shave | 0.5% |

## What it repairs

Two fixes, both things a creator would do by hand, neither involving a generative model:

- **Contrast scrim** — binary-searches the *minimum* scrim opacity that lifts the headline to WCAG 4.5:1, then lays it down with a cosine feather. It solves for the number rather than guessing at it, and reports the number it solved for.
- **Punch-in recrop** — computes the tightest 16:9 crop that still contains every headline region and the attention peak, so the same type is delivered larger. It reports exactly what the trade bought: `6.3px → 11.4px on mobile feed`.

Both are reversible, explainable in one sentence, and declined automatically when they would not help.

## How it works

Pure TypeScript, zero runtime dependencies. Classical computer vision, no ML:

- **Stroke Width Transform** (Epshtein et al., 2010) for text detection — runs both polarities, merges components into text lines
- **Spectral Residual saliency** (Hou & Zhang, 2007) for the attention model
- **Lanczos-3** separable resampling for the downscale simulation
- **SSIM** (Wang et al., 2004) for detail survival
- **WCAG 2.1** relative luminance and contrast ratio, with **Otsu** thresholding to separate text from its local background
- **dHash + quantised palette + ink-layout histogram** for the shelf test

Because none of that is stochastic, the whole pipeline is deterministic — which is the
only reason a claim like "your text is 6.3 px tall" is worth anything.

## Verify locally

```bash
npm ci && npm test
```

```bash
npm run build
```

`npm run dev` is for editing. The judged door is the GitHub Pages URL at the top.

## Where the numbers come from

Every threshold and every surface dimension is sourced in [`docs/surfaces.md`](docs/surfaces.md),
including a **"What we do NOT know"** section. Where a value is an estimate rather than a
sourced fact, it is marked as one in both the memo and the code.

## Honest limits

- Text detection is SWT, not OCR. It finds *where* text is and how tall it is; it does not read it. Highly stylised or heavily outlined type can be under- or over-segmented.
- Saliency is a 2007 bottom-up model. It predicts where the eye goes on contrast and novelty. It does not know what a face is, and it is not a CTR predictor.
- Delivered box sizes are responsive and change with viewport, platform version and A/B bucket. The values used are representative, not universal.
- **This measures legibility, not clickthrough.** A perfectly legible thumbnail can still be a bad thumbnail. What ThumbProof rules out is the failure mode you cannot see from your own desk.

## License

MIT

# Devpost copy — ThumbProof (tight judge version)

**Tagline (~200 chars):**
Gallery is full of generators. ThumbProof is the pre-upload verification gate — measure what survives YouTube’s 168px rail and TV, then repair it. Deterministic, in your browser.

**Try it:** https://moscraciunxxx.github.io/thumbproof/
**Repo:** https://github.com/moscraciunxxx/thumbproof
**Demo video:** (paste YouTube URL here)

## Inspiration (keep short)
Creators design at 1280px. Viewers meet the thumbnail at 168px in the suggested rail — or on a TV across the room. Those surfaces never appear in the design tool, so the same failures ship forever: type too small, contrast too low, subject under the duration pill.

## What it does
1. Paste any YouTube URL (or drop a PNG).
2. See the score + true-size delivery wall (sidebar / phone / TV) with the duration pill.
3. Repair: minimum scrim to WCAG 4.5:1 and optional 16:9 punch-in — arithmetic, not a generative model.
4. Rank 2–4 variants by delivery survival; download repaired PNG + measurement JSON.

No upload. No API key. No ML weights. ~27KB gzipped. Same image → same fingerprint.

## How we built it
Pure TypeScript classical CV: Stroke Width Transform, Lanczos-3, SSIM, WCAG contrast, spectral residual saliency. Vitest + live `selftest.html` (6/6 authored verdicts).

## What’s next
Batch over a channel export; optional face detector; CLI pre-upload gate for CI.

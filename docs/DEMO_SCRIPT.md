# Demo video script — ThumbProof (~70s)

Rules say the video is optional. With one judge, an 8-hour judging window and 40+
projects, it is the highest-leverage optional thing in the pack. Target 60–80s.
Screen recording only, no face, no music bed, no title card longer than 2 seconds.

All numbers below are real, taken from the production build and cross-checked in
`docs/MEASURED.md`. Read them off the screen as you say them — never state a number
the tool is not printing at that moment.

The tool boots on `low-contrast`, so everything up to 0:40 needs no clicking.

---

**0:00–0:08 — the claim, over the already-loaded page**
> "You design a thumbnail at twelve-eighty. The suggested sidebar hands it to people
> at a hundred and sixty-eight, and a TV across the room is angularly no bigger.
> Those are the two surfaces you never check."

*(The score is already on screen: **44**, "Will not survive delivery". Do not click
anything yet. Let it sit for a full beat.)*

**0:08–0:20 — the wall**
> "Same thumbnail, five times. Each tile is the real CSS pixel box that surface uses —
> not a shrunk picture, the actual delivered pixels, downscaled through the same
> Lanczos filter the analysis measures, with YouTube's duration pill stamped on."

*(Cursor moves left to right across the wall. Watch the headline fade out as the
tiles get smaller. Do not scroll fast.)*

**0:20–0:32 — the measurements**
> "Every row is a number with a threshold. The type is big enough — sixteen-point-eight
> pixels of cap height in the sidebar. What kills it is contrast: one-point-three-nine
> to one, against WCAG's four-point-five. And this panel shows what the tool actually
> saw — detected text lines with their cap heights, the attention peak, and the
> keep-out zone under the duration pill."

**0:32–0:44 — the repair**
> "Now repair it."

*(Click **Repair & re-measure**.)*

> "It solved for the minimum scrim opacity that reaches four-point-five to one —
> fifty-two per cent — and laid it behind the text, not over it. Forty-four to
> seventy-four. One failing check to zero. No generative model touched the pixels;
> it just did the arithmetic. And it declined to recrop, because the type was already
> big enough — it says so instead of inventing a fix."

**0:44–0:56 — the honest refusal, and the size failure**
*(Click the **Detail collapse** chip.)*

> "Here's the other failure mode. Three-point-seven pixels of cap height in the
> sidebar — a hundred per cent of the text is below the legibility floor — and SSIM
> zero-point-seven-four after the downscale, so most of the detail never reaches the
> viewer at all."

*(Press **Repair & re-measure** and let it refuse.)*

> "And this one it won't fix. The text runs corner to corner, so no sixteen-by-nine
> crop delivers it larger. It needs fewer, bigger words — and the tool says that
> rather than pretending."

**0:56–1:08 — the shelf test**
*(Scroll to the shelf test.)*

> "A thumbnail is never seen alone. This compares yours against your own back
> catalogue on structure, colour and layout. These five are a hundred per cent the
> same — zero of sixty-four hash bits apart. In a sidebar they read as one video, and
> a returning viewer scrolls past thinking they already watched it."

**1:08–1:18 — the close**
> "It runs entirely in your browser. No upload, no account, no API key, no model
> weights — twenty-six kilobytes and zero dependencies. The hash under the score is of
> the exact pixels measured, so the same image always gives the same numbers. A
> hundred and thirty-seven tests, and a self-test page that re-runs all six samples
> live. Source is on GitHub."

*(Optional last shot, 2s: `/selftest.html` showing **6/6 samples land on their
authored verdict**.)*

---

## Recording checklist

- [ ] Read every number off the screen as you say it; do not recall them from this script
- [ ] Hard-refresh first so the boot state is what a judge sees
- [ ] Wait for the score to appear before starting — the first analysis takes ~250 ms
- [ ] Browser at a width where the whole wall fits without horizontal scroll
- [ ] Zoom to ~110% so the small tiles are still visible after video compression
- [ ] No devtools open, no bookmarks bar, no other tabs
- [ ] Record at 1080p minimum — the entire point is small-text legibility
- [ ] Upload unlisted, embed on the Devpost card, and confirm it plays logged-out

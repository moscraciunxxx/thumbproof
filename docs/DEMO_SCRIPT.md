# Demo video script — ThumbProof (~60s)

Rules say the video is optional. With one judge, an 8-hour judging window and 40+
projects, it is the highest-leverage optional thing in the pack. Target 55–70s.
Screen recording only, no face, no music bed, no title card longer than 2 seconds.

All numbers below are real, taken from the boot sample (`low-contrast`) and cross-checked
in `docs/MEASURED.md`. Read them off the screen while recording anyway — never state a
number the tool is not printing at that moment.

---

**0:00–0:06 — the claim, over the loaded page**
> "You design a thumbnail at twelve-eighty. YouTube hands it to most of your
> audience at one-sixty-eight. Here's what that does."

*(Page is already loaded on the failing sample. The score is already on screen —
do not click anything yet. Let the wall sit for a full beat.)*

**0:06–0:18 — the wall**
> "Same thumbnail, five times. Each tile is the real CSS pixel box that surface
> uses — not a shrunk picture, the actual delivered pixels, with YouTube's
> duration pill stamped on. In the suggested sidebar the headline is six-point-six
> pixels tall. Nobody can read that. And a TV across the room is angularly no bigger."

*(Cursor rests on the sidebar tile, which reads `6.6px cap height — unreadable`. Do not scroll fast.)*

**0:18–0:30 — the measurements**
> "Every row is a number with a threshold. Contrast one-point-two-seven to one,
> against WCAG's four-point-five. A hundred per cent of the text area is under the
> seven-pixel floor. And this panel shows what the tool actually saw: detected text
> lines with their cap heights, the attention peak, the keep-out zone under the
> duration pill."

**0:30–0:44 — the repair**
> "Now repair it."

*(Click **Repair & re-measure**. Let the score animate.)*

> "It solved for the minimum scrim opacity that reaches four-point-five to one —
> fifty-two per cent — and recropped twenty-eight per cent tighter around the
> headline, so the same type is delivered one-point-three-nine times bigger.
> Six-point-six pixels to nine-point-two. Forty-four to seventy-four, and zero
> failing checks. No generative model touched the pixels. Both fixes are things
> you'd do by hand; it just did the arithmetic."

*(Optional, and strong if there's time: click **Wall of text**, press Repair, and let it
refuse — "it needs fewer, bigger words." A tool that knows when it cannot help reads as
more trustworthy than one that always claims a win.)*

**0:44–0:56 — the shelf test**
> "And a thumbnail is never seen alone. This compares yours against your own back
> catalogue on structure, colour and layout. These five are a hundred per cent the
> same — zero of sixty-four hash bits apart. In a sidebar they read as one video,
> and a returning viewer scrolls past thinking they already watched it."

**0:56–1:05 — the close**
> "It runs entirely in your browser. No upload, no account, no API key, no model
> weights — twenty-six kilobytes and zero dependencies. The hash under the score is
> of the exact pixels measured, so same image in, same numbers out. Forty-one tests,
> and a self-test page that re-runs all six samples live. Source is on GitHub."

---

## Recording checklist

- [ ] Read every number off the screen as you say it; do not recall them from this script
- [ ] Hard-refresh first so the boot state is what a judge sees
- [ ] Browser at a width where the whole wall fits without horizontal scroll
- [ ] Zoom to ~110% so the small tiles are still visible after video compression
- [ ] No devtools open, no bookmarks bar, no other tabs
- [ ] Record at 1080p minimum — the entire point is small-text legibility
- [ ] Upload unlisted, embed on the Devpost card, and confirm it plays logged-out

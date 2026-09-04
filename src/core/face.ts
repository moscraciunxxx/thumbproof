/**
 * Face-LIKE region detection from skin chrominance and shape heuristics.
 *
 * ============================================================================
 * WHAT THIS IS, AND WHAT IT IS NOT — read this before quoting any number from it
 * ============================================================================
 *
 * This is NOT a face detector. There is no classifier here, no trained cascade,
 * no landmark model, no weights of any kind. It finds connected regions whose
 * chrominance falls inside a published skin-tone box in YCbCr and whose shape is
 * plausible for a head, and it says so with a `confidence` that is a blended
 * SHAPE SCORE, not a probability and not a likelihood. Nothing in this file
 * verifies that a region contains eyes, a mouth, or any facial structure at all.
 *
 * It exists to give the spectral-residual saliency check a subject to be "on".
 * Saliency alone cannot separate "attention is on the presenter's face" (good)
 * from "attention is on a bright background blob" (bad), and that is why the
 * saliency check is marked advisory. A region from this module narrows that
 * ambiguity; it does not remove it. Anything built on top of this must stay
 * advisory too.
 *
 * ---------------------------------------------------------------------------
 * KNOWN FALSE POSITIVES — things this will call face-like that are not faces
 * ---------------------------------------------------------------------------
 *   - Any other bare skin: hands, forearms, necks, shoulders, chests, legs. A
 *     raised hand next to a face is the single most common thumbnail pose, and
 *     it reads here as skin. A hand touching the face merges into ONE region.
 *   - Wood: desks, floors, panelling, cork boards, cardboard, kraft paper.
 *   - Ground textures: sand, dry grass, autumn leaves, terracotta, brick, clay.
 *   - Warm light: sunset skies, tungsten-lit walls, orange/amber gradients and
 *     the orange-and-teal grade. Warm graphic fills are endemic to thumbnail
 *     design, so this is the highest-volume false positive on real artwork.
 *   - Warm-toned objects: copper, gold, brass, bread, chicken, pizza, beige
 *     clothing, foundation makeup, tan leather.
 *   - Some animal fur — ginger cats, tan and golden-coated dogs, horses.
 *   - Faces printed on posters, phone screens and monitors inside the frame.
 *
 * ---------------------------------------------------------------------------
 * KNOWN FALSE NEGATIVES — faces this will miss
 * ---------------------------------------------------------------------------
 *   - DARK SKIN UNDER LOW OR COOL LIGHT. A fixed Cb/Cr box with a luma floor is
 *     a documented failure mode of this whole family of methods, and it does not
 *     fail evenly across skin tones. Deeply pigmented skin in shadow falls below
 *     the luma floor or outside the chroma box and is simply not seen. This is
 *     the most important limitation in the file. Do not report "no face found"
 *     to a creator as if it were a fact about their image.
 *   - Heavy colour grading: duotone, monochrome, teal-shifted or magenta-shifted
 *     grades push chroma straight out of the box.
 *   - Strong coloured stage or gel lighting, and heavy blue/green screen spill.
 *   - Chroma subsampling and low-bitrate compression: 4:2:0 smears Cb/Cr, which
 *     matters most on small faces.
 *   - Faces heavily occluded, in profile, or under sunglasses covering most of
 *     the visible skin.
 *   - Two adjacent faces that touch merge into one over-wide region and are then
 *     rejected by the aspect filter.
 *
 * ============================================================================
 * DETERMINISM
 * ============================================================================
 * The colour transform uses only multiplies and adds on integer inputs with
 * fixed constants, compared against integer thresholds — no transcendentals, so
 * no cross-engine ULP risk. Morphology, union-find and every reduction run in a
 * fixed row-major scan order. Component labels are compacted in scan order and
 * results are explicitly sorted, so no `Map` iteration order can leak into the
 * output. Reported reals are quantised to 3 decimal places. No `Math.random`.
 */

import type { Bitmap, Plane } from './types';
import { resizeLanczos } from './image';

export interface FaceRegion {
  x: number; y: number; w: number; h: number;
  /** 0..1 — how face-like, from shape, fill and skin purity. Never a probability. */
  confidence: number;
  /** Share of the region's pixels classified as skin chroma. */
  skinRatio: number;
}

// ------------------------------------------------------------------- constants

/**
 * Skin-tone box in YCbCr, from Chai & Ngan, "Face Segmentation Using Skin-Color
 * Map in Videophone Applications", IEEE Trans. Circuits Syst. Video Technol.
 * 9(4):551-564 (1999): Cb in [77,127] and Cr in [133,173]. These are the numbers
 * that whole literature inherited; they are quoted here unmodified so the
 * threshold can be checked against the paper rather than against our own output.
 */
const CB_MIN = 77;
const CB_MAX = 127;
const CR_MIN = 133;
const CR_MAX = 173;

/**
 * Luma floor. NOT from Chai & Ngan — our own addition. Below roughly Y=40 the
 * chroma of an 8-bit sRGB pixel is quantisation noise, so near-black pixels can
 * land anywhere in the Cb/Cr box by accident. Rejecting them costs us real dark
 * pixels (see the false-negative note on dark skin in shadow, above) and that
 * trade is deliberate but genuinely lossy.
 */
const Y_MIN = 40;

/** ITU-R BT.601 full-range (JFIF/JPEG) RGB->YCbCr. The space the thresholds live in. */
const KR = 0.299;
const KG = 0.587;
const KB = 0.114;
const CB_R = -0.168736, CB_G = -0.331264, CB_B = 0.5;
const CR_R = 0.5, CR_G = -0.418688, CR_B = -0.081312;

/** A plane value at or above this counts as "on". Keeps morphology output strictly 0/1. */
const BIN = 0.5;

/** Detection working width, matching `swt.ts`. Quarter of the pixels of a 1280px source. */
const WORK_WIDTH = 640;

/** Opening radius: kills isolated pixels and 1px filaments at the working scale. */
const OPEN_RADIUS = 1;
/** Closing radius: bridges thin shadow lines and JPEG-mangled gaps up to 4px. */
const CLOSE_RADIUS = 2;

/** Accepted bounding-box aspect (w/h). Faces are taller than wide, or roughly square. */
const ASPECT_MIN = 0.6;
const ASPECT_MAX = 1.5;
/** Aspect of a typical head-and-hair bounding box; the peak of the aspect score. */
const IDEAL_ASPECT = 0.75;

/**
 * A component covering more than this share of the frame is a skin-toned
 * BACKGROUND — a wooden wall, a sunset, an orange fill — not a face. This is the
 * single most important guard in the file: without it every warm-toned thumbnail
 * reports one enormous high-confidence "face".
 */
const MAX_FRAME_FRACTION = 0.80;
/** Below this share of the frame a component is noise, not a subject. */
const MIN_FRAME_FRACTION = 0.0015;
/** Absolute pixel floor, so tiny inputs do not admit 3-pixel "faces". */
const MIN_COMPONENT_PIXELS = 16;

/**
 * Confidence weights. They sum to 1. Aspect carries the most because it is the
 * only term that actually discriminates a head from a warm-toned blob — every
 * component reaching this point is skin-coloured by construction, so `skinRatio`
 * is a purity check on the box rather than a detector in its own right.
 */
const W_ASPECT = 0.40;
const W_FILL = 0.30;
const W_SKIN = 0.30;

// ------------------------------------------------------------------- skin mask

/**
 * Per-pixel skin-chroma mask in YCbCr. 1 = skin-like, 0 = not.
 *
 * Alpha is ignored (thumbnails are opaque). The output plane is the same size as
 * the input bitmap; callers wanting the reduced working resolution must downscale
 * the bitmap first. O(width * height).
 */
export function skinMask(b: Bitmap): Plane {
  const n = b.width * b.height;
  const out = new Float32Array(n);
  const px = b.rgba;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const r = px[o] ?? 0;
    const g = px[o + 1] ?? 0;
    const bl = px[o + 2] ?? 0;
    const y = KR * r + KG * g + KB * bl;
    if (y < Y_MIN) continue;
    const cb = 128 + CB_R * r + CB_G * g + CB_B * bl;
    if (cb < CB_MIN || cb > CB_MAX) continue;
    const cr = 128 + CR_R * r + CR_G * g + CR_B * bl;
    if (cr < CR_MIN || cr > CR_MAX) continue;
    out[i] = 1;
  }
  return { width: b.width, height: b.height, data: out };
}

// ------------------------------------------------------------------ morphology

/**
 * Separable binary morphology with a square structuring element. A square SE is
 * separable under both min (erosion) and dilation's max, so the (2r+1)x(2r+1)
 * window is applied as a horizontal pass then a vertical pass — exactly equal to
 * the 2D operation, at O(w * h * r) instead of O(w * h * r^2).
 *
 * Borders replicate the edge pixel rather than assuming background, so a subject
 * running off the edge of the frame is not eaten by the opening.
 */
function morph(p: Plane, radius: number, isDilate: boolean): Plane {
  const w = p.width;
  const h = p.height;
  const n = w * h;
  const src = new Uint8Array(n);
  for (let i = 0; i < n; i++) src[i] = (p.data[i] ?? 0) >= BIN ? 1 : 0;

  const r = Math.floor(radius);
  if (!(r >= 1) || n === 0) return fromBits(src, w, h);

  const hit = isDilate ? 1 : 0;
  const tmp = new Uint8Array(n);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let v = isDilate ? 0 : 1;
      for (let t = -r; t <= r; t++) {
        let sx = x + t;
        if (sx < 0) sx = 0; else if (sx >= w) sx = w - 1;
        if ((src[row + sx] ?? 0) === hit) { v = hit; break; }
      }
      tmp[row + x] = v;
    }
  }

  const out = new Uint8Array(n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = isDilate ? 0 : 1;
      for (let t = -r; t <= r; t++) {
        let sy = y + t;
        if (sy < 0) sy = 0; else if (sy >= h) sy = h - 1;
        if ((tmp[sy * w + x] ?? 0) === hit) { v = hit; break; }
      }
      out[y * w + x] = v;
    }
  }
  return fromBits(out, w, h);
}

function fromBits(bits: Uint8Array, w: number, h: number): Plane {
  const data = new Float32Array(w * h);
  for (let i = 0; i < data.length; i++) data[i] = bits[i] ?? 0;
  return { width: w, height: h, data };
}

/**
 * Binary erosion with a square structuring element of the given radius. A pixel
 * survives only if every pixel in its (2r+1)^2 window is on. `radius < 1` is the
 * identity (returned binarised). O(w * h * radius).
 */
export function erode(p: Plane, radius: number): Plane {
  return morph(p, radius, false);
}

/**
 * Binary dilation with a square structuring element of the given radius. A pixel
 * turns on if any pixel in its (2r+1)^2 window is on. `radius < 1` is the
 * identity (returned binarised). O(w * h * radius).
 */
export function dilate(p: Plane, radius: number): Plane {
  return morph(p, radius, true);
}

// --------------------------------------------------------- connected components

/** Union-find with path compression, unioning to the smaller root. */
class DSU {
  private parent: Int32Array;
  constructor(n: number) {
    this.parent = new Int32Array(n);
    for (let i = 0; i < n; i++) this.parent[i] = i;
  }
  find(a: number): number {
    let r = a;
    while ((this.parent[r] ?? r) !== r) r = this.parent[r] ?? r;
    let c = a;
    while ((this.parent[c] ?? c) !== c) { const nx = this.parent[c] ?? c; this.parent[c] = r; c = nx; }
    return r;
  }
  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[Math.max(ra, rb)] = Math.min(ra, rb);
  }
}

/** The four already-visited 8-neighbours, so each edge is considered exactly once. */
const BACK_NEIGHBOURS: readonly (readonly [number, number])[] = [
  [-1, 0], [-1, -1], [0, -1], [1, -1],
];

/**
 * 8-connected components of a 0/1 plane, via union-find over a single row-major
 * pass. Components smaller than `minPixels` are dropped.
 *
 * Labels are compacted in scan order and the result is sorted explicitly —
 * descending pixel count, ties broken by top-left position — so the output never
 * depends on hash or `Map` iteration order. O(w * h * alpha(w * h)).
 */
export function components01(
  p: Plane,
  minPixels: number,
): { x: number; y: number; w: number; h: number; pixels: number }[] {
  const w = p.width;
  const h = p.height;
  const n = w * h;
  if (n <= 0) return [];

  const on = new Uint8Array(n);
  for (let i = 0; i < n; i++) on[i] = (p.data[i] ?? 0) >= BIN ? 1 : 0;

  const dsu = new DSU(n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if ((on[i] ?? 0) === 0) continue;
      for (const [dx, dy] of BACK_NEIGHBOURS) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if ((on[j] ?? 0) === 1) dsu.union(i, j);
      }
    }
  }

  // Compact roots to dense indices in scan order — no Map, no insertion-order dependence.
  const slot = new Int32Array(n).fill(-1);
  const x0: number[] = [], y0: number[] = [], x1: number[] = [], y1: number[] = [], count: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if ((on[i] ?? 0) === 0) continue;
      const root = dsu.find(i);
      let s = slot[root] ?? -1;
      if (s === -1) {
        s = count.length;
        slot[root] = s;
        x0.push(x); y0.push(y); x1.push(x); y1.push(y); count.push(0);
      }
      if (x < (x0[s] ?? x)) x0[s] = x;
      if (x > (x1[s] ?? x)) x1[s] = x;
      if (y < (y0[s] ?? y)) y0[s] = y;
      if (y > (y1[s] ?? y)) y1[s] = y;
      count[s] = (count[s] ?? 0) + 1;
    }
  }

  const floor = Math.max(1, Math.ceil(minPixels));
  const out: { x: number; y: number; w: number; h: number; pixels: number }[] = [];
  for (let s = 0; s < count.length; s++) {
    const pixels = count[s] ?? 0;
    if (pixels < floor) continue;
    const ax = x0[s] ?? 0, ay = y0[s] ?? 0;
    out.push({ x: ax, y: ay, w: (x1[s] ?? ax) - ax + 1, h: (y1[s] ?? ay) - ay + 1, pixels });
  }
  out.sort((a, b) => b.pixels - a.pixels || a.y - b.y || a.x - b.x);
  return out;
}

// --------------------------------------------------------------------- scoring

/**
 * Piecewise-linear tent over the accepted aspect window, peaking at 1 at
 * `IDEAL_ASPECT` and falling to 0 at both accepted bounds. Asymmetric on purpose:
 * the window is asymmetric, and a 1.4 aspect really is further from a head than a
 * 0.65 aspect is.
 */
function aspectScore(aspect: number): number {
  if (aspect <= ASPECT_MIN || aspect >= ASPECT_MAX) return 0;
  return aspect < IDEAL_ASPECT
    ? (aspect - ASPECT_MIN) / (IDEAL_ASPECT - ASPECT_MIN)
    : (ASPECT_MAX - aspect) / (ASPECT_MAX - IDEAL_ASPECT);
}

const q3 = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 1000) / 1000;

// ------------------------------------------------------------------- detection

/**
 * Detect face-LIKE regions, largest first, in SOURCE image coordinates.
 *
 * Pipeline: downscale to a 640px working width (matching `swt.ts`), skin-chroma
 * mask, morphological open then close, 8-connected components, then a shape
 * filter on aspect and frame coverage. Boxes are mapped back to source pixels as
 * an integer cover (floor the origin, ceil the far corner) so a reported box
 * never claims to be tighter than the working resolution can justify.
 *
 * Re-read the header before trusting the output. `confidence` is a shape score.
 * O(w * h) at the working resolution.
 */
export function detectFaces(b: Bitmap): FaceRegion[] {
  if (b.width < 1 || b.height < 1) return [];

  const scale = b.width > WORK_WIDTH ? WORK_WIDTH / b.width : 1;
  const work = scale < 1
    ? resizeLanczos(b, Math.max(1, Math.round(b.width * scale)), Math.max(1, Math.round(b.height * scale)))
    : b;

  const raw = skinMask(work);
  const opened = dilate(erode(raw, OPEN_RADIUS), OPEN_RADIUS);
  const closed = erode(dilate(opened, CLOSE_RADIUS), CLOSE_RADIUS);

  const ww = work.width;
  const wh = work.height;
  const frame = ww * wh;
  const minPixels = Math.max(MIN_COMPONENT_PIXELS, Math.round(frame * MIN_FRAME_FRACTION));

  // Source pixels per working pixel, per axis — the rounded working height means
  // the two factors are not always identical.
  const upX = b.width / ww;
  const upY = b.height / wh;

  const out: FaceRegion[] = [];
  for (const c of components01(closed, minPixels)) {
    const boxArea = c.w * c.h;
    if (boxArea <= 0) continue;

    const aspect = c.w / c.h;
    if (aspect < ASPECT_MIN || aspect > ASPECT_MAX) continue;

    // The background guard: a skin-toned wall, sunset or orange fill covers the
    // frame; a face does not. Checked on both the component's own pixels and on
    // its bounding box, so neither a solid fill nor a sprawling ragged one slips through.
    const pixelFraction = c.pixels / frame;
    if (pixelFraction > MAX_FRAME_FRACTION) continue;
    if (boxArea / frame > MAX_FRAME_FRACTION) continue;
    if (pixelFraction < MIN_FRAME_FRACTION) continue;

    // Skin purity is measured on the RAW mask, before morphology: closing invents
    // pixels to bridge gaps, and those inventions must not inflate the number we
    // report as "share of the region classified as skin chroma".
    let skinPixels = 0;
    for (let y = c.y; y < c.y + c.h; y++) {
      const row = y * ww;
      for (let x = c.x; x < c.x + c.w; x++) {
        if ((raw.data[row + x] ?? 0) >= BIN) skinPixels++;
      }
    }
    const skinRatio = skinPixels / boxArea;
    const fill = c.pixels / boxArea;

    const confidence = W_ASPECT * aspectScore(aspect) + W_FILL * fill + W_SKIN * skinRatio;

    const sx0 = Math.max(0, Math.floor(c.x * upX));
    const sy0 = Math.max(0, Math.floor(c.y * upY));
    const sx1 = Math.min(b.width, Math.ceil((c.x + c.w) * upX));
    const sy1 = Math.min(b.height, Math.ceil((c.y + c.h) * upY));
    if (sx1 <= sx0 || sy1 <= sy0) continue;

    out.push({
      x: sx0, y: sy0, w: sx1 - sx0, h: sy1 - sy0,
      confidence: q3(confidence),
      skinRatio: q3(skinRatio),
    });
  }

  out.sort((a, c) => c.w * c.h - a.w * a.h || a.x - c.x || a.y - c.y);
  return out;
}

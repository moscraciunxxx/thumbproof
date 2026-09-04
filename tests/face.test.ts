/**
 * Tests for the face-LIKE region detector.
 *
 * Two things are being pinned here. First, the primitives (`skinMask`, `erode`,
 * `dilate`, `components01`) are checked against the geometry and the published
 * YCbCr thresholds that produced them, never against their own previous output —
 * the Cb/Cr values are recomputed in the test from the BT.601 formula so a
 * rejection can be attributed to the specific threshold that caused it.
 *
 * Second, and more important, the FALSE-POSITIVE guards are tested as hard as
 * the detections. A skin-chroma detector that fires on a full frame of warm
 * colour would be worse than useless in a tool whose credibility rests on never
 * overstating a measurement, so the background-rejection cases below are the
 * load-bearing ones.
 *
 * Synthetic bitmaps are built locally rather than imported, so this file cannot
 * be broken by edits to the shared fixtures.
 */

import { describe, it, expect } from 'vitest';
import { skinMask, erode, dilate, components01, detectFaces } from '../src/core/face';
import type { Bitmap, Plane } from '../src/core/types';

// ------------------------------------------------------------------- fixtures

type RGB = [number, number, number];

/** A mid-tone skin swatch. Cb=104.9, Cr=154.4 — inside the Chai & Ngan box. */
const SKIN: RGB = [226, 178, 148];
const BLUE: RGB = [30, 60, 220];
const BLACK: RGB = [0, 0, 0];

function solid(w: number, h: number, rgb: RGB): Bitmap {
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    rgba[i * 4] = rgb[0];
    rgba[i * 4 + 1] = rgb[1];
    rgba[i * 4 + 2] = rgb[2];
    rgba[i * 4 + 3] = 255;
  }
  return { width: w, height: h, rgba };
}

function fillRect(b: Bitmap, x: number, y: number, w: number, h: number, rgb: RGB): Bitmap {
  for (let yy = Math.max(0, y); yy < Math.min(b.height, y + h); yy++) {
    for (let xx = Math.max(0, x); xx < Math.min(b.width, x + w); xx++) {
      const i = (yy * b.width + xx) * 4;
      b.rgba[i] = rgb[0];
      b.rgba[i + 1] = rgb[1];
      b.rgba[i + 2] = rgb[2];
      b.rgba[i + 3] = 255;
    }
  }
  return b;
}

/** Filled axis-aligned ellipse — a rough stand-in for a head. */
function fillEllipse(b: Bitmap, cx: number, cy: number, rx: number, ry: number, rgb: RGB): Bitmap {
  for (let y = Math.max(0, Math.ceil(cy - ry)); y <= Math.min(b.height - 1, Math.floor(cy + ry)); y++) {
    for (let x = Math.max(0, Math.ceil(cx - rx)); x <= Math.min(b.width - 1, Math.floor(cx + rx)); x++) {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      if (dx * dx + dy * dy <= 1) {
        const i = (y * b.width + x) * 4;
        b.rgba[i] = rgb[0];
        b.rgba[i + 1] = rgb[1];
        b.rgba[i + 2] = rgb[2];
        b.rgba[i + 3] = 255;
      }
    }
  }
  return b;
}

/** Build a 0/1 plane from an ASCII picture. '#' is on, anything else is off. */
function planeFrom(rows: string[]): Plane {
  const h = rows.length;
  const w = rows[0]?.length ?? 0;
  const data = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = rows[y] ?? '';
    for (let x = 0; x < w; x++) data[y * w + x] = row[x] === '#' ? 1 : 0;
  }
  return { width: w, height: h, data };
}

/** A 0/1 plane with a solid rectangle drawn on it. */
function planeRect(w: number, h: number, rects: [number, number, number, number][]): Plane {
  const data = new Float32Array(w * h);
  for (const [rx, ry, rw, rh] of rects) {
    for (let y = ry; y < ry + rh; y++) for (let x = rx; x < rx + rw; x++) data[y * w + x] = 1;
  }
  return { width: w, height: h, data };
}

const onCount = (p: Plane) => {
  let n = 0;
  for (let i = 0; i < p.data.length; i++) if ((p.data[i] ?? 0) >= 0.5) n++;
  return n;
};

/** ITU-R BT.601 full-range chroma, recomputed here so threshold claims are checkable. */
const cbOf = (r: number, g: number, b: number) => 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
const crOf = (r: number, g: number, b: number) => 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
const yOf = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;

// ------------------------------------------------------------------- skinMask

describe('skinMask (Chai & Ngan 1999 Cb/Cr box, BT.601 full range)', () => {
  it('marks every pixel of a skin-toned fill', () => {
    const p = skinMask(solid(16, 16, SKIN));
    expect(onCount(p)).toBe(256);
  });

  it('confirms the swatch really is inside the published box', () => {
    expect(cbOf(...SKIN)).toBeGreaterThanOrEqual(77);
    expect(cbOf(...SKIN)).toBeLessThanOrEqual(127);
    expect(crOf(...SKIN)).toBeGreaterThanOrEqual(133);
    expect(crOf(...SKIN)).toBeLessThanOrEqual(173);
  });

  it('marks nothing on pure blue, pure green, black or white', () => {
    for (const rgb of [[0, 0, 255], [0, 255, 0], [0, 0, 0], [255, 255, 255]] as RGB[]) {
      expect(onCount(skinMask(solid(8, 8, rgb)))).toBe(0);
    }
  });

  it('marks nothing on neutral grey, whose chroma sits at the 128 origin', () => {
    expect(cbOf(128, 128, 128)).toBeCloseTo(128, 6);
    expect(crOf(128, 128, 128)).toBeCloseTo(128, 6);
    expect(onCount(skinMask(solid(8, 8, [128, 128, 128])))).toBe(0);
  });

  it('rejects a near-black pixel BECAUSE of the luma floor, not its chroma', () => {
    const dark: RGB = [48, 30, 22];
    // The premise: this colour's chroma is squarely inside the skin box...
    expect(cbOf(...dark)).toBeGreaterThan(77);
    expect(cbOf(...dark)).toBeLessThan(127);
    expect(crOf(...dark)).toBeGreaterThan(133);
    expect(crOf(...dark)).toBeLessThan(173);
    // ...and its luma is under the floor.
    expect(yOf(...dark)).toBeLessThan(40);
    expect(onCount(skinMask(solid(8, 8, dark)))).toBe(0);

    // The same hue, bright enough to clear the floor, IS marked.
    const bright: RGB = [144, 90, 66];
    expect(yOf(...bright)).toBeGreaterThan(40);
    expect(onCount(skinMask(solid(8, 8, bright)))).toBe(64);
  });

  it('returns a plane the size of the input bitmap', () => {
    const p = skinMask(solid(21, 13, SKIN));
    expect(p.width).toBe(21);
    expect(p.height).toBe(13);
    expect(p.data.length).toBe(21 * 13);
  });

  it('marks only the skin-toned rectangle in a mixed image', () => {
    const b = fillRect(solid(40, 40, BLUE), 10, 10, 20, 10, SKIN);
    expect(onCount(skinMask(b))).toBe(200);
  });
});

// ------------------------------------------------------------------ morphology

describe('erode', () => {
  it('removes an isolated single pixel', () => {
    const p = planeFrom([
      '.....',
      '.....',
      '..#..',
      '.....',
      '.....',
    ]);
    expect(onCount(p)).toBe(1);
    expect(onCount(erode(p, 1))).toBe(0);
  });

  it('shrinks a solid block by the radius on every side', () => {
    const p = planeRect(15, 15, [[4, 4, 7, 7]]);
    const e1 = components01(erode(p, 1), 1);
    expect(e1).toHaveLength(1);
    expect(e1[0]).toMatchObject({ x: 5, y: 5, w: 5, h: 5, pixels: 25 });

    const e2 = components01(erode(p, 2), 1);
    expect(e2).toHaveLength(1);
    expect(e2[0]).toMatchObject({ x: 6, y: 6, w: 3, h: 3, pixels: 9 });
  });

  it('is the identity at radius 0', () => {
    const p = planeRect(10, 10, [[2, 3, 4, 5]]);
    expect(components01(erode(p, 0), 1)[0]).toMatchObject({ x: 2, y: 3, w: 4, h: 5, pixels: 20 });
  });

  it('erases a block smaller than the structuring element', () => {
    const p = planeRect(11, 11, [[5, 5, 2, 2]]);
    expect(onCount(erode(p, 2))).toBe(0);
  });
});

describe('dilate', () => {
  it('grows a block by exactly the radius', () => {
    const p = planeRect(21, 21, [[9, 9, 3, 3]]);
    const d1 = components01(dilate(p, 1), 1);
    expect(d1).toHaveLength(1);
    expect(d1[0]).toMatchObject({ x: 8, y: 8, w: 5, h: 5, pixels: 25 });

    const d2 = components01(dilate(p, 2), 1);
    expect(d2).toHaveLength(1);
    expect(d2[0]).toMatchObject({ x: 7, y: 7, w: 7, h: 7, pixels: 49 });
  });

  it('grows a single pixel into a (2r+1) square', () => {
    const p = planeRect(11, 11, [[5, 5, 1, 1]]);
    expect(onCount(dilate(p, 3))).toBe(49);
  });

  it('is the identity at radius 0', () => {
    const p = planeRect(10, 10, [[2, 3, 4, 5]]);
    expect(onCount(dilate(p, 0))).toBe(20);
  });
});

describe('opening and closing', () => {
  it('open (erode then dilate) drops speckle but leaves a solid block intact', () => {
    const p = planeRect(24, 24, [[2, 2, 8, 8], [17, 3, 1, 1], [3, 17, 1, 1], [19, 19, 1, 1]]);
    expect(components01(p, 1)).toHaveLength(4);

    const opened = components01(dilate(erode(p, 1), 1), 1);
    expect(opened).toHaveLength(1);
    expect(opened[0]).toMatchObject({ x: 2, y: 2, w: 8, h: 8, pixels: 64 });
  });

  it('close (dilate then erode) bridges a two-pixel gap between blocks', () => {
    const p = planeRect(20, 12, [[2, 2, 6, 6], [10, 2, 6, 6]]);
    expect(components01(p, 1)).toHaveLength(2);

    const closed = components01(erode(dilate(p, 1), 1), 1);
    expect(closed).toHaveLength(1);
    expect(closed[0]).toMatchObject({ x: 2, y: 2, w: 14, h: 6, pixels: 84 });
  });

  it('close does NOT bridge a gap wider than twice the radius', () => {
    const p = planeRect(24, 12, [[2, 2, 6, 6], [13, 2, 6, 6]]);
    expect(components01(erode(dilate(p, 1), 1), 1)).toHaveLength(2);
  });
});

// ------------------------------------------------------------------ components

describe('components01', () => {
  it('finds exactly 2 blocks when 2 are drawn apart, with correct boxes', () => {
    const p = planeRect(20, 20, [[2, 2, 4, 4], [12, 13, 4, 4]]);
    const c = components01(p, 1);
    expect(c).toHaveLength(2);
    expect(c[0]).toMatchObject({ x: 2, y: 2, w: 4, h: 4, pixels: 16 });
    expect(c[1]).toMatchObject({ x: 12, y: 13, w: 4, h: 4, pixels: 16 });
  });

  it('finds 1 when the blocks share an edge', () => {
    const p = planeRect(20, 20, [[2, 2, 4, 4], [6, 2, 4, 4]]);
    const c = components01(p, 1);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ x: 2, y: 2, w: 8, h: 4, pixels: 32 });
  });

  it('finds 1 when the blocks touch only diagonally — connectivity really is 8', () => {
    const p = planeRect(20, 20, [[2, 2, 4, 4], [6, 6, 4, 4]]);
    const c = components01(p, 1);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ x: 2, y: 2, w: 8, h: 8, pixels: 32 });
  });

  it('respects minPixels', () => {
    const p = planeRect(20, 20, [[2, 2, 4, 4], [12, 12, 2, 2]]);
    expect(components01(p, 1)).toHaveLength(2);
    expect(components01(p, 5)).toHaveLength(1);
    expect(components01(p, 16)).toHaveLength(1);
    expect(components01(p, 17)).toHaveLength(0);
  });

  it('returns [] for an empty plane and for a zero-sized plane', () => {
    expect(components01(planeRect(10, 10, []), 1)).toHaveLength(0);
    expect(components01({ width: 0, height: 0, data: new Float32Array(0) }, 1)).toHaveLength(0);
  });

  it('treats a fully-on plane as one component covering the frame', () => {
    const c = components01(planeRect(9, 7, [[0, 0, 9, 7]]), 1);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ x: 0, y: 0, w: 9, h: 7, pixels: 63 });
  });

  it('orders components largest-first, deterministically', () => {
    const p = planeRect(30, 30, [[20, 20, 3, 3], [2, 2, 6, 6], [12, 2, 4, 4]]);
    const c = components01(p, 1);
    expect(c.map((k) => k.pixels)).toEqual([36, 16, 9]);
    expect(JSON.stringify(components01(p, 1))).toBe(JSON.stringify(c));
  });
});

// -------------------------------------------------------------- detectFaces

describe('detectFaces — detection', () => {
  it('finds exactly one region for a skin-toned box on a blue field', () => {
    const b = fillRect(solid(1280, 720, BLUE), 420, 140, 320, 420, SKIN);
    expect(detectFaces(b)).toHaveLength(1);
  });

  it('finds exactly one region for a skin-toned ellipse on a blue field', () => {
    const b = fillEllipse(solid(1280, 720, BLUE), 640, 340, 140, 190, SKIN);
    expect(detectFaces(b)).toHaveLength(1);
  });

  it('puts the box within a few percent of where it was drawn', () => {
    // 8 source px is 2.5% of the drawn width and 1.9% of the drawn height. The
    // budget covers the 640px working grid (2 source px per cell) plus whatever
    // the Lanczos downscale does to the two boundary rows.
    const b = fillRect(solid(1280, 720, BLUE), 420, 140, 320, 420, SKIN);
    const f = detectFaces(b)[0]!;
    expect(Math.abs(f.x - 420)).toBeLessThanOrEqual(8);
    expect(Math.abs(f.y - 140)).toBeLessThanOrEqual(8);
    expect(Math.abs(f.w - 320)).toBeLessThanOrEqual(8);
    expect(Math.abs(f.h - 420)).toBeLessThanOrEqual(8);
  });

  it('places an ellipse box on the ellipse bounds, not on its own bounding square', () => {
    const b = fillEllipse(solid(1280, 720, BLUE), 640, 340, 140, 190, SKIN);
    const f = detectFaces(b)[0]!;
    expect(Math.abs(f.x - 500)).toBeLessThanOrEqual(8);
    expect(Math.abs(f.y - 150)).toBeLessThanOrEqual(8);
    expect(Math.abs(f.w - 281)).toBeLessThanOrEqual(8);
    expect(Math.abs(f.h - 381)).toBeLessThanOrEqual(8);
  });

  it('reports confidence and skinRatio inside 0..1, high for a clean solid subject', () => {
    const b = fillRect(solid(1280, 720, BLUE), 420, 140, 320, 420, SKIN);
    const f = detectFaces(b)[0]!;
    expect(f.confidence).toBeGreaterThan(0);
    expect(f.confidence).toBeLessThanOrEqual(1);
    expect(f.skinRatio).toBeGreaterThan(0.9);
    expect(f.skinRatio).toBeLessThanOrEqual(1);
    expect(f.confidence).toBeGreaterThan(0.85);
  });

  it('gives an ellipse a lower skinRatio than a box, near pi/4 — the ratio measures something real', () => {
    const rect = detectFaces(fillRect(solid(1280, 720, BLUE), 420, 140, 320, 420, SKIN))[0]!;
    const ell = detectFaces(fillEllipse(solid(1280, 720, BLUE), 640, 340, 140, 190, SKIN))[0]!;
    expect(ell.skinRatio).toBeLessThan(rect.skinRatio);
    // An ellipse covers pi/4 of its bounding box. That is the number skinRatio
    // should recover, and recovering it is what shows the ratio is measured on
    // the raw mask rather than on the post-morphology component.
    expect(ell.skinRatio).toBeCloseTo(Math.PI / 4, 2);
  });

  it('returns regions largest-first', () => {
    const b = solid(1280, 720, BLUE);
    fillRect(b, 150, 150, 300, 400, SKIN);
    fillRect(b, 800, 250, 160, 220, SKIN);
    const faces = detectFaces(b);
    expect(faces).toHaveLength(2);
    expect(faces[0]!.w * faces[0]!.h).toBeGreaterThan(faces[1]!.w * faces[1]!.h);
    expect(Math.abs(faces[0]!.x - 150)).toBeLessThanOrEqual(8);
    expect(Math.abs(faces[1]!.x - 800)).toBeLessThanOrEqual(8);
  });
});

describe('detectFaces — rejection (the false-positive guards)', () => {
  it('returns [] for an all-blue image', () => {
    expect(detectFaces(solid(1280, 720, BLUE))).toEqual([]);
  });

  it('returns [] for an all-black image', () => {
    expect(detectFaces(solid(1280, 720, BLACK))).toEqual([]);
  });

  it('REJECTS a full-frame skin-coloured image — that is a background, not a face', () => {
    expect(detectFaces(solid(1280, 720, SKIN))).toEqual([]);
  });

  it('rejects a full-frame SQUARE skin image, so the area guard is doing the work', () => {
    // A square frame passes the aspect filter (1.0 is inside 0.6..1.5), so only the
    // frame-coverage guard can reject this. Proof that it is not the aspect test
    // rejecting it by accident: the same square aspect at half the frame IS detected.
    expect(detectFaces(solid(512, 512, SKIN))).toEqual([]);
    const partial = fillRect(solid(512, 512, BLUE), 150, 150, 200, 200, SKIN);
    expect(detectFaces(partial)).toHaveLength(1);
  });

  it('rejects a skin-coloured bar that is far wider than it is tall', () => {
    const b = fillRect(solid(1280, 720, BLUE), 200, 300, 800, 120, SKIN);
    expect(detectFaces(b)).toEqual([]);
  });

  it('rejects a skin-coloured bar that is far taller than it is wide', () => {
    const b = fillRect(solid(1280, 720, BLUE), 600, 100, 60, 500, SKIN);
    expect(detectFaces(b)).toEqual([]);
  });

  it('rejects a speck of skin far below the minimum area', () => {
    const b = fillRect(solid(1280, 720, BLUE), 600, 300, 6, 8, SKIN);
    expect(detectFaces(b)).toEqual([]);
  });

  it('survives degenerate inputs without throwing', () => {
    expect(detectFaces(solid(1, 1, SKIN))).toEqual([]);
    expect(detectFaces({ width: 0, height: 0, rgba: new Uint8ClampedArray(0) })).toEqual([]);
  });
});

describe('detectFaces — coordinate space and determinism', () => {
  it('returns boxes in SOURCE coordinates, not the 640px working space', () => {
    // Drawn at x=800 on a 1280-wide source. In the 640px working space that box
    // starts at x=400, so an x above 640 can only come from source coordinates.
    const b = fillRect(solid(1280, 720, BLUE), 800, 400, 240, 300, SKIN);
    const f = detectFaces(b)[0]!;
    expect(f.x).toBeGreaterThan(640);
    expect(Math.abs(f.x - 800)).toBeLessThanOrEqual(8);
    expect(Math.abs(f.y - 400)).toBeLessThanOrEqual(8);
    expect(f.x + f.w).toBeLessThanOrEqual(1280);
    expect(f.y + f.h).toBeLessThanOrEqual(720);
    expect(f.h).toBeGreaterThan(240);
  });

  it('gives byte-identical JSON for the same input twice', () => {
    const make = () => {
      const b = solid(1280, 720, BLUE);
      fillEllipse(b, 500, 300, 130, 175, SKIN);
      fillRect(b, 900, 380, 150, 190, SKIN);
      return b;
    };
    const a = JSON.stringify(detectFaces(make()));
    const c = JSON.stringify(detectFaces(make()));
    expect(a).toBe(c);
    expect(JSON.parse(a)).toHaveLength(2);

    // ...and repeated calls on one bitmap agree too.
    const one = make();
    expect(JSON.stringify(detectFaces(one))).toBe(JSON.stringify(detectFaces(one)));
  });
});

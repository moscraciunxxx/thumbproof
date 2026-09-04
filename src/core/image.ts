/**
 * ThumbProof — image primitives (colour transfer, resampling, cropping).
 *
 * ============================================================================
 * COLOUR-SPACE POLICY — read before changing anything in this file
 * ============================================================================
 *
 * 1. `toGray` linearises sRGB, applies the Rec.709 luma weights
 *    (0.2126 / 0.7152 / 0.0722) in LINEAR light — which is the only place those
 *    weights are physically meaningful — and then re-encodes the resulting
 *    luminance through the sRGB transfer function so the plane is back in a
 *    PERCEPTUAL [0,1] domain. Every downstream module (SWT, SSIM, saliency,
 *    hashing) therefore sees perceptually-uniform grey, which is what edge and
 *    structure operators are tuned for.
 *
 * 2. `resizeLanczos` / `resizeBox` resample in the ENCODED sRGB domain, NOT in
 *    linear light. This is a deliberate deviation from "colorimetrically
 *    correct" resampling. ThumbProof's job is to predict what a viewer actually
 *    sees when YouTube and the browser shrink a thumbnail to 168 CSS px, and
 *    browsers, `<img>` scaling and every mainstream CDN resize in the encoded
 *    domain. Simulating the real pipeline beats simulating the ideal one.
 *
 * ============================================================================
 * DETERMINISM
 * ============================================================================
 * All reductions run in a fixed row-major scan order, so there is no
 * ordering-dependent floating-point drift. The only transcendental functions
 * used are `Math.pow` (sRGB transfer) and `Math.sin` (Lanczos kernel), whose
 * results are implementation-defined in the last ULP across JS engines. Both
 * are neutralised: kernel weights are quantised to 1e-9 before normalisation
 * (see `QUANT`), and every output is quantised to 8 bits. A 1-ULP disagreement
 * cannot survive either step.
 */

import type { Bitmap, Plane } from './types';

/** Lanczos `a` parameter. 3 = the standard Lanczos-3 lobe count. */
const LANCZOS_A = 3;

/** Kernel weights are snapped to this many steps to kill cross-engine `Math.sin` ULP noise. */
const QUANT = 1e9;

/** Rec.709 luma coefficients, applied in LINEAR light. */
const KR = 0.2126;
const KG = 0.7152;
const KB = 0.0722;

/**
 * sRGB electro-optical transfer function (IEC 61966-2-1): encoded → linear.
 * Input and output are in [0,1]; the input is clamped. O(1).
 */
export function srgbToLinear(c: number): number {
  const x = c < 0 ? 0 : c > 1 ? 1 : c;
  return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
}

/**
 * sRGB opto-electronic transfer function (IEC 61966-2-1): linear → encoded.
 * Input and output are in [0,1]; the input is clamped. O(1).
 */
export function linearToSrgb(c: number): number {
  const x = c < 0 ? 0 : c > 1 ? 1 : c;
  return x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
}

/** Byte → linear-light lookup, built once. Removes 3 `Math.pow` calls per pixel. */
const BYTE_TO_LINEAR = new Float64Array(256);
for (let i = 0; i < 256; i++) BYTE_TO_LINEAR[i] = srgbToLinear(i / 255);

/**
 * Rec.709 (ITU-R BT.709-6) luma computed in linear light and re-encoded to the
 * perceptual sRGB domain. Alpha is ignored (thumbnails are opaque).
 * O(width * height).
 */
export function toGray(b: Bitmap): Plane {
  const n = b.width * b.height;
  const out = new Float32Array(n);
  const px = b.rgba;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const yLin = KR * BYTE_TO_LINEAR[px[o]!]! + KG * BYTE_TO_LINEAR[px[o + 1]!]! + KB * BYTE_TO_LINEAR[px[o + 2]!]!;
    out[i] = linearToSrgb(yLin);
  }
  return { width: b.width, height: b.height, data: out };
}

/**
 * Lanczos windowed-sinc kernel: `L(x) = a·sin(πx)·sin(πx/a) / (πx)²` for |x| < a.
 * Duchon (1979), as popularised for image resampling. O(1).
 */
function lanczos(x: number): number {
  if (x === 0) return 1;
  const ax = x < 0 ? -x : x;
  if (ax >= LANCZOS_A) return 0;
  const px = Math.PI * x;
  return (LANCZOS_A * Math.sin(px) * Math.sin(px / LANCZOS_A)) / (px * px);
}

/** One axis of a separable resample: for each destination sample, `taps` (index, weight) pairs. */
interface Kernel {
  readonly taps: number;
  /** length dstLen*taps — source indices, already clamped into [0, srcLen-1]. */
  readonly index: Int32Array;
  /** length dstLen*taps — weights normalised so every destination row sums to 1. */
  readonly weight: Float64Array;
}

/**
 * Build the separable Lanczos-3 contribution table for one axis.
 *
 * When downscaling (scale > 1) the filter is widened by the scale factor, which
 * is what makes this a real low-pass resample instead of a decimating point
 * sample. Out-of-range taps are edge-clamped (their weight is folded onto the
 * border pixel), and every destination row is normalised to sum to exactly 1 —
 * that normalisation is what guarantees a constant image resizes to the same
 * constant. O(dstLen * taps).
 */
function buildLanczosKernel(srcLen: number, dstLen: number): Kernel {
  const scale = srcLen / dstLen;
  const filterScale = scale > 1 ? scale : 1;
  const support = LANCZOS_A * filterScale;
  const taps = Math.ceil(support * 2) + 2;
  const index = new Int32Array(dstLen * taps);
  const weight = new Float64Array(dstLen * taps);
  const last = srcLen - 1;

  for (let j = 0; j < dstLen; j++) {
    const center = (j + 0.5) * scale;
    const start = Math.floor(center - support);
    const base = j * taps;
    let sum = 0;
    for (let t = 0; t < taps; t++) {
      const i = start + t;
      const raw = lanczos((i + 0.5 - center) / filterScale);
      const w = Math.round(raw * QUANT) / QUANT;
      index[base + t] = i < 0 ? 0 : i > last ? last : i;
      weight[base + t] = w;
      sum += w;
    }
    if (sum === 0) {
      // Unreachable for Lanczos (the centre tap is ~1) but keeps the invariant total.
      weight[base] = 1;
      sum = 1;
    }
    for (let t = 0; t < taps; t++) weight[base + t] = weight[base + t]! / sum;
  }
  return { taps, index, weight };
}

/**
 * Separable Lanczos-3 resampling with a scale-widened kernel, per-destination
 * weight normalisation and edge clamping. All four channels (including alpha)
 * are resampled in the encoded sRGB domain — see the colour-space policy above.
 *
 * The horizontal pass writes into an unquantised Float32 intermediate so the
 * vertical pass does not compound rounding error; only the final write is
 * quantised to 8 bits (`Math.round`, half away from zero).
 *
 * O(w_dst * h_src * taps_x + w_dst * h_dst * taps_y).
 */
export function resizeLanczos(b: Bitmap, w: number, h: number): Bitmap {
  assertTarget(w, h);
  const kx = buildLanczosKernel(b.width, w);
  const ky = buildLanczosKernel(b.height, h);

  // Pass 1 — horizontal, b.width -> w, keeping b.height rows.
  const mid = new Float32Array(w * b.height * 4);
  for (let y = 0; y < b.height; y++) {
    const srcRow = y * b.width * 4;
    const dstRow = y * w * 4;
    for (let x = 0; x < w; x++) {
      const base = x * kx.taps;
      let c0 = 0;
      let c1 = 0;
      let c2 = 0;
      let c3 = 0;
      for (let t = 0; t < kx.taps; t++) {
        const wt = kx.weight[base + t]!;
        if (wt === 0) continue;
        const o = srcRow + kx.index[base + t]! * 4;
        c0 += wt * b.rgba[o]!;
        c1 += wt * b.rgba[o + 1]!;
        c2 += wt * b.rgba[o + 2]!;
        c3 += wt * b.rgba[o + 3]!;
      }
      const d = dstRow + x * 4;
      mid[d] = c0;
      mid[d + 1] = c1;
      mid[d + 2] = c2;
      mid[d + 3] = c3;
    }
  }

  // Pass 2 — vertical, b.height -> h.
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const base = y * ky.taps;
    const dstRow = y * w * 4;
    for (let x = 0; x < w; x++) {
      let c0 = 0;
      let c1 = 0;
      let c2 = 0;
      let c3 = 0;
      for (let t = 0; t < ky.taps; t++) {
        const wt = ky.weight[base + t]!;
        if (wt === 0) continue;
        const o = (ky.index[base + t]! * w + x) * 4;
        c0 += wt * mid[o]!;
        c1 += wt * mid[o + 1]!;
        c2 += wt * mid[o + 2]!;
        c3 += wt * mid[o + 3]!;
      }
      const d = dstRow + x * 4;
      out[d] = Math.round(c0);
      out[d + 1] = Math.round(c1);
      out[d + 2] = Math.round(c2);
      out[d + 3] = Math.round(c3);
    }
  }
  return { width: w, height: h, rgba: out };
}

/**
 * Area-average ("box") resampling: every destination pixel is the coverage-
 * weighted mean of the source pixels its footprint overlaps. Used only as the
 * naive baseline the Lanczos path is compared against, and as the reduction
 * step for perceptual hashing (where its stability beats Lanczos' ringing).
 * On upscale the footprint is sub-pixel, so it degenerates to nearest-neighbour.
 * O(w_dst * h_dst * footprint).
 */
export function resizeBox(b: Bitmap, w: number, h: number): Bitmap {
  assertTarget(w, h);
  const out = new Uint8ClampedArray(w * h * 4);
  const sx = b.width / w;
  const sy = b.height / h;
  for (let y = 0; y < h; y++) {
    const y0 = y * sy;
    const y1 = (y + 1) * sy;
    const iy0 = Math.floor(y0);
    const iy1 = Math.min(b.height - 1, Math.ceil(y1) - 1);
    for (let x = 0; x < w; x++) {
      const x0 = x * sx;
      const x1 = (x + 1) * sx;
      const ix0 = Math.floor(x0);
      const ix1 = Math.min(b.width - 1, Math.ceil(x1) - 1);
      let c0 = 0;
      let c1 = 0;
      let c2 = 0;
      let c3 = 0;
      let wsum = 0;
      for (let iy = iy0; iy <= iy1; iy++) {
        const wy = Math.min(iy + 1, y1) - Math.max(iy, y0);
        if (wy <= 0) continue;
        for (let ix = ix0; ix <= ix1; ix++) {
          const wx = Math.min(ix + 1, x1) - Math.max(ix, x0);
          if (wx <= 0) continue;
          const wt = wx * wy;
          const o = (iy * b.width + ix) * 4;
          c0 += wt * b.rgba[o]!;
          c1 += wt * b.rgba[o + 1]!;
          c2 += wt * b.rgba[o + 2]!;
          c3 += wt * b.rgba[o + 3]!;
          wsum += wt;
        }
      }
      const d = (y * w + x) * 4;
      if (wsum === 0) {
        const o = (Math.min(b.height - 1, iy0) * b.width + Math.min(b.width - 1, ix0)) * 4;
        out[d] = b.rgba[o]!;
        out[d + 1] = b.rgba[o + 1]!;
        out[d + 2] = b.rgba[o + 2]!;
        out[d + 3] = b.rgba[o + 3]!;
      } else {
        out[d] = Math.round(c0 / wsum);
        out[d + 1] = Math.round(c1 / wsum);
        out[d + 2] = Math.round(c2 / wsum);
        out[d + 3] = Math.round(c3 / wsum);
      }
    }
  }
  return { width: w, height: h, rgba: out };
}

/**
 * Extract an axis-aligned sub-rectangle. Coordinates are floored to integers and
 * intersected with the source bounds; an empty intersection throws.
 * O(w * h).
 */
export function cropRect(b: Bitmap, x: number, y: number, w: number, h: number): Bitmap {
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(b.width, Math.floor(x) + Math.floor(w));
  const y1 = Math.min(b.height, Math.floor(y) + Math.floor(h));
  const cw = x1 - x0;
  const ch = y1 - y0;
  if (cw <= 0 || ch <= 0) {
    throw new Error(
      `cropRect: rect (${x},${y},${w},${h}) does not intersect the ${b.width}x${b.height} image`,
    );
  }
  const out = new Uint8ClampedArray(cw * ch * 4);
  for (let yy = 0; yy < ch; yy++) {
    const src = ((y0 + yy) * b.width + x0) * 4;
    out.set(b.rgba.subarray(src, src + cw * 4), yy * cw * 4);
  }
  return { width: cw, height: ch, rgba: out };
}

/**
 * Render a single-channel plane as an opaque grey Bitmap for visualisation.
 * Values are clamped to [0,1] and quantised to 8 bits. O(w * h).
 */
export function planeToBitmap(p: Plane): Bitmap {
  const n = p.width * p.height;
  const out = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const v = p.data[i]!;
    const g = Math.round((v < 0 ? 0 : v > 1 ? 1 : v) * 255);
    const o = i * 4;
    out[o] = g;
    out[o + 1] = g;
    out[o + 2] = g;
    out[o + 3] = 255;
  }
  return { width: p.width, height: p.height, rgba: out };
}

/**
 * Separable Gaussian blur on a plane, radius = ceil(3σ), edge-clamped.
 * Weights are normalised and quantised like the Lanczos kernel, so a constant
 * plane blurs to the same constant. O(w * h * radius).
 *
 * Exported because both the Canny stage (`swt.ts`) and the spectral-residual
 * stage (`saliency.ts`) need it; it is a shared primitive, not public product API.
 */
export function gaussianBlurPlane(p: Plane, sigma: number): Plane {
  if (!(sigma > 0)) return { width: p.width, height: p.height, data: Float32Array.from(p.data) };
  const r = Math.max(1, Math.ceil(3 * sigma));
  const k = new Float64Array(2 * r + 1);
  const inv = 1 / (2 * sigma * sigma);
  let sum = 0;
  for (let i = -r; i <= r; i++) {
    const w = Math.round(Math.exp(-(i * i) * inv) * QUANT) / QUANT;
    k[i + r] = w;
    sum += w;
  }
  for (let i = 0; i < k.length; i++) k[i] = k[i]! / sum;

  const w = p.width;
  const h = p.height;
  const tmp = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let t = -r; t <= r; t++) {
        const sxi = x + t < 0 ? 0 : x + t >= w ? w - 1 : x + t;
        acc += k[t + r]! * p.data[y * w + sxi]!;
      }
      tmp[y * w + x] = acc;
    }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let t = -r; t <= r; t++) {
        const syi = y + t < 0 ? 0 : y + t >= h ? h - 1 : y + t;
        acc += k[t + r]! * tmp[syi * w + x]!;
      }
      out[y * w + x] = acc;
    }
  }
  return { width: w, height: h, data: out };
}

/**
 * Bilinear plane resample with half-pixel centre alignment and edge clamping.
 * Used to lift the 64x64 saliency map back to a working resolution; bilinear is
 * chosen over Lanczos here precisely because it cannot overshoot, so the map
 * stays inside [0,1] without a second normalisation pass. O(w_dst * h_dst).
 */
export function resizePlaneBilinear(p: Plane, w: number, h: number): Plane {
  assertTarget(w, h);
  const out = new Float32Array(w * h);
  const sx = p.width / w;
  const sy = p.height / h;
  for (let y = 0; y < h; y++) {
    let fy = (y + 0.5) * sy - 0.5;
    if (fy < 0) fy = 0;
    if (fy > p.height - 1) fy = p.height - 1;
    const y0 = Math.floor(fy);
    const y1 = Math.min(p.height - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < w; x++) {
      let fx = (x + 0.5) * sx - 0.5;
      if (fx < 0) fx = 0;
      if (fx > p.width - 1) fx = p.width - 1;
      const x0 = Math.floor(fx);
      const x1 = Math.min(p.width - 1, x0 + 1);
      const tx = fx - x0;
      const a = p.data[y0 * p.width + x0]!;
      const b2 = p.data[y0 * p.width + x1]!;
      const c = p.data[y1 * p.width + x0]!;
      const d = p.data[y1 * p.width + x1]!;
      out[y * w + x] = a + (b2 - a) * tx + (c - a) * ty + (a - b2 - c + d) * tx * ty;
    }
  }
  return { width: w, height: h, data: out };
}

function assertTarget(w: number, h: number): void {
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1) {
    throw new Error(`resize: target size must be positive integers, got ${w}x${h}`);
  }
}

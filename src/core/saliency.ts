/**
 * Spectral Residual saliency (Hou & Zhang, CVPR 2007).
 *
 * "Saliency Detection: A Spectral Residual Approach". The insight is that the
 * log-amplitude spectrum of natural images is statistically smooth, so whatever
 * departs from that smoothness is the novel — and therefore attention-grabbing —
 * part of the image. Subtract a locally averaged log spectrum, transform back,
 * and the residual lights up the parts of the frame the eye goes to first.
 *
 * Chosen over a learned saliency model on purpose: it is 20 lines of arithmetic,
 * has no weights to download, and is deterministic. A CNN would predict better and
 * would make every number in this tool unverifiable.
 *
 * Bottom-up only. It does not know what a face is.
 */

import type { Bitmap, Plane, SaliencyResult } from './types';
import { toGray, resizeBox, gaussianBlurPlane, resizePlaneBilinear } from './image';

/** The paper's own working scale. Also conveniently a power of two. */
const N = 64;

/**
 * In-place radix-2 Cooley-Tukey FFT over a square power-of-two grid, applied to
 * rows then columns. `inverse` conjugates and scales by 1/(w*h).
 * O(n log n) per axis.
 */
export function fft2(re: Float32Array, im: Float32Array, w: number, h: number, inverse: boolean): void {
  if ((w & (w - 1)) !== 0 || (h & (h - 1)) !== 0) {
    throw new Error(`fft2: dimensions must be powers of two, got ${w}x${h}`);
  }
  const rowRe = new Float32Array(w);
  const rowIm = new Float32Array(w);
  for (let y = 0; y < h; y++) {
    const o = y * w;
    for (let x = 0; x < w; x++) { rowRe[x] = re[o + x] ?? 0; rowIm[x] = im[o + x] ?? 0; }
    fft1(rowRe, rowIm, inverse);
    for (let x = 0; x < w; x++) { re[o + x] = rowRe[x] ?? 0; im[o + x] = rowIm[x] ?? 0; }
  }

  const colRe = new Float32Array(h);
  const colIm = new Float32Array(h);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) { colRe[y] = re[y * w + x] ?? 0; colIm[y] = im[y * w + x] ?? 0; }
    fft1(colRe, colIm, inverse);
    for (let y = 0; y < h; y++) { re[y * w + x] = colRe[y] ?? 0; im[y * w + x] = colIm[y] ?? 0; }
  }

  if (inverse) {
    const s = 1 / (w * h);
    for (let i = 0; i < re.length; i++) { re[i] = (re[i] ?? 0) * s; im[i] = (im[i] ?? 0) * s; }
  }
}

/** In-place 1D FFT, decimation-in-time with bit-reversal permutation. */
function fft1(re: Float32Array, im: Float32Array, inverse: boolean): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i] ?? 0; re[i] = re[j] ?? 0; re[j] = tr;
      const ti = im[i] ?? 0; im[i] = im[j] ?? 0; im[j] = ti;
    }
  }
  const sign = inverse ? 1 : -1;
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (sign * 2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ar = re[i + k] ?? 0, ai = im[i + k] ?? 0;
        const br = re[i + k + len / 2] ?? 0, bi = im[i + k + len / 2] ?? 0;
        const tr = br * cr - bi * ci;
        const ti = br * ci + bi * cr;
        re[i + k] = ar + tr; im[i + k] = ai + ti;
        re[i + k + len / 2] = ar - tr; im[i + k + len / 2] = ai - ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

/** 3x3 box filter with edge clamping — the paper's local average of the log spectrum. */
function box3(src: Float32Array, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = Math.min(h - 1, Math.max(0, y + dy));
        for (let dx = -1; dx <= 1; dx++) {
          const xx = Math.min(w - 1, Math.max(0, x + dx));
          s += src[yy * w + xx] ?? 0;
        }
      }
      out[y * w + x] = s / 9;
    }
  }
  return out;
}

/**
 * Full pipeline: grayscale -> 64x64 -> FFT -> spectral residual -> inverse FFT ->
 * squared magnitude -> Gaussian blur -> normalise -> upsample.
 *
 * `onSubject` is left at 0; the orchestrator fills it once it knows where the text
 * and subject regions are, because saliency alone cannot say what a subject is.
 */
export function spectralResidualSaliency(b: Bitmap): SaliencyResult {
  const small = toGray(resizeBox(b, N, N));

  const re = new Float32Array(N * N);
  const im = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) re[i] = small.data[i] ?? 0;

  fft2(re, im, N, N, false);

  const logAmp = new Float32Array(N * N);
  const phaseR = new Float32Array(N * N);
  const phaseI = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) {
    const r = re[i] ?? 0;
    const m = im[i] ?? 0;
    const amp = Math.hypot(r, m);
    logAmp[i] = Math.log(amp + 1e-8);
    // Unit vector carrying the phase, so we can rebuild with a new amplitude.
    if (amp > 1e-12) { phaseR[i] = r / amp; phaseI[i] = m / amp; }
    else { phaseR[i] = 1; phaseI[i] = 0; }
  }

  const avg = box3(logAmp, N, N);
  for (let i = 0; i < N * N; i++) {
    const residual = Math.exp((logAmp[i] ?? 0) - (avg[i] ?? 0));
    re[i] = residual * (phaseR[i] ?? 0);
    im[i] = residual * (phaseI[i] ?? 0);
  }

  fft2(re, im, N, N, true);

  const raw = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) {
    const r = re[i] ?? 0;
    const m = im[i] ?? 0;
    raw[i] = r * r + m * m; // squared magnitude, per the paper
  }

  const blurred = gaussianBlurPlane({ width: N, height: N, data: raw }, 2.5);

  let max = 0;
  for (let i = 0; i < N * N; i++) max = Math.max(max, blurred.data[i] ?? 0);
  const norm = new Float32Array(N * N);
  if (max > 0) for (let i = 0; i < N * N; i++) norm[i] = (blurred.data[i] ?? 0) / max;

  // Peak located on the 64x64 grid, then mapped back to source coordinates.
  let peakIdx = 0;
  let peakVal = -1;
  for (let i = 0; i < N * N; i++) {
    const v = norm[i] ?? 0;
    if (v > peakVal) { peakVal = v; peakIdx = i; }
  }
  const px = ((peakIdx % N) + 0.5) * (b.width / N);
  const py = (Math.floor(peakIdx / N) + 0.5) * (b.height / N);

  // Upsample to a workable resolution for the orchestrator's mass integration.
  const map: Plane = resizePlaneBilinear({ width: N, height: N, data: norm }, 160, 90);

  return { map, peak: { x: px, y: py }, onSubject: 0 };
}

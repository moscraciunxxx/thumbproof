/**
 * Deterministic digests.
 *
 * The fingerprint printed under the score exists so that any number in a demo can
 * be reproduced from the source image. That only means something if the hash is
 * exact, so this uses BigInt rather than the usual 32-bit-float FNV shortcut.
 */

import type { Bitmap } from './types';
import { resizeBox, toGray } from './image';

const FNV_OFFSET_64 = 0xcbf29ce484222325n;
const FNV_PRIME_64 = 0x100000001b3n;
const MASK_64 = 0xffffffffffffffffn;

/**
 * FNV-1a, 64-bit (Fowler-Noll-Vo). Returns 16 lowercase hex chars.
 * Verified against the canonical vector: "hello" -> a430d84680aabd0b.
 * O(n) over the input bytes.
 */
export function fnv1a64(bytes: Uint8Array | Uint8ClampedArray): string {
  let h = FNV_OFFSET_64;
  for (let i = 0; i < bytes.length; i++) {
    h ^= BigInt(bytes[i] ?? 0);
    h = (h * FNV_PRIME_64) & MASK_64;
  }
  return h.toString(16).padStart(16, '0');
}

/** Convenience wrapper so callers do not have to reach for a TextEncoder. */
export function fnv1a64String(s: string): string {
  return fnv1a64(new TextEncoder().encode(s));
}

/**
 * dHash: 64 bits of "is each pixel brighter than the one to its right", computed
 * on a 9x8 grayscale reduction. Robust to brightness, gamma and mild rescaling —
 * which is what we want for the shelf test, where two thumbnails count as the same
 * if they share a composition regardless of exposure.
 *
 * Bit order is row-major, MSB first, so the hex string is stable and comparable.
 * O(1) after the fixed 9x8 reduction.
 */
export function perceptualHash(b: Bitmap): string {
  const g = toGray(resizeBox(b, 9, 8));
  let bits = 0n;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const left = g.data[y * 9 + x] ?? 0;
      const right = g.data[y * 9 + x + 1] ?? 0;
      bits = (bits << 1n) | (left > right ? 1n : 0n);
    }
  }
  return bits.toString(16).padStart(16, '0');
}

/**
 * Hamming distance between two equal-length hex strings, counted in bits.
 * Throws on a length mismatch rather than silently comparing prefixes.
 */
export function hammingHex(a: string, b: string): number {
  if (a.length !== b.length) {
    throw new Error(`hammingHex: length mismatch (${a.length} vs ${b.length})`);
  }
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i] ?? '0', 16) ^ parseInt(b[i] ?? '0', 16);
    while (x) { d += x & 1; x >>= 1; }
  }
  return d;
}

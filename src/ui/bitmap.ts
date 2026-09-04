/** Bridges between our pure `Bitmap` type and the browser's canvas/image APIs. */

import type { Bitmap } from '../core/types';
import { svgToDataUrl } from '../fixtures/samples';

export function canvasToBitmap(c: HTMLCanvasElement): Bitmap {
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2D canvas context unavailable');
  const d = ctx.getImageData(0, 0, c.width, c.height);
  return { width: c.width, height: c.height, rgba: d.data };
}

export function bitmapToCanvas(b: Bitmap): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = b.width;
  c.height = b.height;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  // Copy into a fresh ArrayBuffer-backed view: ImageData rejects a possibly
  // SharedArrayBuffer-backed Uint8ClampedArray under strict DOM types.
  const data = new Uint8ClampedArray(b.width * b.height * 4);
  data.set(b.rgba);
  ctx.putImageData(new ImageData(data, b.width, b.height), 0, 0);
  return c;
}

/**
 * Draw any image source into a fixed 1280x720 frame, letterboxing rather than
 * stretching so we never invent aspect ratio the creator did not choose.
 */
export function normalizeTo16x9(img: CanvasImageSource, w = 1280, h = 720): Bitmap {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2D canvas context unavailable');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);

  const sw = Number((img as HTMLImageElement).naturalWidth ?? (img as HTMLCanvasElement).width);
  const sh = Number((img as HTMLImageElement).naturalHeight ?? (img as HTMLCanvasElement).height);
  const scale = Math.min(w / sw, h / sh);
  const dw = sw * scale;
  const dh = sh * scale;
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  return canvasToBitmap(c);
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not decode image: ${src.slice(0, 64)}`));
    img.src = src;
  });
}

/**
 * Rasterise a standalone SVG document string. No network, no external refs.
 * Encoding lives with the samples so there is exactly one definition of it.
 */
export function svgToImage(svg: string): Promise<HTMLImageElement> {
  return loadImage(svgToDataUrl(svg));
}

export async function fileToBitmap(file: File): Promise<Bitmap> {
  const url = URL.createObjectURL(file);
  try {
    return normalizeTo16x9(await loadImage(url));
  } finally {
    URL.revokeObjectURL(url);
  }
}

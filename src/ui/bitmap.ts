/** Bridges between our pure `Bitmap` type and the browser's canvas/image APIs. */

import type { Bitmap } from '../core/types';
import { svgToDataUrl } from '../fixtures/samples';
import { cropRect } from '../core/image';
import { fetchBestThumbnail, type YtVariant } from '../core/ytimg';

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

/**
 * Strip letterbox bars from a 4:3 YouTube raster.
 *
 * `sddefault`, `hqdefault` and `default` are 4:3, and YouTube pads a 16:9 upload
 * into them with black bars top and bottom. Measuring those directly would treat the
 * padding as artwork: contrast, saliency and the delivered cap-height ratio would all
 * be computed against a frame that is a third taller than the one a viewer sees.
 *
 * Detects the bars by scanning inward for the first row that is not near-black,
 * rather than assuming an exact 16:9 inset — YouTube's padding is not always exact.
 */
export function cropLetterbox(b: Bitmap, threshold = 18): Bitmap {
  const rowIsDark = (y: number): boolean => {
    for (let x = 0; x < b.width; x += 4) {
      const i = (y * b.width + x) * 4;
      if ((b.rgba[i] ?? 0) > threshold || (b.rgba[i + 1] ?? 0) > threshold || (b.rgba[i + 2] ?? 0) > threshold) {
        return false;
      }
    }
    return true;
  };

  let top = 0;
  while (top < b.height - 1 && rowIsDark(top)) top++;
  let bottom = b.height - 1;
  while (bottom > top && rowIsDark(bottom)) bottom--;

  const h = bottom - top + 1;
  // Refuse to "fix" a thumbnail that is simply dark at the edges.
  if (h < b.height * 0.5 || h === b.height) return b;
  return cropRect(b, 0, top, b.width, h);
}

/**
 * Load a real thumbnail for a YouTube video id, best raster first.
 * Public CDN, no API key, no account, and nothing is sent anywhere — the image is
 * fetched straight into a canvas on the viewer's own machine.
 */
export async function bitmapFromYouTube(id: string): Promise<{ bitmap: Bitmap; variant: YtVariant }> {
  const variant = await fetchBestThumbnail(id);
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error(`Could not load ${variant.name} for ${id}`));
    im.src = variant.url;
  });

  const raw = normalizeTo16x9(img, img.naturalWidth, img.naturalHeight);
  // 4:3 rungs carry letterbox padding; strip it before anything measures the frame.
  const aspect = img.naturalWidth / img.naturalHeight;
  const cleaned = aspect < 1.6 ? cropLetterbox(raw) : raw;
  return { bitmap: normalizeTo16x9(bitmapToCanvas(cleaned)), variant };
}

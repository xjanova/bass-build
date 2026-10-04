import type { ResolvedShape } from '../sim/driverShape';
import type { Marks } from './media';

/** Longest side a stored photo keeps: plenty for a texture, small enough to store (~300–600 kB as JPEG). */
export const MAX_SIDE = 1600;

/** The circle through three points, or null when they are (nearly) on one line. */
export function circleFrom3(a: [number, number], b: [number, number], c: [number, number]): { cx: number; cy: number; r: number } | null {
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
  const span = Math.max(Math.hypot(a[0] - b[0], a[1] - b[1]), Math.hypot(b[0] - c[0], b[1] - c[1]), Math.hypot(a[0] - c[0], a[1] - c[1]));
  if (Math.abs(d) < 1e-6 * span * span || span === 0) return null;
  const s = (p: [number, number]) => p[0] * p[0] + p[1] * p[1];
  const cx = (s(a) * (b[1] - c[1]) + s(b) * (c[1] - a[1]) + s(c) * (a[1] - b[1])) / d;
  const cy = (s(a) * (c[0] - b[0]) + s(b) * (a[0] - c[0]) + s(c) * (b[0] - a[0])) / d;
  return { cx, cy, r: Math.hypot(a[0] - cx, a[1] - cy) };
}

/** A photo file → JPEG no larger than MAX_SIDE (EXIF rotation applied by the browser). */
export async function shrinkPhoto(file: Blob): Promise<Blob> {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * k);
  canvas.height = Math.round(bmp.height * k);
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode'))), 'image/jpeg', 0.88));
}

export const loadImage = (blob: Blob): Promise<ImageBitmap> => createImageBitmap(blob);

/**
 * The square around a circle marked on a photo (front frame edge, magnet back), as a texture
 * canvas: the circle touches the canvas edges, outside it is transparent black.
 */
export function circleTexture(img: ImageBitmap, marks: Marks, size = 1024): HTMLCanvasElement | null {
  const p = marks.circle;
  if (!p || p.length < 3) return null;
  const px = p.map(([x, y]) => [x * img.width, y * img.height] as [number, number]);
  const c = circleFrom3(px[0], px[1], px[2]);
  if (!c) return null;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d')!;
  g.beginPath();
  g.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  g.clip();
  g.drawImage(img, c.cx - c.r, c.cy - c.r, 2 * c.r, 2 * c.r, 0, 0, size, size);
  return canvas;
}

/**
 * The magnet strip of a side photo, straightened: the two axis marks run from the front of the
 * frame to the back of the magnet, so with the measured mounting depth they give the photo's
 * scale; the strip is the magnet's height long (at the back end) and its diameter wide.
 * Returned with the magnet's front at the top.
 */
export function sideTexture(img: ImageBitmap, marks: Marks, shape: ResolvedShape, width = 512): HTMLCanvasElement | null {
  const p = marks.axis;
  if (!p || p.length < 2) return null;
  const [a, b] = p.map(([x, y]) => [x * img.width, y * img.height] as [number, number]);
  const lenPx = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (lenPx < 10) return null;
  const perM = lenPx / shape.depth;
  const stripLen = shape.magnetH * perM;
  const stripW = 2 * shape.magnetR * perM;
  const height = Math.max(16, Math.round((width * stripLen) / stripW));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext('2d')!;
  // Map the strip (axis direction → canvas down, across → canvas right) onto the canvas.
  const ux = (b[0] - a[0]) / lenPx, uy = (b[1] - a[1]) / lenPx; // along the axis
  const vx = -uy, vy = ux; // across it
  const start = lenPx - stripLen; // the magnet's front face, measured from the frame
  const sx = width / stripW, sy = height / stripLen;
  // canvas (X, Y) = ( (P−O)·v · sx + width/2 , (P−O)·u · sy − start·sy )
  g.setTransform(vx * sx, ux * sy, vy * sx, uy * sy, width / 2 - (a[0] * vx + a[1] * vy) * sx, -(a[0] * ux + a[1] * uy) * sy - start * sy);
  g.drawImage(img, 0, 0);
  return canvas;
}

import { DomainError, LIMITS, type StoredImageMime } from '@noergo/core';
import sharp from 'sharp';

type Kind = 'png' | 'jpeg' | 'webp' | 'gif';

/**
 * What a dropped picture may be, read from its first bytes (never from the name or the
 * Content-Type). SVG is not on the list: it is a document that can carry script.
 */
export function sniffImage(b: Uint8Array): Kind | null {
  const at = (i: number, ...v: number[]) => v.every((x, k) => b[i + k] === x);
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'png';
  if (at(0, 0xff, 0xd8, 0xff)) return 'jpeg';
  if (at(0, 0x47, 0x49, 0x46, 0x38)) return 'gif';
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'webp';
  return null;
}

/**
 * Decodes and re-encodes an image, so what is stored and served is pixels this server
 * wrote: no metadata (EXIF, GPS), no trailing payload, no second format hiding inside.
 * Turned upright, at most LIMITS.imageSide on the long side, one frame. Screenshots and
 * logos keep sharp edges (near-lossless); photos go lossy.
 */
export async function normalizeImage(input: Uint8Array): Promise<{ bytes: Buffer; width: number; height: number; mime: StoredImageMime }> {
  const kind = sniffImage(input);
  if (!kind) throw new DomainError('invalid', 'only PNG, JPEG, WebP and GIF images are accepted');
  const encode = (lossy: boolean) =>
    sharp(input, { limitInputPixels: LIMITS.imagePixels, failOn: 'error', animated: false })
      .rotate()
      .resize({ width: LIMITS.imageSide, height: LIMITS.imageSide, fit: 'inside', withoutEnlargement: true })
      .webp(lossy ? { quality: 84 } : { nearLossless: true, quality: 60 })
      .toBuffer({ resolveWithObject: true });
  let out;
  try {
    out = await encode(kind === 'jpeg');
    if (out.data.byteLength > LIMITS.imageStoredBytes) out = await encode(true);
  } catch {
    throw new DomainError('invalid', 'the image could not be read');
  }
  if (out.data.byteLength > LIMITS.imageStoredBytes) throw new DomainError('invalid', 'the image is too large');
  return { bytes: out.data, width: out.info.width, height: out.info.height, mime: 'image/webp' };
}

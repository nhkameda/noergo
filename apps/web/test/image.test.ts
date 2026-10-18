import { crc32 } from 'node:zlib';
import { LIMITS } from '@noergo/core';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { normalizeImage, sniffImage } from '@/lib/image';

const solid = (width: number, height: number) => sharp({ create: { width, height, channels: 3, background: '#7c3aed' } });

/** A PNG whose header claims `width` × `height`, with a valid checksum: a pixel bomb. */
async function claiming(width: number, height: number) {
  const png = Buffer.from(await solid(4, 4).png().toBuffer());
  png.writeUInt32BE(width, 16);
  png.writeUInt32BE(height, 20);
  png.writeUInt32BE(crc32(png.subarray(12, 29)), 29);
  return png;
}

describe('an uploaded image', () => {
  it('is known by its first bytes, never by its name: SVG and HTML are not images', () => {
    expect(sniffImage(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(sniffImage(new TextEncoder().encode('<!doctype html><script>1</script>'))).toBeNull();
    expect(sniffImage(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x41, 0x56, 0x49, 0x20]))).toBeNull();
  });

  it('refuses an SVG sent as a PNG', async () => {
    await expect(normalizeImage(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>'))).rejects.toMatchObject({ code: 'invalid' });
  });

  it('refuses a file that only starts like a PNG', async () => {
    const fake = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('<html><script>1</script>')]);
    await expect(normalizeImage(fake)).rejects.toMatchObject({ code: 'invalid' });
  });

  it('refuses a pixel bomb before decoding it', async () => {
    await expect(normalizeImage(await claiming(100_000, 100_000))).rejects.toMatchObject({ code: 'invalid' });
  });

  it('is stored as pixels this server wrote: no EXIF, no GPS, no trailing payload', async () => {
    const photo = await solid(64, 48)
      .jpeg()
      .withExif({ IFD0: { Make: 'Phone', Model: 'Secret 1' }, IFD3: { GPSLatitudeRef: 'S', GPSLatitude: '23/1 33/1 0/1' } })
      .toBuffer();
    expect((await sharp(photo).metadata()).exif).toBeDefined();
    const polyglot = Buffer.concat([photo, Buffer.from('<script>alert(1)</script>')]);
    const out = await normalizeImage(polyglot);
    expect(out.mime).toBe('image/webp');
    const meta = await sharp(out.bytes).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.exif).toBeUndefined();
    expect(meta.xmp).toBeUndefined();
    expect(out.bytes.includes(Buffer.from('<script>'))).toBe(false);
    expect(out.bytes.includes(Buffer.from('Secret 1'))).toBe(false);
  });

  it('is shrunk to the long side the app draws, keeping its shape', async () => {
    const out = await normalizeImage(await solid(4000, 1000).png().toBuffer());
    expect([out.width, out.height]).toEqual([LIMITS.imageSide, LIMITS.imageSide / 4]);
    expect(out.bytes.byteLength).toBeLessThanOrEqual(LIMITS.imageStoredBytes);
  });

  it('keeps one frame of an animated GIF', async () => {
    // Two frames of 8 × 16 stacked, of different colours (the encoder merges equal ones).
    const raw = Buffer.alloc(8 * 32 * 3, 0x40).fill(0xd0, 8 * 16 * 3);
    const anim = await sharp(raw, { raw: { width: 8, height: 32, channels: 3, pageHeight: 16 } }).gif().toBuffer();
    expect((await sharp(anim, { animated: true }).metadata()).pages).toBe(2);
    const out = await normalizeImage(anim);
    expect((await sharp(out.bytes, { animated: true }).metadata()).pages ?? 1).toBe(1);
    expect([out.width, out.height]).toEqual([8, 16]);
  });
});

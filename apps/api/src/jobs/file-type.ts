/** Detect the image type from magic bytes; never trust the client's mimetype. */
export type ImageExt = 'png' | 'jpg' | 'webp' | 'bmp' | 'gif';

export function detectImage(buf: Buffer): ImageExt | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0x89 && buf.subarray(1, 4).toString('ascii') === 'PNG') return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp';
  if (buf[0] === 0x42 && buf[1] === 0x4d) return 'bmp';
  if (buf.subarray(0, 4).toString('ascii') === 'GIF8') return 'gif';
  return null;
}

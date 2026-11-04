// Faceplate image metadata without dependencies: the two formats a panel can be
// and the two facts the renderer trusts (dimensions and digest).

import { createHash } from 'node:crypto';
import fs from 'node:fs';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

export function sniffImage(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 8) return null;
  if (buffer.length >= 24 && buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    if (buffer.toString('ascii', 12, 16) !== 'IHDR') return null;
    return {
      mime: 'image/png',
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20),
    };
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) return null;
      const marker = buffer[offset + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        offset += 2;
        continue;
      }
      const length = buffer.readUInt16BE(offset + 2);
      if (length < 2) return null;
      if (JPEG_SOF.has(marker)) {
        return {
          mime: 'image/jpeg',
          height: buffer.readUInt16BE(offset + 5),
          width: buffer.readUInt16BE(offset + 7),
        };
      }
      offset += 2 + length;
    }
    return null;
  }
  return null;
}

export function imageDigest(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

export function imageDataUrl(buffer, mime) {
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

export function readFaceplateImage(absPath) {
  const buffer = fs.readFileSync(absPath);
  const sniffed = sniffImage(buffer);
  if (!sniffed) return null;
  return {
    buffer,
    ...sniffed,
    sha256: imageDigest(buffer),
    dataUrl: imageDataUrl(buffer, sniffed.mime),
  };
}

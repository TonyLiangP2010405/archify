import { test } from 'node:test';
import assert from 'node:assert/strict';
import { imageDataUrl, imageDigest, sniffImage } from '../archify/renderers/shared/faceplate-meta.mjs';

// 2x1 PNG, generated once and kept as hex so the test has no binary fixture.
const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d4948445200000002000000010806000000' +
  '0000000000000000', 'hex');

test('PNG dimensions come from the IHDR chunk', () => {
  assert.deepEqual(sniffImage(PNG), { mime: 'image/png', width: 2, height: 1 });
});

test('JPEG dimensions come from the first SOF marker', () => {
  const jpeg = Buffer.from([
    0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x20, 0x00, 0x40,
    0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01, 0xff, 0xd9,
  ]);
  assert.deepEqual(sniffImage(jpeg), { mime: 'image/jpeg', width: 64, height: 32 });
});

test('anything else is rejected', () => {
  assert.equal(sniffImage(Buffer.from('<svg/>')), null);
  assert.equal(sniffImage(Buffer.alloc(0)), null);
});

test('digest and data URL match the bytes', () => {
  assert.equal(imageDigest(PNG).length, 64);
  assert.match(imageDataUrl(PNG, 'image/png'), /^data:image\/png;base64,iVBOR/);
});

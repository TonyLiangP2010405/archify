import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'archify');
const cli = path.join(skillRoot, 'bin/archify.mjs');
const PHOTO = path.join(skillRoot, 'examples/assets/patch-panel.png');
const sha256 = createHash('sha256').update(fs.readFileSync(PHOTO)).digest('hex');

// Three jacks on a wide panel: the camera sits above the third one, and that
// geometry used to leave the cable ending at the panel's left corner while the
// stub was still drawn at the jack itself.
function validate(mutate) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-stub-gap-'));
  const doc = {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Cable stub gap', output: 'gap.html' },
    components: [
      {
        id: 'brg', type: 'backend', label: 'CAM-0402-BRG', pos: [30, 250], size: [820, 153.75],
        faceplate: {
          image: { path: PHOTO, sha256 }, width: 640, height: 120,
          ports: [
            { id: 'p20v', label: '20V', x: 0.052, y: 0.512 },
            { id: 'lan', label: 'LAN', x: 0.14, y: 0.514 },
            { id: 'usb-in-1', label: 'USB IN 1', x: 0.212, y: 0.484 },
          ],
        },
      },
      { id: 'cam', type: 'external', label: 'Camera', pictogram: 'camera', pos: [144, 110], size: [120, 80] },
    ],
    connections: [{ id: 'cam-to-brg', from: 'cam', to: 'brg', toPort: 'usb-in-1' }],
  };
  mutate(doc);
  const input = path.join(dir, 'diagram.json');
  fs.writeFileSync(input, JSON.stringify(doc));
  const result = spawnSync(process.execPath, [cli, 'validate', 'architecture', input, '--json'], { encoding: 'utf8' });
  const receipt = JSON.parse(result.stdout);
  fs.rmSync(dir, { recursive: true, force: true });
  return { status: result.status, receipt };
}

test('a cable that stops short of its jack exit is reported', () => {
  const { status, receipt } = validate(() => {});
  assert.equal(status, 1);
  const entry = receipt.diagnostics.find((item) => item.code === 'architecture/cable-stub-gap');
  assert.ok(entry, 'the stub gap is reported');
  assert.equal(entry.evidence.portId ?? entry.subject.portId, 'usb-in-1');
  assert.ok(entry.evidence.gap > 100, `expected a large gap, got ${entry.evidence.gap}`);
});

test('pinning the approach side keeps the cable on the jack exit', () => {
  const { status, receipt } = validate((doc) => {
    doc.connections[0].fromSide = 'bottom';
    doc.connections[0].via = [[204, 215]];
  });
  assert.equal(status, 0, JSON.stringify(receipt.diagnostics?.map((item) => item.code)));
});

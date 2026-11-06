import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'archify');
const bin = path.join(skillRoot, 'bin/archify.mjs');
const PHOTO = path.join(skillRoot, 'examples/assets/patch-panel.png');
const sha256 = createHash('sha256').update(fs.readFileSync(PHOTO)).digest('hex');

// A portless faceplate is a product photo, not a connector panel: cameras and
// microphones belong on the diagram as pictures, and there is no silkscreen to
// keep legible, so the readable-width gate must not apply to them.
function render(ports, width) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-photo-node-'));
  const doc = {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Product photo node', output: 'photo.html', quality_profile: 'showcase' },
    components: [
      {
        id: 'cam', type: 'external', label: 'CAM-210-PTZ', pos: [40, 40], size: [width, width * 120 / 640],
        faceplate: { image: { path: PHOTO, sha256 }, width: 640, height: 120, ports },
      },
    ],
  };
  fs.writeFileSync(path.join(dir, 'diagram.json'), JSON.stringify(doc));
  const result = spawnSync(process.execPath, [bin, 'render', 'architecture', 'diagram.json', 'photo.html'], {
    cwd: dir,
    encoding: 'utf8',
  });
  return {
    status: result.status,
    stderr: result.stderr,
    html: result.status === 0 && fs.existsSync(path.join(dir, 'photo.html'))
      ? fs.readFileSync(path.join(dir, 'photo.html'), 'utf8')
      : '',
  };
}

const ONE_PORT = [{ id: 'hdmi-in-1', label: 'HDMI IN 1', x: 0.328, y: 0.5 }];

test('photo node: a portless faceplate renders as a picture at any size', () => {
  const run = render([], 200);
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.html, /<image [^>]*data-pictogram-role|data-faceplate-photo|<image href="data:image\/png/);
  assert.match(run.html, /CAM-210-PTZ/);
  // No jacks means no hole markers to draw on the picture.
  assert.doesNotMatch(run.html, /data-faceplate-port=/);
});

test('photo node: the readable-width gate still guards a real connector panel', () => {
  const run = render(ONE_PORT, 200);
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /faceplate-too-small/);
});

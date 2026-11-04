import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'archify');
const renderer = path.join(skillRoot, 'renderers/architecture/render-architecture.mjs');
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000002000000010806000000'
  + '0000000000000000', 'hex');
const sha256 = createHash('sha256').update(PNG).digest('hex');

function render(doc, digest = sha256) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-faceplate-geom-'));
  fs.mkdirSync(path.join(dir, 'faces'));
  fs.writeFileSync(path.join(dir, 'faces', 'panel.png'), PNG);
  const input = path.join(dir, 'diagram.json');
  const output = path.join(dir, 'out.html');
  fs.writeFileSync(input, JSON.stringify(doc(digest)));
  try {
    execFileSync(process.execPath, [renderer, input, output], { stdio: ['ignore', 'ignore', 'pipe'] });
    return fs.readFileSync(output, 'utf8');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const doc = (digest) => ({
  schema_version: 1,
  diagram_type: 'architecture',
  meta: { title: 'Faceplate geometry', output: 'geom.html' },
  components: [
    { id: 'tx', type: 'backend', label: 'TX', pos: [40, 40], size: [420, 210],
      faceplate: { image: { path: 'faces/panel.png', sha256: digest }, width: 2, height: 1,
        ports: [
          { id: 'bottom', label: 'BOTTOM', x: 0.5, y: 0.9 },
          { id: 'top', label: 'TOP', x: 0.5, y: 0.1 },
          { id: 'left', label: 'LEFT', x: 0.02, y: 0.5 },
          { id: 'weighted', label: 'WEIGHTED', x: 0.3, y: 0.4 },
        ] } },
    { id: 'rx', type: 'external', label: 'RX', pos: [400, 340], size: [120, 60] },
  ],
  connections: [
    { id: 'c-bottom', from: 'tx', to: 'rx', fromPort: 'bottom' },
    { id: 'c-top', from: 'tx', to: 'rx', fromPort: 'top' },
    { id: 'c-left', from: 'tx', to: 'rx', fromPort: 'left' },
    { id: 'c-weighted', from: 'tx', to: 'rx', fromPort: 'weighted' },
  ],
});

function points(html, id) {
  const match = html.match(new RegExp(`data-edge-id="${id}"[^>]+data-composition-points="([^"]+)"`));
  assert.ok(match, `missing ${id}`);
  return match[1].split(';').map((pair) => pair.split(',').map(Number));
}

test('the nearest edge wins in pixels, not normalized distance', () => {
  const html = render(doc);
  assert.deepEqual(points(html, 'c-bottom')[0], [250, 250]);
  assert.deepEqual(points(html, 'c-top')[0], [250, 40]);
  assert.deepEqual(points(html, 'c-left')[0], [40, 145]);
  // x*W = 126 > y*H = 84, so pixels choose the top edge where normalized
  // distance (0.3 < 0.4) would have chosen the left one.
  assert.deepEqual(points(html, 'c-weighted')[0], [166, 40]);
});

test('an ordinary cable into a faceplate avoids every hole', () => {
  const plain = doc(sha256);
  plain.connections = [{ id: 'plain', from: 'rx', to: 'tx' }];
  const html = render(() => plain);
  const end = points(html, 'plain').at(-1);
  const holes = [[250, 250], [250, 40], [40, 145], [166, 40]];
  assert.ok(!holes.some(([x, y]) => Math.abs(x - end[0]) < 1 && Math.abs(y - end[1]) < 1),
    `landed on a hole at ${JSON.stringify(end)}`);
  assert.ok([40, 460].includes(end[0]) || [40, 250].includes(end[1]), 'must stay on the border');
});

test('the artifact embeds the image as a data URL', () => {
  assert.match(render(doc), /<image [^>]*href="data:image\/png;base64,/);
});

test('validate resolves the image through a JSON snapshot', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-faceplate-path-'));
  fs.mkdirSync(path.join(dir, 'faces'));
  fs.writeFileSync(path.join(dir, 'faces', 'panel.png'), PNG);
  const input = path.join(dir, 'diagram.json');
  fs.writeFileSync(input, JSON.stringify(doc(sha256)));
  try {
    const result = execFileSync(process.execPath, [path.join(skillRoot, 'bin/archify.mjs'),
      'validate', 'architecture', input, '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    assert.equal(JSON.parse(result).ok, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

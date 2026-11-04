import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'archify');
const renderer = path.join(skillRoot, 'renderers/architecture/render-architecture.mjs');

function render(doc) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-ports-geometry-'));
  const input = path.join(tmp, 'in.json');
  const output = path.join(tmp, 'out.html');
  fs.writeFileSync(input, JSON.stringify(doc));
  try {
    execFileSync(process.execPath, [renderer, input, output], { stdio: ['ignore', 'ignore', 'pipe'] });
    return fs.readFileSync(output, 'utf8');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function points(html, id) {
  const match = html.match(new RegExp(`data-edge-id="${id}"[^>]+data-composition-points="([^"]+)"`));
  assert.ok(match, `missing connection ${id}`);
  return match[1].split(';').map((pair) => pair.split(',').map(Number));
}

const base = (connections) => ({
  schema_version: 1,
  diagram_type: 'architecture',
  meta: { title: 'Ports geometry', output: 'ports-geometry.html' },
  components: [
    { id: 'src', type: 'external', label: 'Source', pos: [100, 250], size: [120, 60],
      ports: [{ id: 'hdmi-out', label: 'HDMI OUT', side: 'right' }] },
    { id: 'matrix', type: 'backend', label: 'Matrix', pos: [400, 200], size: [240, 130],
      ports: [
        { id: 'in-1', label: 'HDMI IN 1', side: 'left' },
        { id: 'in-2', label: 'HDMI IN 2', side: 'left' },
        { id: 'out-1', label: 'HDMI OUT 1', side: 'right' },
      ] },
  ],
  connections,
});

test('a connection terminates exactly on the named port', () => {
  const html = render(base([{ id: 'feed', from: 'src', to: 'matrix', fromPort: 'hdmi-out', toPort: 'in-2' }]));
  assert.deepEqual(points(html, 'feed')[0], [220, 286]);
  assert.deepEqual(points(html, 'feed').at(-1), [400, 314]);
});

test('the route leaves a port horizontally', () => {
  const html = render(base([{ id: 'feed', from: 'src', to: 'matrix', fromPort: 'hdmi-out', toPort: 'in-1' }]));
  const pts = points(html, 'feed');
  assert.deepEqual(pts[0], [220, 286]);
  assert.deepEqual(pts.at(-1), [400, 228]);
  assert.equal(pts[1][1], 286, 'the first segment must be horizontal');
});

test('a half-ported connection still routes and keeps the port endpoint', () => {
  const html = render(base([{ id: 'feed', from: 'src', to: 'matrix', toPort: 'in-1' }]));
  assert.deepEqual(points(html, 'feed').at(-1), [400, 228]);
});

test('a portless connection avoids a ported side', () => {
  const doc = base([{ id: 'feed', from: 'src', to: 'matrix' }]);
  doc.components[0].ports = [];
  doc.components[1].ports = doc.components[1].ports.filter((port) => port.side === 'left');
  const html = render(doc);
  const ends = points(html, 'feed');
  assert.notEqual(ends.at(-1)[0], 400, 'must not enter the ported left side');
});

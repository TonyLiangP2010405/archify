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
const PHOTO = fs.readFileSync(path.join(skillRoot, 'examples/assets/patch-panel.png'));
const sha256 = createHash('sha256').update(PHOTO).digest('hex');

// A shallow, wide panel puts a jack near the vertical middle a pixel or two
// from both edges; the approach side must follow the cable, not that margin.
const PANEL = { pos: [40, 200], size: [640, 120] };
const TOP_EDGE = PANEL.pos[1];
const BOTTOM_EDGE = PANEL.pos[1] + PANEL.size[1];

function render(mutate) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-faceplate-mid-'));
  fs.mkdirSync(path.join(dir, 'faces'));
  fs.writeFileSync(path.join(dir, 'faces', 'panel.png'), PHOTO);
  const doc = {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Faceplate mid-jack side', output: 'mid.html' },
    components: [
      {
        id: 'tx', type: 'backend', label: 'SW-620-TX-W', pos: PANEL.pos, size: PANEL.size,
        faceplate: {
          image: { path: 'faces/panel.png', sha256 }, width: 640, height: 120,
          ports: [{ id: 'usb-host', label: 'USB HOST', x: 0.5, y: 0.5 }],
        },
      },
      { id: 'notebook', type: 'external', label: 'Notebook', pos: [300, 40], size: [120, 80] },
    ],
    connections: [{ id: 'pc-to-panel', from: 'notebook', to: 'tx', toPort: 'usb-host' }],
  };
  mutate(doc);
  const input = path.join(dir, 'diagram.json');
  const output = path.join(dir, 'out.html');
  fs.writeFileSync(input, JSON.stringify(doc));
  execFileSync(process.execPath, [renderer, input, output], { stdio: ['ignore', 'ignore', 'pipe'] });
  const html = fs.readFileSync(output, 'utf8');
  fs.rmSync(dir, { recursive: true, force: true });
  return html;
}

function exitY(html) {
  const match = html.match(/data-edge-id="pc-to-panel"[^>]*data-composition-points="([^"]+)"/);
  assert.ok(match, 'the connection is rendered');
  const points = match[1].split(';');
  return Number(points[points.length - 1].split(',')[1]);
}

test('a jack at the vertical middle follows a cable that comes from above', () => {
  const html = render((doc) => { doc.components[1].pos = [300, 40]; });
  assert.equal(exitY(html), TOP_EDGE);
});

test('the same jack follows a cable that comes from below', () => {
  const html = render((doc) => { doc.components[1].pos = [300, 400]; });
  assert.equal(exitY(html), BOTTOM_EDGE);
});

test('an authored side still wins over the cable direction', () => {
  const html = render((doc) => {
    doc.components[1].pos = [300, 400];
    doc.components[0].faceplate.ports[0].side = 'top';
  });
  assert.equal(exitY(html), TOP_EDGE);
});

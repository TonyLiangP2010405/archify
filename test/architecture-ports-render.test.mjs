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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-ports-render-'));
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

const withPorts = (ports, width = 240) => ({
  schema_version: 1,
  diagram_type: 'architecture',
  meta: { title: 'Ports render', output: 'ports-render.html' },
  components: [
    { id: 'matrix', type: 'backend', label: 'AV Matrix', pos: [200, 200], size: [width, 170], ports },
    { id: 'tv', type: 'external', label: 'Display', pos: [560, 250], size: [120, 60] },
  ],
  connections: [{ id: 'feed', from: 'matrix', to: 'tv', fromPort: 'out-1', toSide: 'left' }],
});

const PORTS = [
  { id: 'in-1', label: 'HDMI IN 1', side: 'left' },
  { id: 'in-2', label: 'HDMI IN 2', side: 'left' },
  { id: 'out-1', label: 'HDMI OUT 1', side: 'right' },
];

test('every declared port draws one jack and one fine label', () => {
  const html = render(withPorts(PORTS));
  assert.equal((html.match(/<g data-ports="">/g) || []).length, 1);
  assert.equal((html.match(/class="c-port-jack"/g) || []).length, 3);
  for (const port of PORTS) {
    assert.match(html, new RegExp(`<text data-detail="fine"[^>]*>${port.label}</text>`));
  }
});

test('an unconnected port still draws', () => {
  const html = render(withPorts(PORTS));
  assert.match(html, />HDMI IN 2</);
});

test('the artifact keeps a single svg', () => {
  assert.equal((render(withPorts(PORTS)).match(/<svg\b/g) || []).length, 1);
});

test('an empty ports array renders the same bytes as no ports field', () => {
  const doc = (ports) => ({ ...withPorts(ports), connections: [] });
  assert.equal(render(doc([])), render(doc(undefined)));
});

test('the port jack style only ships with a ported artifact', () => {
  const plain = { ...withPorts(undefined), connections: [] };
  assert.doesNotMatch(render(plain), /c-port-jack/);
  assert.match(render(withPorts(PORTS)), /\.c-port-jack/);
});

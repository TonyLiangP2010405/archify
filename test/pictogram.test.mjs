import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'archify');
const renderer = path.join(skillRoot, 'renderers/architecture/render-architecture.mjs');
const cli = path.join(skillRoot, 'bin/archify.mjs');
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000002000000010806000000'
  + '0000000000000000', 'hex');
const sha256 = createHash('sha256').update(PNG).digest('hex');

const doc = (overrides = {}) => ({
  schema_version: 1,
  diagram_type: 'architecture',
  meta: { title: 'Pictogram', output: 'pictogram.html' },
  components: [
    { id: 'laptop', type: 'external', label: 'Laptop', pos: [40, 40], size: [120, 80], pictogram: 'laptop' },
    { id: 'display', type: 'external', label: 'Display', pos: [300, 300], size: [120, 80], pictogram: 'display' },
  ],
  connections: [{ id: 'link', from: 'laptop', to: 'display' }],
  ...overrides,
});

function workspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-pictogram-'));
  fs.mkdirSync(path.join(dir, 'faces'));
  fs.writeFileSync(path.join(dir, 'faces', 'panel.png'), PNG);
  return dir;
}

function render(diagram) {
  const dir = workspace();
  fs.writeFileSync(path.join(dir, 'diagram.json'), JSON.stringify(diagram));
  const result = spawnSync(process.execPath, [renderer, 'diagram.json', 'out.html'], { cwd: dir, encoding: 'utf8' });
  const html = result.status === 0 ? fs.readFileSync(path.join(dir, 'out.html'), 'utf8') : null;
  fs.rmSync(dir, { recursive: true, force: true });
  return { result, html };
}

function validate(diagram) {
  const dir = workspace();
  fs.writeFileSync(path.join(dir, 'diagram.json'), JSON.stringify(diagram));
  const result = spawnSync(process.execPath, [cli, 'validate', 'architecture', 'diagram.json', '--json'],
    { cwd: dir, encoding: 'utf8' });
  fs.rmSync(dir, { recursive: true, force: true });
  return JSON.parse(result.stdout);
}

function nodeSpan(html, id, until) {
  const start = html.indexOf(`data-node-id="${id}"`);
  assert.ok(start >= 0, `missing node ${id}`);
  const end = html.indexOf(until, start);
  assert.ok(end > start, `missing ${until} in node ${id}`);
  return html.slice(start, end + until.length);
}

test('a pictogram replaces the card body and moves the label below the box', () => {
  const { result, html } = render(doc());
  assert.equal(result.status, 0, result.stderr?.slice(0, 300));
  assert.match(html, /data-pictogram-node="laptop"/);
  const body = nodeSpan(html, 'laptop', 'data-pictogram-node="laptop"');
  assert.doesNotMatch(body, /class="c-external"/, 'a pictogram node must not paint a card');
  assert.doesNotMatch(body, /class="c-mask"/, 'a pictogram node must not paint a background box');
  const label = html.match(/data-node-id="laptop"[\s\S]*?<text data-node-label=""[^>]*y="([\d.]+)"/);
  assert.equal(label?.[1], '130', 'the label sits 10px under the box');
});

test('the art is fitted into the box without distortion', () => {
  const diagram = doc();
  diagram.components[0].size = [200, 80];
  const { html } = render(diagram);
  // 120x80 art in a 200x80 box: scale 1, centred with 40px of side margin.
  assert.match(html, /data-pictogram="laptop"[^>]*translate\(80\.00 40\.00\) scale\(1\.0000\)/);
});

test('connections still land on the box that owns the art', () => {
  const { html } = render(doc());
  const match = html.match(/data-edge-id="link"[^>]+data-composition-points="([^"]+)"/);
  assert.ok(match, 'missing route');
  const [x, y] = match[1].split(';')[0].split(',').map(Number);
  const onBox = (x === 160 || x === 300) || (y === 40 || y === 120);
  assert.ok(onBox, `route started inside the box at ${x},${y}`);
});

test('every pictogram name renders', () => {
  const names = ['laptop', 'display', 'projector', 'camera', 'ptz-camera', 'document-camera',
    'microphone', 'speaker', 'pc', 'server', 'network-switch', 'cloud', 'touch-panel',
    'tablet', 'phone', 'rack', 'sensor'];
  const diagram = doc({
    components: names.map((name, index) => ({
      id: `n-${index}`, type: 'external', label: name,
      pos: [40 + (index % 6) * 200, 40 + Math.floor(index / 6) * 140], size: [120, 80], pictogram: name,
    })),
    connections: [],
  });
  const { result, html } = render(diagram);
  assert.equal(result.status, 0, result.stderr?.slice(0, 300));
  for (const name of names) assert.match(html, new RegExp(`data-pictogram="${name}"`));
});

test('an unknown pictogram is a schema error that names the field', () => {
  const diagram = doc();
  diagram.components[0].pictogram = 'hoverboard';
  const receipt = validate(diagram);
  assert.equal(receipt.ok, false);
  assert.ok((receipt.diagnostics || []).some((entry) => entry.subject?.path?.endsWith('/pictogram')),
    JSON.stringify(receipt.diagnostics?.slice(0, 2)));
});

test('a pictogram rejects the fields it cannot draw', () => {
  const diagram = doc();
  diagram.components[0].tag = 'BYOD';
  diagram.components[0].ports = [{ id: 'hdmi', label: 'HDMI', side: 'left' }];
  const receipt = validate(diagram);
  assert.equal(receipt.ok, false);
  const conflict = (receipt.diagnostics || []).find((entry) => entry.code === 'architecture/pictogram-layout-conflict');
  assert.ok(conflict, JSON.stringify(receipt.diagnostics));
  assert.deepEqual(conflict.evidence.forbidden.sort(), ['ports', 'tag']);
});

test('a node cannot be a pictogram and a faceplate at once', () => {
  const diagram = doc();
  diagram.components[0].faceplate = {
    image: { path: 'faces/panel.png', sha256 }, width: 2, height: 1,
    ports: [{ id: 'in', label: 'IN', x: 0.5, y: 0.5 }],
  };
  diagram.components[0].size = [120, 60];
  const receipt = validate(diagram);
  assert.equal(receipt.ok, false);
  assert.ok((receipt.diagnostics || []).some((entry) => entry.code === 'architecture/pictogram-faceplate-conflict'));
});

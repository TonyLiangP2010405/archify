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

const html = (() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-faceplate-render-'));
  fs.mkdirSync(path.join(dir, 'faces'));
  fs.writeFileSync(path.join(dir, 'faces', 'panel.png'), PNG);
  const doc = {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Faceplate render', output: 'render.html' },
    components: [{
      id: 'tx', type: 'backend', label: 'SW-660-TX-W', pos: [40, 40], size: [420, 210],
      faceplate: {
        image: { path: 'faces/panel.png', sha256 }, width: 2, height: 1,
        ports: [
          { id: 'in-1', label: 'HDMI IN 1', x: 0.25, y: 0.5 },
          { id: 'in-2', label: 'HDMI IN 2', x: 0.75, y: 0.5 },
        ],
      },
    }],
    connections: [],
  };
  const input = path.join(dir, 'diagram.json');
  const output = path.join(dir, 'out.html');
  fs.writeFileSync(input, JSON.stringify(doc));
  execFileSync(process.execPath, [renderer, input, output], { stdio: ['ignore', 'ignore', 'pipe'] });
  const text = fs.readFileSync(output, 'utf8');
  fs.rmSync(dir, { recursive: true, force: true });
  return text;
})();

test('the panel image is embedded at the node box', () => {
  assert.match(html, /<image [^>]*x="40"[^>]*y="40"[^>]*width="420"[^>]*height="210"/);
});

test('each hole draws a dot with its name as a title', () => {
  assert.equal((html.match(/data-faceplate-port=""/g) || []).length, 2);
  assert.match(html, /<title>HDMI IN 1<\/title>/);
  assert.match(html, /<title>HDMI IN 2<\/title>/);
});

test('the caption sits below the node, outside the box', () => {
  assert.match(html, /<text data-node-label=""[^>]*y="260"/);
});

test('one svg in the artifact', () => {
  assert.equal((html.match(/<svg\b/g) || []).length, 1);
});

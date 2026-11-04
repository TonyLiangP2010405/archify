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
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000002000000010806000000'
  + '0000000000000000', 'hex');
const sha256 = createHash('sha256').update(PNG).digest('hex');

function validate(mutate) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-faceplate-val-'));
  fs.mkdirSync(path.join(dir, 'faces'));
  fs.writeFileSync(path.join(dir, 'faces', 'panel.png'), PNG);
  const doc = {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Faceplate diagnostics', output: 'diag.html' },
    components: [{
      id: 'tx', type: 'backend', label: 'TX', pos: [40, 40], size: [420, 210],
      faceplate: {
        image: { path: 'faces/panel.png', sha256 }, width: 2, height: 1,
        ports: [{ id: 'in-1', label: 'IN 1', x: 0.5, y: 0.5 }],
      },
    }],
    connections: [],
  };
  mutate(doc);
  const input = path.join(dir, 'diagram.json');
  fs.writeFileSync(input, JSON.stringify(doc));
  const result = spawnSync(process.execPath, [cli, 'validate', 'architecture', input, '--json'], { encoding: 'utf8' });
  const receipt = JSON.parse(result.stdout);
  fs.rmSync(dir, { recursive: true, force: true });
  return { status: result.status, receipt };
}

const codes = (receipt) => (receipt.diagnostics || []).map((entry) => entry.code);

test('a wrong digest is reported before rendering', () => {
  const { status, receipt } = validate((doc) => { doc.components[0].faceplate.image.sha256 = '0'.repeat(64); });
  assert.equal(status, 1);
  assert.deepEqual(codes(receipt), ['architecture/faceplate-image-changed']);
});

test('a declared size that disagrees with the file is reported', () => {
  const { receipt } = validate((doc) => { doc.components[0].faceplate.width = 4; });
  assert.ok(codes(receipt).includes('architecture/faceplate-image-mismatch'));
});

test('an aspect-locked node must match the image ratio', () => {
  const { receipt } = validate((doc) => { doc.components[0].size = [420, 300]; });
  const entry = receipt.diagnostics.find((item) => item.code === 'architecture/faceplate-aspect');
  assert.equal(entry.evidence.requiredHeightPx, 210);
});

test('two holes on one edge point are rejected', () => {
  const { receipt } = validate((doc) => {
    doc.components[0].faceplate.ports = [
      { id: 'a', label: 'A', x: 0.5, y: 0.9 },
      { id: 'b', label: 'B', x: 0.5, y: 0.95 },
    ];
  });
  assert.ok(codes(receipt).includes('architecture/faceplate-port-duplicate'));
});

test('sublabel is rejected on a faceplate node', () => {
  const { receipt } = validate((doc) => { doc.components[0].sublabel = 'rear'; });
  assert.ok(codes(receipt).includes('architecture/faceplate-layout-conflict'));
});

test('an unknown hole on a faceplate is reported', () => {
  const { receipt } = validate((doc) => {
    doc.components.push({ id: 'ghost', type: 'external', label: 'Ghost', pos: [400, 300], size: [120, 60] });
    doc.connections = [{ id: 'c1', from: 'tx', to: 'ghost', fromPort: 'nope' }];
  });
  assert.ok(codes(receipt).includes('architecture/unknown-port'));
});

test('one hole carries one cable', () => {
  const { receipt } = validate((doc) => {
    doc.components.push({ id: 'ghost', type: 'external', label: 'Ghost', pos: [400, 300], size: [120, 60] });
    doc.connections = [
      { id: 'c1', from: 'tx', to: 'ghost', fromPort: 'in-1' },
      { id: 'c2', from: 'tx', to: 'ghost', fromPort: 'in-1' },
    ];
  });
  assert.ok(codes(receipt).includes('architecture/port-duplicate-use'));
});

test('missing image is reported, not crashed', () => {
  const { status, receipt } = validate((doc) => { doc.components[0].faceplate.image.path = 'faces/nope.png'; });
  assert.equal(status, 1);
  assert.deepEqual(codes(receipt), ['architecture/faceplate-missing-image']);
});

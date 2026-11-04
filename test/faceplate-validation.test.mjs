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

const PHOTO = fs.readFileSync(path.join(skillRoot, 'examples/assets/patch-panel.png'));
const photoSha = createHash('sha256').update(PHOTO).digest('hex');

function validatePhoto(mutate) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-faceplate-photo-'));
  fs.mkdirSync(path.join(dir, 'faces'));
  fs.writeFileSync(path.join(dir, 'faces', 'panel.png'), PHOTO);
  const doc = {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Faceplate photo scale', output: 'diag.html', quality_profile: 'showcase' },
    components: [{
      id: 'tx', type: 'backend', label: 'TX', pos: [40, 40], size: [280, 52.5],
      faceplate: {
        image: { path: 'faces/panel.png', sha256: photoSha }, width: 640, height: 120,
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

test('a photographed panel drawn too small to read its silkscreen is rejected', () => {
  const { status, receipt } = validatePhoto((doc) => { doc.components[0].size = [280, 52.5]; });
  assert.equal(status, 1);
  const entry = receipt.diagnostics.find((item) => item.code === 'architecture/faceplate-too-small');
  assert.equal(entry.evidence.sourceWidth, 640);
  assert.equal(entry.evidence.minWidth, 288);
});

test('a photographed panel at a readable scale passes', () => {
  const { status, receipt } = validatePhoto((doc) => { doc.components[0].size = [400, 75]; });
  assert.equal(status, 0);
  assert.ok(!codes(receipt).includes('architecture/faceplate-too-small'));
});

test('a standard-profile draft keeps its narrow panel', () => {
  const { status, receipt } = validatePhoto((doc) => {
    doc.meta.quality_profile = 'standard';
    doc.components[0].size = [280, 52.5];
  });
  assert.equal(status, 0, 'the readable-scale gate belongs to the showcase profile');
  assert.ok(!codes(receipt).includes('architecture/faceplate-too-small'));
});

test('two holes at the same jack position are rejected', () => {
  const { receipt } = validate((doc) => {
    doc.components[0].faceplate.ports = [
      { id: 'a', label: 'A', x: 0.5, y: 0.5 },
      { id: 'b', label: 'B', x: 0.5, y: 0.5 },
    ];
  });
  assert.ok(codes(receipt).includes('architecture/faceplate-port-duplicate'));
});

test('two jacks at one height leave through separate edge points', () => {
  const { status: ok } = validate((doc) => {
    doc.components[0].faceplate.ports = [
      { id: 'a', label: 'A', x: 0.84, y: 0.5 },
      { id: 'b', label: 'B', x: 0.9, y: 0.5 },
    ];
  });
  assert.equal(ok, 0, 'a shared edge projection is nudged, not rejected');
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

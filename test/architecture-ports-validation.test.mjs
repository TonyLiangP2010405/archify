import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'archify');
const cli = path.join(skillRoot, 'bin/archify.mjs');

function validate(doc) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-ports-validation-'));
  const input = path.join(tmp, 'in.json');
  fs.writeFileSync(input, JSON.stringify(doc));
  try {
    const result = spawnSync(process.execPath, [cli, 'validate', 'architecture', input, '--json'], { encoding: 'utf8' });
    return { status: result.status, receipt: JSON.parse(result.stdout) };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

const doc = ({ ports, connections = [], height = 170, width = 240, label = 'AV Matrix' }) => ({
  schema_version: 1,
  diagram_type: 'architecture',
  meta: { title: 'Port diagnostics', output: 'ports-diagnostics.html' },
  components: [
    { id: 'matrix', type: 'backend', label, pos: [200, 200], size: [width, height], ports },
    { id: 'tv', type: 'external', label: 'Display', pos: [600, 250], size: [120, 60] },
  ],
  connections,
});

const codes = (receipt) => receipt.diagnostics.map((entry) => entry.code);

test('an unknown port reference is rejected with the available ports', () => {
  const { status, receipt } = validate(doc({
    ports: [{ id: 'in-1', label: 'HDMI IN 1', side: 'left' }],
    connections: [{ id: 'feed', from: 'matrix', to: 'tv', fromPort: 'in-9' }],
  }));
  assert.equal(status, 1);
  assert.deepEqual(codes(receipt), ['architecture/unknown-port']);
  assert.deepEqual(receipt.diagnostics[0].evidence.availablePorts, ['in-1']);
});

test('two connections cannot share one port', () => {
  const { receipt } = validate(doc({
    ports: [{ id: 'in-1', label: 'HDMI IN 1', side: 'left' }],
    connections: [
      { id: 'a', from: 'tv', to: 'matrix', toPort: 'in-1' },
      { id: 'b', from: 'tv', to: 'matrix', toPort: 'in-1' },
    ],
  }));
  assert.ok(codes(receipt).includes('architecture/port-duplicate-use'));
});

test('duplicate port ids on one component are rejected', () => {
  const { receipt } = validate(doc({ ports: [
    { id: 'in-1', label: 'HDMI IN 1', side: 'left' },
    { id: 'in-1', label: 'HDMI IN 2', side: 'left' },
  ] }));
  assert.deepEqual(codes(receipt), ['architecture/duplicate-port-id']);
});

test('capacity reports the height the card needs', () => {
  const { receipt } = validate(doc({
    height: 80,
    ports: [1, 2, 3, 4].map((n) => ({ id: `in-${n}`, label: `HDMI IN ${n}`, side: 'left' })),
  }));
  const entry = receipt.diagnostics.find((item) => item.code === 'architecture/port-capacity');
  assert.equal(entry.evidence.requiredPx, 86);
  assert.equal(entry.evidence.availablePx, 80);
});

test('a crowded rail reports the width the card needs', () => {
  const { receipt } = validate(doc({
    width: 120,
    ports: [
      { id: 'in-1', label: 'HDMI IN 1', side: 'left' },
      { id: 'out-1', label: 'HDMI OUT 1', side: 'right' },
    ],
  }));
  const entry = receipt.diagnostics.find((item) => item.code === 'architecture/port-rail-crowded');
  assert.equal(entry.evidence.requiredWidthPx, 141);
});

test('a portless connection on an authored ported side is rejected', () => {
  const { receipt } = validate(doc({
    ports: [{ id: 'in-1', label: 'HDMI IN 1', side: 'left' }],
    connections: [{ id: 'feed', from: 'tv', to: 'matrix', toSide: 'left' }],
  }));
  assert.ok(codes(receipt).includes('architecture/port-side-exclusive'));
});

test('an authored side that conflicts with its port is rejected', () => {
  const { receipt } = validate(doc({
    ports: [{ id: 'in-1', label: 'HDMI IN 1', side: 'left' }],
    connections: [{ id: 'feed', from: 'tv', to: 'matrix', toPort: 'in-1', toSide: 'right' }],
  }));
  assert.deepEqual(codes(receipt), ['architecture/port-side-conflict']);
});

test('empty ports behave like no ports', () => {
  const { status } = validate(doc({ ports: [] }));
  assert.equal(status, 0);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareArchitecture } from '../archify/delta/architecture-delta.mjs';

const base = () => ({
  schema_version: 1,
  diagram_type: 'architecture',
  meta: { title: 'Faceplate delta', output: 'delta.html' },
  components: [{
    id: 'tx', type: 'backend', label: 'TX', pos: [0, 0], size: [420, 210],
    faceplate: {
      image: { path: 'faces/a.png', sha256: 'a'.repeat(64) },
      width: 1401,
      height: 237,
      ports: [{ id: 'in-1', label: 'IN 1', x: 0.5, y: 0.5 }],
    },
  }],
  connections: [],
});

test('a moved hole is a semantic change', () => {
  const head = base();
  head.components[0].faceplate.ports[0].x = 0.6;
  const receipt = compareArchitecture(base(), head);
  const change = receipt.changes.components.find((entry) => entry.id === 'tx');
  assert.equal(change.status, 'changed');
  assert.deepEqual(change.classifications, ['semantic']);
});

test('an image swap is a semantic change', () => {
  const head = base();
  head.components[0].faceplate.image.sha256 = 'b'.repeat(64);
  const receipt = compareArchitecture(base(), head);
  const change = receipt.changes.components.find((entry) => entry.id === 'tx');
  assert.ok(change.classifications.includes('semantic'));
});

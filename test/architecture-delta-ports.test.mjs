import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareArchitecture } from '../archify/delta/architecture-delta.mjs';

const base = () => ({
  schema_version: 1,
  diagram_type: 'architecture',
  meta: { title: 'Ports delta', output: 'ports-delta.html' },
  components: [
    { id: 'matrix', type: 'backend', label: 'Matrix', pos: [200, 200], size: [240, 170],
      ports: [
        { id: 'in-1', label: 'HDMI IN 1', side: 'left' },
        { id: 'out-1', label: 'HDMI OUT 1', side: 'right' },
      ] },
    { id: 'tv', type: 'external', label: 'Display', pos: [600, 250], size: [120, 60] },
  ],
  connections: [{ id: 'feed', from: 'matrix', to: 'tv', fromPort: 'out-1' }],
});

test('renaming a port is a semantic component change', () => {
  const head = base();
  head.components[0].ports[0].label = 'HDMI IN A';
  const receipt = compareArchitecture(base(), head);
  const change = receipt.changes.components.find((entry) => entry.id === 'matrix');
  assert.equal(change.status, 'changed');
  assert.deepEqual(change.classifications, ['semantic']);
});

test('moving a cable to another port is a semantic connection change', () => {
  const head = base();
  head.components[0].ports.push({ id: 'out-2', label: 'HDMI OUT 2', side: 'right' });
  head.connections[0].fromPort = 'out-2';
  const receipt = compareArchitecture(base(), head);
  const change = receipt.changes.connections.find((entry) => entry.id === 'feed');
  assert.equal(change.status, 'changed');
  assert.ok(change.classifications.includes('semantic'));
});

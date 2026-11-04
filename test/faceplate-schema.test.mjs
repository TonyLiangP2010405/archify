import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateSchema } from '../archify/renderers/shared/validator.mjs';

const doc = (faceplate) => ({
  schema_version: 1,
  diagram_type: 'architecture',
  meta: { title: 'Faceplate', output: 'faceplate-schema.html' },
  components: [{ id: 'tx', type: 'backend', label: 'TX', pos: [0, 0], size: [420, 210], faceplate }],
  connections: [],
});

const valid = {
  image: { path: 'faces/a.png', sha256: 'a'.repeat(64) },
  width: 1401,
  height: 237,
  ports: [{ id: 'hdmi-in-1', label: 'HDMI IN 1', x: 0.328, y: 0.79 }],
};

test('a faceplate is accepted', () => {
  assert.doesNotThrow(() => validateSchema('architecture', doc(valid)));
});

test('an unpinned image is rejected', () => {
  assert.throws(() => validateSchema('architecture', doc({ ...valid, image: { path: 'faces/a.png' } })),
    (error) => error.archifyDiagnostics[0].code === 'schema/required');
});

test('port coordinates outside 0-1 are rejected', () => {
  assert.throws(() => validateSchema('architecture', doc({
    ...valid,
    ports: [{ id: 'p', label: 'P', x: 1.2, y: 0.5 }],
  })), (error) => error.archifyDiagnostics[0].code === 'schema/maximum');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateSchema } from '../archify/renderers/shared/validator.mjs';

const doc = (component = {}, connection = {}) => ({
  schema_version: 1,
  diagram_type: 'architecture',
  meta: { title: 'Ports', output: 'ports-schema.html' },
  components: [{
    id: 'matrix',
    type: 'backend',
    label: 'Matrix',
    ports: [{ id: 'in-1', label: 'HDMI IN 1', side: 'left' }],
    ...component,
  }],
  connections: [{ from: 'matrix', to: 'matrix', ...connection }],
});

test('named ports and port references are accepted', () => {
  assert.doesNotThrow(() => validateSchema('architecture', doc()));
  assert.doesNotThrow(() => validateSchema('architecture', doc({}, { fromPort: 'in-1' })));
});

test('an unknown port property is rejected', () => {
  assert.throws(() => validateSchema('architecture', doc({ ports: [
    { id: 'in-1', label: 'HDMI IN 1', side: 'left', kind: 'hdmi' },
  ] })), (error) => error.archifyDiagnostics[0].code === 'schema/additionalProperties');
});

test('top and bottom ports are rejected', () => {
  assert.throws(() => validateSchema('architecture', doc({ ports: [
    { id: 'in-1', label: 'HDMI IN 1', side: 'top' },
  ] })), (error) => error.archifyDiagnostics[0].code === 'schema/enum');
});

test('port ids are lowercase kebab', () => {
  assert.throws(() => validateSchema('architecture', doc({ ports: [
    { id: 'HDMI_IN_1', label: 'HDMI IN 1', side: 'left' },
  ] })), (error) => error.archifyDiagnostics[0].code === 'schema/pattern');
});

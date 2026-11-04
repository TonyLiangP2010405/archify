import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { authoredPathFor } from '../archify/renderers/shared/cli.mjs';

test('the snapshot resolves against the authored path', () => {
  const previous = process.env.ARCHIFY_INPUT_PATH;
  process.env.ARCHIFY_INPUT_PATH = '/work/diagrams/site.json';
  try {
    assert.equal(
      authoredPathFor('/tmp/archify-validate-1/specification.snapshot.json'),
      path.resolve('/work/diagrams/site.json'),
    );
  } finally {
    if (previous === undefined) delete process.env.ARCHIFY_INPUT_PATH;
    else process.env.ARCHIFY_INPUT_PATH = previous;
  }
});

test('without the variable the given path is the authored path', () => {
  const previous = process.env.ARCHIFY_INPUT_PATH;
  delete process.env.ARCHIFY_INPUT_PATH;
  try {
    assert.equal(authoredPathFor('/work/diagrams/site.json'), path.resolve('/work/diagrams/site.json'));
  } finally {
    if (previous !== undefined) process.env.ARCHIFY_INPUT_PATH = previous;
  }
});

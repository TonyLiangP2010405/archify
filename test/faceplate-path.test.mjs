import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { authoredDirFor } from '../archify/renderers/shared/cli.mjs';

test('side files resolve against the authored directory', () => {
  const previous = process.env.ARCHIFY_AUTHORED_DIR;
  process.env.ARCHIFY_AUTHORED_DIR = '/work/diagrams';
  try {
    assert.equal(
      authoredDirFor('/tmp/archify-validate-1/specification.snapshot.json'),
      path.resolve('/work/diagrams'),
    );
  } finally {
    if (previous === undefined) delete process.env.ARCHIFY_AUTHORED_DIR;
    else process.env.ARCHIFY_AUTHORED_DIR = previous;
  }
});

test('without the variable the snapshot directory is used', () => {
  const previous = process.env.ARCHIFY_AUTHORED_DIR;
  delete process.env.ARCHIFY_AUTHORED_DIR;
  try {
    assert.equal(
      authoredDirFor('/work/diagrams/site.json'),
      path.dirname(path.resolve('/work/diagrams/site.json')),
    );
  } finally {
    if (previous !== undefined) process.env.ARCHIFY_AUTHORED_DIR = previous;
  }
});

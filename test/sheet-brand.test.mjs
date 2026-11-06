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

// A one-pixel PNG is enough to prove the logo travels inside the artifact.
const LOGO_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

function workspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-sheet-'));
  fs.writeFileSync(path.join(dir, 'logo.png'), LOGO_PNG);
  const doc = {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Deliverable sheet', output: 'sheet.html' },
    components: [{ id: 'a', type: 'backend', label: 'App', pos: [40, 40], size: [160, 60] }],
  };
  fs.writeFileSync(path.join(dir, 'diagram.json'), JSON.stringify(doc));
  return dir;
}

function render(dir, mutate) {
  const doc = JSON.parse(fs.readFileSync(path.join(dir, 'diagram.json'), 'utf8'));
  mutate(doc);
  fs.writeFileSync(path.join(dir, 'diagram.json'), JSON.stringify(doc));
  const result = spawnSync(process.execPath, [cli, 'render', 'architecture', 'diagram.json', 'sheet.html'], {
    cwd: dir,
    encoding: 'utf8',
  });
  return {
    status: result.status,
    stderr: result.stderr,
    html: result.status === 0 && fs.existsSync(path.join(dir, 'sheet.html'))
      ? fs.readFileSync(path.join(dir, 'sheet.html'), 'utf8')
      : '',
  };
}

test('sheet: the logo is embedded in the artifact and the page is marked for print', () => {
  const dir = workspace();
  const run = render(dir, (doc) => {
    doc.meta.sheet = { brand: 'WyreStorm', logo: { path: 'logo.png' }, footer: 'v1.0' };
  });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.html, /<html[^>]*data-sheet="true"/);
  assert.match(run.html, /class="archify-sheet-logo" src="data:image\/png;base64,/);
  assert.match(run.html, /class="archify-sheet-footer"><span>v1\.0<\/span>/);
  // The wordmark carries the name, so it must not be printed twice.
  assert.doesNotMatch(run.html, /class="archify-sheet-name"/);
});

test('sheet: a diagram without the block keeps the plain artifact', () => {
  const dir = workspace();
  const run = render(dir, () => {});
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.html, /<html lang="[^"]*" data-theme="[^"]*" data-preset="[^"]*">/);
  assert.doesNotMatch(run.html, /class="archify-sheet-logo"/);
  assert.doesNotMatch(run.html, /class="archify-sheet-brand"/);
});

test('sheet: a text-only lockup prints the brand name', () => {
  const dir = workspace();
  const run = render(dir, (doc) => {
    doc.meta.sheet = { brand: 'WyreStorm' };
  });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.html, /class="archify-sheet-name">WyreStorm</);
});

test('sheet: a logo whose bytes do not match the authored sha256 stops the render', () => {
  const dir = workspace();
  const run = render(dir, (doc) => {
    doc.meta.sheet = { logo: { path: 'logo.png', sha256: 'a'.repeat(64) } };
  });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /sha256/);
});

test('sheet: notes, the port table and the legend reach the artifact', () => {
  const dir = workspace();
  const run = render(dir, (doc) => {
    doc.meta.sheet = {
      brand: 'WyreStorm',
      logo: { path: 'logo.png' },
      notes: ['First note', 'Second note'],
      table: { title: 'Ports', columns: ['Port', 'Device'], rows: [['HDMI IN 1', 'Laptop']] },
      design: { title: 'Design', lines: ['Keep it short'] },
      legend: [{ label: 'HDMI', color: '#9333ea' }, { label: 'Optional', color: '#94a3b8', dashed: true }],
    };
  });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.html, /<ol class="archify-sheet-notes">[\s\S]*First note[\s\S]*Second note/);
  assert.match(run.html, /<th>Port<\/th><th>Device<\/th>/);
  assert.match(run.html, /<td>HDMI IN 1<\/td><td>Laptop<\/td>/);
  assert.match(run.html, /archify-sheet-chip archify-sheet-chip-dashed/);
});

test('sheet: a missing logo file stops the render instead of shipping a blank corner', () => {
  const dir = workspace();
  const run = render(dir, (doc) => {
    doc.meta.sheet = { logo: { path: 'absent.png' } };
  });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /absent\.png/);
});

test('sheet: an accepted logo hash lets the render through', () => {
  const dir = workspace();
  const sha256 = createHash('sha256').update(LOGO_PNG).digest('hex');
  const run = render(dir, (doc) => {
    doc.meta.sheet = { logo: { path: 'logo.png', sha256, height: 24 } };
  });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.html, /class="archify-sheet-logo"[^>]*style="height:24px"/);
});

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

function workspace(faces = true) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-faceplate-fix-'));
  if (faces) {
    fs.mkdirSync(path.join(dir, 'faces'));
    fs.writeFileSync(path.join(dir, 'faces', 'panel.png'), PNG);
  }
  return dir;
}

function doc(overrides = {}) {
  return {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Faceplate fix', output: 'fix.html', quality_profile: 'showcase' },
    components: [{
      id: 'tx', type: 'backend', label: 'SW-660-TX-W', pos: [40, 40], size: [420, 210],
      faceplate: {
        image: { path: 'faces/panel.png', sha256 }, width: 2, height: 1,
        ports: [{ id: 'in-1', label: 'IN 1', x: 0.5, y: 0.9 }],
      },
    }],
    connections: [],
    ...overrides,
  };
}

function run(args, cwd, env = {}) {
  return spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', env: { ...process.env, ...env } });
}

test('the frozen snapshot is the document that renders, not the env file', () => {
  const dir = workspace();
  const good = doc();
  const bad = doc();
  bad.components[0].faceplate.image.sha256 = '0'.repeat(64);
  fs.writeFileSync(path.join(dir, 'good.json'), JSON.stringify(good));
  fs.writeFileSync(path.join(dir, 'bad.json'), JSON.stringify(bad));
  const result = run(['validate', 'architecture', 'bad.json', '--json'], dir,
    { ARCHIFY_AUTHORED_DIR: dir, ARCHIFY_INPUT_PATH: path.join(dir, 'good.json') });
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.ok, false, 'the named document must be the one rendered');
  assert.ok((receipt.diagnostics || []).some((entry) => entry.code === 'architecture/faceplate-image-changed'));
});

test('compare resolves relative faceplate images on both sides', () => {
  const dir = workspace();
  fs.writeFileSync(path.join(dir, 'base.json'), JSON.stringify(doc()));
  fs.writeFileSync(path.join(dir, 'head.json'), JSON.stringify(doc()));
  const result = run(['compare', 'architecture', 'base.json', 'head.json', 'delta.html', '--receipt', 'delta.receipt.json', '--json'], dir);
  const receipt = JSON.parse(result.stdout || '{}');
  assert.equal(result.status, 0, receipt.error || result.stderr.slice(0, 400));
});

test('a crowded bottom side never lands a plain cable on a hole exit', () => {
  const dir = workspace();
  const ports = Array.from({ length: 21 }, (_, i) => ({
    id: `p-${i}`, label: `P ${i}`, x: 0.05 + i * 0.045, y: 0.9,
  }));
  const crowded = doc({
    components: [
      { ...doc().components[0], faceplate: { ...doc().components[0].faceplate, ports } },
      { id: 'rx', type: 'external', label: 'RX', pos: [600, 320], size: [120, 60] },
    ],
    connections: [{ id: 'plain', from: 'rx', to: 'tx', toSide: 'bottom' }],
  });
  fs.writeFileSync(path.join(dir, 'crowded.json'), JSON.stringify(crowded));
  const render = spawnSync(process.execPath, [path.join(skillRoot, 'renderers/architecture/render-architecture.mjs'),
    path.join(dir, 'crowded.json'), path.join(dir, 'crowded.html')], { encoding: 'utf8' });
  assert.equal(render.status, 0, render.stderr.slice(0, 300));
  const html = fs.readFileSync(path.join(dir, 'crowded.html'), 'utf8');
  const match = html.match(/data-edge-id="plain"[^>]+data-composition-points="([^"]+)"/);
  const end = match[1].split(';').at(-1).split(',').map(Number);
  const exits = ports.map((port) => 40 + port.x * 420);
  assert.ok(exits.every((x) => Math.abs(x - end[0]) >= 14), `landed at ${end[0]} among ${exits.join(',')}`);
});

test('twelve holes on one side get twelve distinct exit points', () => {
  const dir = workspace();
  const ports = Array.from({ length: 12 }, (_, i) => ({
    id: `p-${i}`, label: `P ${i}`, x: 0.9, y: 0.05 + i * 0.08, side: 'right',
  }));
  const many = doc({
    components: [{ ...doc().components[0], faceplate: { ...doc().components[0].faceplate, ports } }],
    connections: [],
  });
  fs.writeFileSync(path.join(dir, 'many.json'), JSON.stringify(many));
  const render = spawnSync(process.execPath, [path.join(skillRoot, 'renderers/architecture/render-architecture.mjs'),
    path.join(dir, 'many.json'), path.join(dir, 'many.html')], { encoding: 'utf8' });
  assert.equal(render.status, 0, render.stderr.slice(0, 300));
  const html = fs.readFileSync(path.join(dir, 'many.html'), 'utf8');
  const ys = [...html.matchAll(/data-faceplate-exit="[^"]*?,([^"]+)"/g)].map((m) => Number(m[1]));
  assert.equal(ys.length, 12);
  assert.equal(new Set(ys).size, 12, `duplicate exits: ${ys.join(',')}`);
});

test('a cable ends on the hole, not on the panel border', () => {
  const dir = workspace();
  const wired = doc({
    components: [
      ...doc().components,
      { id: 'rx', type: 'external', label: 'RX', pos: [400, 340], size: [120, 60] },
    ],
    connections: [{ id: 'into-hole', from: 'rx', to: 'tx', toPort: 'in-1' }],
  });
  fs.writeFileSync(path.join(dir, 'wired.json'), JSON.stringify(wired));
  const render = spawnSync(process.execPath, [path.join(skillRoot, 'renderers/architecture/render-architecture.mjs'),
    path.join(dir, 'wired.json'), path.join(dir, 'wired.html')], { encoding: 'utf8' });
  assert.equal(render.status, 0, render.stderr.slice(0, 300));
  const html = fs.readFileSync(path.join(dir, 'wired.html'), 'utf8');

  // The route still stops on the panel edge; the stub carries it into the jack.
  const stub = html.match(/<line data-port-stub="into-hole"[^>]*>/);
  assert.ok(stub, 'missing the stub that reaches the hole');
  assert.match(stub[0], /x1="250" y1="250"/);
  assert.match(stub[0], /x2="250" y2="229"/);
  assert.match(stub[0], /marker-end="url\(#arrowhead\)"/);

  const route = html.match(/data-edge-id="into-hole"[^>]*>/);
  assert.ok(route, 'missing the route');
  assert.doesNotMatch(route[0], /marker-end/, 'the border must not draw a second arrowhead');
});

test('a cable leaving a hole keeps its arrowhead on the far end', () => {
  const dir = workspace();
  const wired = doc({
    components: [
      ...doc().components,
      { id: 'rx', type: 'external', label: 'RX', pos: [400, 340], size: [120, 60] },
    ],
    connections: [{ id: 'out-of-hole', from: 'tx', to: 'rx', fromPort: 'in-1' }],
  });
  fs.writeFileSync(path.join(dir, 'out.json'), JSON.stringify(wired));
  const render = spawnSync(process.execPath, [path.join(skillRoot, 'renderers/architecture/render-architecture.mjs'),
    path.join(dir, 'out.json'), path.join(dir, 'out.html')], { encoding: 'utf8' });
  assert.equal(render.status, 0, render.stderr.slice(0, 300));
  const html = fs.readFileSync(path.join(dir, 'out.html'), 'utf8');
  const stub = html.match(/<line data-port-stub="out-of-hole"[^>]*>/);
  assert.ok(stub, 'missing the stub that leaves the hole');
  assert.doesNotMatch(stub[0], /marker-end/);
  assert.match(html.match(/data-edge-id="out-of-hole"[^>]*>/)[0], /marker-end="url\(#arrowhead\)"/);
});

test('duplicate hole ids are rejected, not silently merged', () => {
  const dir = workspace();
  const dup = doc({
    components: [{
      ...doc().components[0],
      faceplate: {
        ...doc().components[0].faceplate,
        ports: [
          { id: 'hdmi', label: 'HDMI 1', x: 0.2, y: 0.9 },
          { id: 'hdmi', label: 'HDMI 2', x: 0.8, y: 0.9 },
        ],
      },
    }],
  });
  fs.writeFileSync(path.join(dir, 'dup.json'), JSON.stringify(dup));
  const result = run(['validate', 'architecture', 'dup.json', '--json'], dir);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.ok, false);
  assert.ok((receipt.diagnostics || []).some((entry) => entry.code === 'architecture/faceplate-port-duplicate'));
});

test('a cable behind the caption stays readable and is not an error', () => {
  const dir = workspace();
  const crossing = doc({
    components: [
      doc().components[0],
      { id: 'below', type: 'external', label: 'Below', pos: [40, 300], size: [120, 60] },
    ],
    connections: [{ id: 'down', from: 'tx', to: 'below', fromPort: 'in-1' }],
  });
  fs.writeFileSync(path.join(dir, 'crossing.json'), JSON.stringify(crossing));
  const result = run(['validate', 'architecture', 'crossing.json', '--json'], dir);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.ok, true, JSON.stringify(receipt.diagnostics || []).slice(0, 300));
});

test('an authored viewBox that clips the caption is reported', () => {
  const dir = workspace();
  const clipped = doc({
    meta: { title: 'Clipped', output: 'clipped.html', quality_profile: 'showcase', viewBox: [520, 240] },
  });
  fs.writeFileSync(path.join(dir, 'clipped.json'), JSON.stringify(clipped));
  const result = run(['validate', 'architecture', 'clipped.json', '--json'], dir);
  const receipt = JSON.parse(result.stdout);
  assert.ok((receipt.diagnostics || []).some((entry) => entry.code === 'architecture/faceplate-caption-outside'));
});

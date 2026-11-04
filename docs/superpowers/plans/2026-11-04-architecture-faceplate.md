# Architecture Faceplate Nodes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an Architecture component be a device faceplate — a PNG/JPEG panel with named holes at normalized coordinates, where each cable terminates on a hole through a short lead to the panel edge.

**Architecture:** A new `faceplate` component field carries a digest-pinned image plus ports with 0–1 coordinates. The renderer embeds the image, draws the holes and their leads, and hands the router the edge points the leads end on — the router keeps its existing "endpoint on the border, perpendicular" contract. Validation owns image identity, aspect, bounds and duplicate endpoints; the device library itself stays private and outside the repository.

**Tech Stack:** Node.js ESM (>= 18), no runtime dependencies, `node:test`, headless Chrome only for the existing `finalize` gate.

**Spec:** `docs/superpowers/specs/2026-11-04-architecture-faceplate-design.md`

## Global Constraints

- Only `architecture` changes; other renderers, the Viewer and the shared card stylesheet keep their bytes.
- Documents without `faceplate` render byte-identically.
- PNG and JPEG only; SVG is rejected (no reliable intrinsic size).
- `faceplate.image` is `{ path, sha256 }`; the hash is verified before rendering.
- Relative `image.path` resolves against `ARCHIFY_INPUT_PATH`, falling back to `process.cwd()`.
- A faceplate node draws its model name **outside, below** the node; the node box is the image.
- Faceplate nodes reject `ports`, `sublabel`, `tag`, `icon`, `brand`, and `layout.mode: grid`.
- Faceplate holes answer `unknown-port` and one-cable-per-hole, but never `port-side-exclusive`.
- All faceplate diagnostics are hard errors in `standard` and `showcase`.
- Working copy: `D:/wyrestorm/.work/archify-fork`, branch `feat/architecture-ports`.

## Review Focus

- **Same-size image swap:** replacing a PNG with another of identical dimensions must fail on the digest, not silently change the artifact.
- **Relative path under snapshotting:** `validate` and `deliver` render a copy of the JSON; a relative `faces/x.png` must still resolve.
- **Edge derivation at 16:1:** on a wide strip, a port at `y = 0.2` must leave through the nearest edge in **pixels**, not normalized distance.
- **Faceplate plus ordinary cables:** a plain connection into a faceplate node must still route, and must not land on a hole.
- **Caption placement:** the model name outside the node must not be counted as the node box by the checker, and must survive export.

---

### Task 1: Faceplate image metadata

**Files:**
- Create: `archify/renderers/shared/faceplate-meta.mjs`
- Test: `test/faceplate-meta.test.mjs`

**Interfaces:**
- Produces:
  - `sniffImage(buffer) -> { mime: 'image/png'|'image/jpeg', width: number, height: number } | null`
  - `imageDigest(buffer) -> string` (lowercase hex SHA-256)
  - `imageDataUrl(buffer, mime) -> string`
  - `readFaceplateImage(absPath) -> { buffer, dataUrl, sha256, mime, width, height }` (throws `ENOENT` upward)

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { imageDataUrl, imageDigest, sniffImage } from '../archify/renderers/shared/faceplate-meta.mjs';

// 2x1 PNG, generated once and kept as hex so the test has no binary fixture.
const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d4948445200000002000000010806000000' +
  '0000000000000000', 'hex');

test('PNG dimensions come from the IHDR chunk', () => {
  assert.deepEqual(sniffImage(PNG), { mime: 'image/png', width: 2, height: 1 });
});

test('JPEG dimensions come from the first SOF marker', () => {
  const jpeg = Buffer.from([
    0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x20, 0x00, 0x40,
    0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01, 0xff, 0xd9,
  ]);
  assert.deepEqual(sniffImage(jpeg), { mime: 'image/jpeg', width: 64, height: 32 });
});

test('anything else is rejected', () => {
  assert.equal(sniffImage(Buffer.from('<svg/>')), null);
  assert.equal(sniffImage(Buffer.alloc(0)), null);
});

test('digest and data URL match the bytes', () => {
  assert.equal(imageDigest(PNG).length, 64);
  assert.match(imageDataUrl(PNG, 'image/png'), /^data:image\/png;base64,iVBOR/);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test test/faceplate-meta.test.mjs`
Expected: FAIL — `Cannot find module .../faceplate-meta.mjs`.

- [ ] **Step 3: Implement the module**

PNG: signature at 0–7, `IHDR` at 12–15, width at 16 (uint32 BE), height at 20. JPEG: scan segments from offset 2 for markers `C0–C3`, `C5–C7`, `C9–CB`, `CD–CF`, read height at +5 and width at +7. `readFaceplateImage` reads the file and returns the four values plus the data URL; a missing file throws an `ENOENT` error the caller turns into a diagnostic.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/faceplate-meta.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add archify/renderers/shared/faceplate-meta.mjs test/faceplate-meta.test.mjs
git commit -m "feat(architecture): read faceplate image metadata without dependencies"
```

---

### Task 2: Schema field

**Files:**
- Modify: `archify/schemas/architecture.schema.json` (component `properties`, after `ports`)
- Modify: `archify/renderers/shared/generated-validators.mjs` (generated)
- Test: `test/faceplate-schema.test.mjs`

**Interfaces:**
- Produces: schema acceptance of `components[].faceplate` = `{ image: { path, sha256 }, width, height, ports: [{ id, label, x, y, side? }] }`.

- [ ] **Step 1: Write the failing test**

```js
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
  width: 1401, height: 237,
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
  assert.throws(() => validateSchema('architecture', doc({ ...valid, ports: [
    { id: 'p', label: 'P', x: 1.2, y: 0.5 },
  ] })), (error) => error.archifyDiagnostics[0].code === 'schema/maximum');
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test test/faceplate-schema.test.mjs`
Expected: FAIL — `faceplate` is an unsupported property.

- [ ] **Step 3: Add the schema and regenerate**

Component `properties` gains:

```json
"faceplate": {
  "type": "object",
  "additionalProperties": false,
  "required": ["image", "width", "height", "ports"],
  "properties": {
    "image": {
      "type": "object",
      "additionalProperties": false,
      "required": ["path", "sha256"],
      "properties": {
        "path": { "type": "string", "minLength": 1, "maxLength": 1024 },
        "sha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" }
      }
    },
    "width": { "type": "number", "exclusiveMinimum": 0 },
    "height": { "type": "number", "exclusiveMinimum": 0 },
    "ports": {
      "type": "array",
      "minItems": 1,
      "maxItems": 64,
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["id", "label", "x", "y"],
        "properties": {
          "id": { "type": "string", "pattern": "^[a-z][a-z0-9-]{0,31}$" },
          "label": { "type": "string", "minLength": 1, "maxLength": 40 },
          "x": { "type": "number", "minimum": 0, "maximum": 1 },
          "y": { "type": "number", "minimum": 0, "maximum": 1 },
          "side": { "$ref": "common.schema.json#/$defs/side" }
        }
      }
    }
  }
}
```

Run: `node archify/scripts/generate-validators.mjs`

- [ ] **Step 4: Run the test and the freshness check**

Run: `node --test test/faceplate-schema.test.mjs && node archify/scripts/generate-validators.mjs --check`
Expected: PASS; freshness exits 0.

- [ ] **Step 5: Commit**

```bash
git add archify/schemas/architecture.schema.json archify/renderers/shared/generated-validators.mjs test/faceplate-schema.test.mjs
git commit -m "feat(architecture): accept faceplate components in the schema"
```

---

### Task 3: Resolve relative image paths through snapshotting

**Files:**
- Modify: `archify/renderers/shared/cli.mjs` (`loadDiagram`, ~line 52)
- Modify: `archify/bin/archify.mjs` (`rendererEnv`, line 2428; call sites 3629, 4284, 4873, 6638, 7030, 7079)
- Modify: `archify/bin/preview.mjs` (its `deliver` invocation must keep an outer `ARCHIFY_INPUT_PATH`)
- Test: `test/faceplate-path.test.mjs`

**Interfaces:**
- Produces: `authoredPathFor(inputPath) -> string` in `cli.mjs` (uses `ARCHIFY_INPUT_PATH` when set); `rendererEnv(quality, repoRoot, diagnosticJson, inputPath)` adds `ARCHIFY_INPUT_PATH` unless an outer process already set it; `loadDiagram` exposes `authoredDir`.

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authoredPathFor } from '../archify/renderers/shared/cli.mjs';

test('the snapshot resolves against the authored path', () => {
  const previous = process.env.ARCHIFY_INPUT_PATH;
  process.env.ARCHIFY_INPUT_PATH = '/work/diagrams/site.json';
  try {
    assert.equal(authoredPathFor('/tmp/archify-validate-1/specification.snapshot.json'),
      '/work/diagrams/site.json');
  } finally {
    if (previous === undefined) delete process.env.ARCHIFY_INPUT_PATH;
    else process.env.ARCHIFY_INPUT_PATH = previous;
  }
});

test('without the variable the given path is the authored path', () => {
  const previous = process.env.ARCHIFY_INPUT_PATH;
  delete process.env.ARCHIFY_INPUT_PATH;
  try {
    assert.equal(authoredPathFor('/work/diagrams/site.json'), '/work/diagrams/site.json');
  } finally {
    if (previous !== undefined) process.env.ARCHIFY_INPUT_PATH = previous;
  }
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test test/faceplate-path.test.mjs`
Expected: FAIL — `authoredPathFor` is not exported.

- [ ] **Step 3: Implement the helper and the env plumbing**

`authoredPathFor` returns `process.env.ARCHIFY_INPUT_PATH ? path.resolve(...) : path.resolve(inputPath)`. `loadDiagram` uses it and returns `authoredDir`. `rendererEnv` gains the fourth argument and never overwrites an existing env value.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/faceplate-path.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add archify/renderers/shared/cli.mjs archify/bin/archify.mjs archify/bin/preview.mjs test/faceplate-path.test.mjs
git commit -m "feat(cli): pass the authored input path to renderers"
```

---

### Task 4: Faceplate model, edge derivation and routing

**Files:**
- Modify: `archify/renderers/architecture/render-architecture.mjs` (after `components`, ~line 98; `fixedPorts` build; router options)
- Modify: `archify/renderers/architecture/routing.mjs` (`fixedEndpoint`, ported-side helpers, `automaticEndpoint` occupancy)
- Test: `test/faceplate-geometry.test.mjs`

**Interfaces:**
- Consumes: `readFaceplateImage` (Task 1), `authoredDir` (Task 3).
- Produces: `faceplateEndpoints(component) -> { image, caption, ports: Map<id, { side, point, jack }> }`; the router receives those as `fixedPorts`, and its occupied list includes jack positions.

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'archify');
const renderer = path.join(skillRoot, 'renderers/architecture/render-architecture.mjs');
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000002000000010806000000' + '0000000000000000', 'hex');

function render(doc, digest) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-faceplate-geom-'));
  fs.mkdirSync(path.join(dir, 'faces'));
  fs.writeFileSync(path.join(dir, 'faces', 'panel.png'), PNG);
  const input = path.join(dir, 'diagram.json');
  const output = path.join(dir, 'out.html');
  fs.writeFileSync(input, JSON.stringify(doc(digest)));
  try {
    execFileSync(process.execPath, [renderer, input, output], { stdio: ['ignore', 'ignore', 'pipe'] });
    return fs.readFileSync(output, 'utf8');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const sha256 = (await import('node:crypto')).createHash('sha256').update(PNG).digest('hex');

const doc = (digest) => ({
  schema_version: 1,
  diagram_type: 'architecture',
  meta: { title: 'Faceplate geometry', output: 'geom.html' },
  components: [
    { id: 'tx', type: 'backend', label: 'TX', pos: [40, 40], size: [420, 210],
      faceplate: { image: { path: 'faces/panel.png', sha256: digest }, width: 2, height: 1,
        ports: [
          { id: 'bottom', label: 'BOTTOM', x: 0.5, y: 0.9 },
          { id: 'top', label: 'TOP', x: 0.5, y: 0.1 },
          { id: 'left', label: 'LEFT', x: 0.02, y: 0.5 },
          { id: 'weighted', label: 'WEIGHTED', x: 0.3, y: 0.4 },
        ] } },
    { id: 'rx', type: 'external', label: 'RX', pos: [400, 220], size: [120, 60] },
  ],
  connections: [
    { id: 'c-bottom', from: 'tx', to: 'rx', fromPort: 'bottom' },
    { id: 'c-top', from: 'tx', to: 'rx', fromPort: 'top' },
    { id: 'c-left', from: 'tx', to: 'rx', fromPort: 'left' },
    { id: 'c-weighted', from: 'tx', to: 'rx', fromPort: 'weighted' },
  ],
});

function points(html, id) {
  const match = html.match(new RegExp(`data-edge-id="${id}"[^>]+data-composition-points="([^"]+)"`));
  assert.ok(match, `missing ${id}`);
  return match[1].split(';').map((pair) => pair.split(',').map(Number));
}

test('the nearest edge wins in pixels, not normalized distance', () => {
  const html = render(doc, sha256);
  assert.deepEqual(points(html, 'c-bottom')[0], [250, 250]);   // bottom edge y = 40 + 210
  assert.deepEqual(points(html, 'c-top')[0], [250, 40]);       // top edge
  assert.deepEqual(points(html, 'c-left')[0], [40, 145]);      // left edge
  // x*W = 126 > y*H = 84, so pixels choose the top edge where normalized
  // distance (0.3 < 0.4) would have chosen the left one.
  assert.deepEqual(points(html, 'c-weighted')[0], [166, 40]);
});

test('an ordinary cable into a faceplate avoids every hole', () => {
  const plain = doc(sha256);
  plain.connections = [{ id: 'plain', from: 'rx', to: 'tx' }];
  const html = render(() => plain, sha256);
  const end = points(html, 'plain').at(-1);
  const holes = [[250, 250], [250, 40], [40, 145], [166, 40]];
  assert.ok(!holes.some(([x, y]) => Math.abs(x - end[0]) < 1 && Math.abs(y - end[1]) < 1), JSON.stringify(end));
  assert.ok([40, 460].includes(end[0]) || [40, 250].includes(end[1]), 'still on the border');
});

test('the artifact embeds the image as a data URL', () => {
  assert.match(render(doc, sha256), /<image [^>]*href="data:image\/png;base64,/);
});

test('validate resolves the image through a JSON snapshot', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-faceplate-path-'));
  fs.mkdirSync(path.join(dir, 'faces'));
  fs.writeFileSync(path.join(dir, 'faces', 'panel.png'), PNG);
  const input = path.join(dir, 'diagram.json');
  fs.writeFileSync(input, JSON.stringify(doc(sha256)));
  try {
    const result = execFileSync(process.execPath, [path.join(skillRoot, 'bin/archify.mjs'),
      'validate', 'architecture', input, '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    assert.equal(JSON.parse(result).ok, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test test/faceplate-geometry.test.mjs`
Expected: FAIL — no faceplate support, and the digest check does not exist yet.

- [ ] **Step 3: Build the model and wire the router**

- Read and verify the image (`sha256`, declared `width`/`height`), throwing `architecture/faceplate-*` diagnostics (Task 6 owns the messages; use a shared `faceplateDiagnostic()` helper here).
- Edge: compare `x·W`, `(1−x)·W`, `y·H`, `(1−y)·H` in **pixels**; smallest wins; explicit `side` overrides.
- Endpoint: `{ side, point: [x·W + left, edge] }` in absolute coordinates, where `left`/`top` come from the component box.
- Add these to the same `fixedPorts` map the named ports use; make `automaticEndpoint` treat each jack position as occupied so a plain connection never lands on a hole.
- `portedSidesOf` must **not** include faceplate sides, so named-port exclusivity does not fire.

- [ ] **Step 4: Run the tests**

Run: `node --test test/faceplate-geometry.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add archify/renderers/architecture/render-architecture.mjs archify/renderers/architecture/routing.mjs test/faceplate-geometry.test.mjs
git commit -m "feat(architecture): route cables to faceplate holes"
```

---

### Task 5: Draw the panel, holes, leads and caption

**Files:**
- Modify: `archify/renderers/architecture/render-architecture.mjs` (`renderComponent`, ~line 1263; `renderSvg`)
- Test: `test/faceplate-render.test.mjs`

**Interfaces:**
- Consumes: `faceplateEndpoints` (Task 4).
- Produces: `<image>` inside the node group, one 4px dot + one lead line per hole, and a `<text data-node-label>` drawn **below** the node.

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'archify');
const renderer = path.join(skillRoot, 'renderers/architecture/render-architecture.mjs');
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000002000000010806000000' + '0000000000000000', 'hex');
const sha256 = (await import('node:crypto')).createHash('sha256').update(PNG).digest('hex');

const html = (() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-faceplate-render-'));
  fs.mkdirSync(path.join(dir, 'faces'));
  fs.writeFileSync(path.join(dir, 'faces', 'panel.png'), PNG);
  const doc = {
    schema_version: 1, diagram_type: 'architecture',
    meta: { title: 'Faceplate render', output: 'render.html' },
    components: [{ id: 'tx', type: 'backend', label: 'SW-660-TX-W', pos: [40, 40], size: [420, 210],
      faceplate: { image: { path: 'faces/panel.png', sha256 }, width: 2, height: 1,
        ports: [{ id: 'in-1', label: 'HDMI IN 1', x: 0.25, y: 0.5 }, { id: 'in-2', label: 'HDMI IN 2', x: 0.75, y: 0.5 }] } }],
    connections: [],
  };
  const input = path.join(dir, 'diagram.json');
  const output = path.join(dir, 'out.html');
  fs.writeFileSync(input, JSON.stringify(doc));
  execFileSync(process.execPath, [renderer, input, output], { stdio: ['ignore', 'ignore', 'pipe'] });
  const text = fs.readFileSync(output, 'utf8');
  fs.rmSync(dir, { recursive: true, force: true });
  return text;
})();

test('the panel image is embedded at the node box', () => {
  assert.match(html, /<image [^>]*x="40"[^>]*y="40"[^>]*width="420"[^>]*height="210"/);
});

test('each hole draws a dot with its name as a title', () => {
  assert.equal((html.match(/data-faceplate-port=""/g) || []).length, 2);
  assert.match(html, /<title>HDMI IN 1<\/title>/);
  assert.match(html, /<title>HDMI IN 2<\/title>/);
});

test('the caption sits below the node, outside the box', () => {
  assert.match(html, /<text data-node-label=""[^>]*y="260"/);
});

test('one svg, and the port jack style stays out of portless artifacts', () => {
  assert.equal((html.match(/<svg\b/g) || []).length, 1);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test test/faceplate-render.test.mjs`
Expected: FAIL — no `<image>`, no dots, caption still centred inside the box.

- [ ] **Step 3: Implement the drawing**

Render order inside the node group: `c-mask` rect (the checker's box), `<image preserveAspectRatio="none">`, stroke-only border rect via inline `style="fill:none"`, hole dots (`data-faceplate-port=""`, `<title>` per hole), lead lines, then the caption `<text data-node-label>` at `y = box.y + box.height + 10`. No port labels are drawn.

- [ ] **Step 4: Run the tests and the checker**

Run: `node --test test/faceplate-render.test.mjs`
Expected: PASS (4 tests). Then `node archify/bin/archify.mjs validate architecture <the same JSON> --json` → `ok: true`.

- [ ] **Step 5: Commit**

```bash
git add archify/renderers/architecture/render-architecture.mjs test/faceplate-render.test.mjs
git commit -m "feat(architecture): draw faceplate panels, holes and leads"
```

---

### Task 6: Faceplate diagnostics

**Files:**
- Modify: `archify/renderers/architecture/render-architecture.mjs` (`validateArchitecture`, ~line 625)
- Test: `test/faceplate-validation.test.mjs`

**Interfaces:**
- Produces: `architecture/faceplate-missing-image`, `-image-changed`, `-image-format`, `-image-mismatch`, `-aspect`, `-port-duplicate`, `-and-ports`, `-layout-conflict`, `-image-heavy` (warning). Port bounds stay schema-owned.

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'archify');
const cli = path.join(skillRoot, 'bin/archify.mjs');
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000002000000010806000000' + '0000000000000000', 'hex');
const sha256 = (await import('node:crypto')).createHash('sha256').update(PNG).digest('hex');

function validate(mutate) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-faceplate-val-'));
  fs.mkdirSync(path.join(dir, 'faces'));
  fs.writeFileSync(path.join(dir, 'faces', 'panel.png'), PNG);
  const doc = {
    schema_version: 1, diagram_type: 'architecture',
    meta: { title: 'Faceplate diagnostics', output: 'diag.html' },
    components: [{ id: 'tx', type: 'backend', label: 'TX', pos: [40, 40], size: [420, 210],
      faceplate: { image: { path: 'faces/panel.png', sha256 }, width: 2, height: 1,
        ports: [{ id: 'in-1', label: 'IN 1', x: 0.5, y: 0.5 }] } }],
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

test('two holes on one edge point are rejected', () => {
  const { receipt } = validate((doc) => { doc.components[0].faceplate.ports = [
    { id: 'a', label: 'A', x: 0.5, y: 0.9 },
    { id: 'b', label: 'B', x: 0.5, y: 0.95 },
  ]; });
  assert.ok(codes(receipt).includes('architecture/faceplate-port-duplicate'));
});

test('sublabel and grid are rejected on a faceplate node', () => {
  const { receipt } = validate((doc) => { doc.components[0].sublabel = 'rear'; });
  assert.ok(codes(receipt).includes('architecture/faceplate-layout-conflict'));
});

test('an unknown hole on a faceplate is reported', () => {
  const { receipt } = validate((doc) => {
    doc.connections = [{ id: 'c1', from: 'tx', to: 'ghost', fromPort: 'nope' }];
    doc.components.push({ id: 'ghost', type: 'external', label: 'Ghost', pos: [400, 300], size: [120, 60] });
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
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test test/faceplate-validation.test.mjs`
Expected: FAIL — the codes do not exist.

- [ ] **Step 3: Implement the checks**

In `validateArchitecture`, before the component loop's existing checks: for each component with `faceplate`, verify `!component.ports`, `!sublabel`, `!tag`, `!icon`, `!brand`, `!grid`; read the image, compare digest, dimensions and mime; compute `requiredHeight = round(width × height/imageWidth)`; detect duplicate edge points (`side + ':' + rounded x|y`). In the connection loop, resolve `fromPort`/`toPort` against `componentPorts(c)` **or** `c.faceplate.ports`, so unknown holes and one-cable-per-hole reuse the existing `architecture/unknown-port` and `architecture/port-duplicate-use` codes.

- [ ] **Step 4: Run the tests**

Run: `node --test test/faceplate-validation.test.mjs`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add archify/renderers/architecture/render-architecture.mjs test/faceplate-validation.test.mjs
git commit -m "feat(architecture): reject structural faceplate errors"
```

---

### Task 7: Delta compares faceplates

**Files:**
- Modify: `archify/delta/architecture-delta.mjs` (`COMPONENT_FIELDS`, ~line 184)
- Test: `test/faceplate-delta.test.mjs`

**Interfaces:**
- Produces: `faceplate` in `COMPONENT_FIELDS.semantic`.

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareArchitecture } from '../archify/delta/architecture-delta.mjs';

const base = () => ({
  schema_version: 1, diagram_type: 'architecture',
  meta: { title: 'Faceplate delta', output: 'delta.html' },
  components: [{ id: 'tx', type: 'backend', label: 'TX', pos: [0, 0], size: [420, 210],
    faceplate: { image: { path: 'faces/a.png', sha256: 'a'.repeat(64) }, width: 1401, height: 237,
      ports: [{ id: 'in-1', label: 'IN 1', x: 0.5, y: 0.5 }] } }],
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
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test test/faceplate-delta.test.mjs`
Expected: FAIL — `changed` is not reported.

- [ ] **Step 3: Add the field**

Add `'faceplate'` to `COMPONENT_FIELDS.semantic`.

- [ ] **Step 4: Run the test**

Run: `node --test test/faceplate-delta.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add archify/delta/architecture-delta.mjs test/faceplate-delta.test.mjs
git commit -m "feat(architecture): compare faceplates in deltas"
```

---

### Task 8: Checked-in example and docs

**Files:**
- Create: `archify/examples/assets/patch-panel.png` (synthetic 640×120 panel, generated by a documented one-liner)
- Create: `archify/examples/faceplate-patch-panel.architecture.json`
- Create: `archify/examples/faceplate-patch-panel-rendered.html` (generated)
- Modify: `archify/scripts/render-examples.mjs` (`TARGETS`)
- Modify: `archify/SKILL.md`, `archify/references/authoring-defaults.md`, `archify/references/authoring-contract.md`, `archify/schemas/README.md`

**Interfaces:**
- Consumes: every earlier task; `finalize` for the showcase gate.

- [ ] **Step 1: Generate the synthetic panel image**

Write a one-off script under `/tmp` that draws a 640×120 dark panel with two rows of labelled rectangles and writes `archify/examples/assets/patch-panel.png`; record the command in the example's docs. No brand, no product data.

- [ ] **Step 2: Write the example**

Two faceplate devices (a 4×2 matrix and a receiver) plus a display, six cables naming faceplate ports; the matrix image reuses the synthetic PNG with two different digests? No — one image, two models, different port sets. `finalize --quality showcase` must pass.

- [ ] **Step 3: Render and finalize**

Run: `node archify/scripts/render-examples.mjs` then
`node archify/bin/archify.mjs finalize architecture archify/examples/faceplate-patch-panel.architecture.json archify/examples/faceplate-patch-panel-rendered.html --quality showcase --json`
Expected: exit 0, all four gates pass.

- [ ] **Step 4: Write the docs**

- `SKILL.md`: one sentence — faceplates for device panels, see authoring defaults.
- `authoring-defaults.md`: image identity, aspect formula, caption space below, edge derivation, no `ports`/`sublabel`/`tag`/`icon`/`brand`/grid.
- `authoring-contract.md`: geometry bullet for faceplate holes and leads.
- `schemas/README.md`: `faceplate` fields.

- [ ] **Step 5: Verify and commit**

Run: `git status --short` (only intended files), then

```bash
git add archify/examples/assets/patch-panel.png archify/examples/faceplate-patch-panel.architecture.json archify/examples/faceplate-patch-panel-rendered.html archify/scripts/render-examples.mjs archify/SKILL.md archify/references/authoring-defaults.md archify/references/authoring-contract.md archify/schemas/README.md
git commit -m "docs(architecture): document faceplate nodes with a checked example"
```

---

### Task 9: Private device library and end-to-end proof

**Files:** none in this repository. Everything lives under `D:/wyrestorm-draw/archify-devices/` and is never committed.

- [ ] **Step 1: Build the library**

`build.mjs` reads `D:/wyrestorm-draw/WyreStorm-port-library/接线端口清单.json` (UTF-8) and `接口面/<id>.png`, and writes:
- `faces/<id>.png` (originals only, not the `-孔位核对` overlays)
- `index.json` — `[{ sku, skuName, faces: [{ id, face, ports, width, height, image, sha256 }] }]`
- `models/<SKU>.json` — one component fragment per face, `size` computed at width 420, `sha256` included.

- [ ] **Step 2: Spot-check three models**

Run the fragment for `SW-660-TX-W`, one matrix (e.g. `M4250-*`) and one wall plate through `validate`; every fragment must pass and every declared port count must match `index.json`.

- [ ] **Step 3: Draw the real SIT rehearsal**

Compose a diagram with `SW-660-TX-W` (rear face, 31 holes) as source, a matrix, and two displays; name 6 holes; `finalize --quality showcase`. Keep the JSON and HTML in the private folder.

- [ ] **Step 4: Record the evidence**

Write counts (models, faces, ports), the three spot checks, and the rehearsal gate result into the local ledger; do not commit them or the library.

---

### Task 10: Regression, install, push

- [ ] **Step 1: Golden and port checks**

Run: `npm run test:generated` and
`node scripts/run-tests.mjs test/faceplate-meta.test.mjs test/faceplate-schema.test.mjs test/faceplate-path.test.mjs test/faceplate-geometry.test.mjs test/faceplate-render.test.mjs test/faceplate-validation.test.mjs test/faceplate-delta.test.mjs test/architecture-ports-layout.test.mjs test/architecture-ports-geometry.test.mjs test/architecture-ports-validation.test.mjs test/layout-rules.test.mjs`
Expected: all pass.

- [ ] **Step 2: Rebuild the packaged skill**

Run with a canonical Node 22 toolchain: `PATH=<node22>:$PATH bash scripts/build-zip.sh`.

- [ ] **Step 3: Install locally**

Back up the installed skill, copy `archify/` over it, run `doctor`, and finalize the checked-in example with the installed copy.

- [ ] **Step 4: Commit and push**

Commit the zip rebuild; push `feat/architecture-ports` (retry through the API replay path if `github.com:443` is down again).

---

## What this plan deliberately leaves open

- Dot/lead sizes may move a pixel if the renderer proves too busy at 100%.
- The JPEG sniffer handles the common SOF markers only; unusual variants fail with `-image-format`.
- The private builder's face-cropping rules (which faces to keep, how to name them) follow the existing inventory; no re-derivation from images.

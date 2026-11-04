# Architecture Named Ports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an Architecture component declare named left/right connector ports, let connections terminate on those ports, and draw each port as a jack with a label — with fail-closed validation.

**Architecture:** Ports are a component property in the typed JSON IR (`components[].ports`) referenced by connections (`fromPort` / `toPort`). A new pure module computes slot positions, rail widths and capacity from the component box alone. The router treats a port endpoint as a fixed point and excludes ported sides from automatic side inference. The renderer draws the jacks and insets the card's own text; the existing validator channel rejects structural port errors.

**Tech Stack:** Node.js ESM (>= 18), zero runtime dependencies, `node:test`, AJV (dev-only, for generating the checked-in validators), headless Chrome only for the existing `finalize` browser gate.

**Spec:** `docs/superpowers/specs/2026-11-04-architecture-port-anchors-design.md`

## Global Constraints

- Only the `architecture` diagram type changes; the other nine renderers and the Viewer are untouched.
- No new runtime dependencies; `archify/` stays zero-dependency.
- Port sides are `left` and `right` only.
- One cable per port: two connections on the same port is an error.
- Every port diagnostic is a hard error in both `standard` and `showcase`.
- Documents without `ports` must render byte-identically to today (golden check).
- Port geometry constants: band top `28`, band bottom `16`, minimum spacing `14`, label font `6`, rail padding `10`, jack `8×10`.
- Content stays English inside the repo (docs, comments, commit messages).
- Working copy: `D:/wyrestorm/.work/archify-fork`, branch `feat/architecture-ports`.

## Review Focus

- **Capacity boundary:** a side whose spacing is exactly `14px` must be accepted, not rejected by a floating-point comparison.
- **Ported side vs inferred side:** an ordinary connection whose default side is a ported side must move to another side, not silently land between jacks.
- **CJK port labels:** `HDMI IN 1` and `高清输入 1` must both produce a rail wide enough at 6px; `textUnits` counts a CJK character as two units.
- **Half-ported connection:** a connection with only `fromPort` (auto target) must still route, and its auto end must avoid the ported side.
- **Empty ports array:** `"ports": []` must behave exactly like omitting `ports` (same bytes).

---

### Task 1: Port layout primitives

**Files:**
- Create: `archify/renderers/shared/port-layout.mjs`
- Test: `test/architecture-ports-layout.test.mjs`

**Interfaces:**
- Consumes: `textUnits` from `archify/renderers/shared/utils.mjs`; `minimumNodeTextWidth` from `archify/renderers/shared/text-fit.mjs`.
- Produces:
  - `PORT_BAND_TOP = 28`, `PORT_BAND_BOTTOM = 16`, `PORT_MIN_SPACING = 14`, `PORT_LABEL_FONT_PX = 6`, `PORT_RAIL_PADDING = 10`, `PORT_JACK_WIDTH = 8`, `PORT_JACK_HEIGHT = 10`
  - `componentPorts(component) -> Array<{id,label,side}>`
  - `portSlots(component) -> Map<string, {id,label,side,x,y}>`
  - `portRailWidth(component, side) -> number`
  - `portRails(component) -> {left:number,right:number}`
  - `portCapacity(component) -> Array<{side,count,requiredPx,availablePx,ok}>`
  - `portRailCrowding(component) -> null | {requiredWidthPx:number,availableWidthPx:number}`

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  componentPorts, portCapacity, portRailCrowding, portRails, portRailWidth, portSlots,
} from '../archify/renderers/shared/port-layout.mjs';

const box = (y, h, ports, width = 240) => ({
  id: 'matrix', label: 'AV Matrix', x: 400, y, width, height: h, ports,
});

test('one port centres inside the port band', () => {
  const slots = portSlots(box(200, 130, [{ id: 'in-1', label: 'HDMI IN 1', side: 'left' }]));
  assert.deepEqual([...slots.values()].map(({ x, y }) => [x, y]), [[400, 200 + 28 + (130 - 44) / 2]]);
});

test('two ports spread evenly across the band', () => {
  const slots = portSlots(box(200, 130, [
    { id: 'in-1', label: 'HDMI IN 1', side: 'left' },
    { id: 'in-2', label: 'HDMI IN 2', side: 'left' },
  ]));
  assert.deepEqual([...slots.values()].map(({ y }) => y), [228, 314]);
});

test('right-side ports sit on the right border', () => {
  const slots = portSlots(box(200, 130, [{ id: 'out-1', label: 'HDMI OUT 1', side: 'right' }]));
  assert.equal([...slots.values()][0].x, 640);
});

test('capacity accepts exactly 14px spacing and rejects below it', () => {
  const four = (h) => box(0, h, [1, 2, 3, 4].map((n) => ({ id: `in-${n}`, label: `IN ${n}`, side: 'left' })));
  assert.deepEqual(portCapacity(four(86))[0], { side: 'left', count: 4, requiredPx: 86, availablePx: 86, ok: true });
  assert.equal(portCapacity(four(85))[0].ok, false);
  assert.equal(portCapacity(four(85))[0].requiredPx, 86);
});

test('rails reserve the widest label per side and count CJK as two units', () => {
  const c = box(0, 200, [
    { id: 'in-1', label: 'HDMI IN 1', side: 'left' },
    { id: 'out-1', label: 'HDMI OUT 1', side: 'right' },
  ]);
  assert.equal(portRailWidth(c, 'left'), Math.ceil(9 * 3.6) + 10);
  assert.equal(portRailWidth(c, 'right'), Math.ceil(10 * 3.6) + 10);
  assert.deepEqual(portRails(c), { left: 43, right: 46 });

  const cjk = box(0, 200, [{ id: 'in-1', label: '高清输入 1', side: 'left' }], 300);
  assert.equal(portRailWidth(cjk, 'left'), Math.ceil(10 * 3.6) + 10);
});

test('rail crowding reports the width a card needs', () => {
  const cramped = box(0, 200, [
    { id: 'in-1', label: 'HDMI IN 1', side: 'left' },
    { id: 'out-1', label: 'HDMI OUT 1', side: 'right' },
  ], 120);
  assert.deepEqual(portRailCrowding(cramped), { requiredWidthPx: 141, availableWidthPx: 120 });
});

test('no ports means no slots and no rails', () => {
  const plain = box(0, 130, undefined);
  assert.equal(componentPorts(plain).length, 0);
  assert.equal(portSlots(plain).size, 0);
  assert.deepEqual(portRails(plain), { left: 0, right: 0 });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/architecture-ports-layout.test.mjs`
Expected: FAIL — `Cannot find module .../port-layout.mjs`

- [ ] **Step 3: Implement `archify/renderers/shared/port-layout.mjs`**

Rules the implementation must follow: slots depend only on the component box and `ports` order; `usable = height - PORT_BAND_TOP - PORT_BAND_BOTTOM`; one port is centred in the band, `k >= 2` uses `y = box.y + PORT_BAND_TOP + i * usable / (k - 1)`; `portRailWidth` returns `ceil(textUnits(label) * 3.6) + 10` for the widest label on that side, `0` when the side has none; `portRailCrowding` compares `width` with `left + right + minimumNodeTextWidth(label, 8) + 8` (returns `null` when it fits, ceil the required width).

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/architecture-ports-layout.test.mjs`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add archify/renderers/shared/port-layout.mjs test/architecture-ports-layout.test.mjs
git commit -m "feat(architecture): add port layout primitives"
```

---

### Task 2: Schema fields and regenerated validators

**Files:**
- Modify: `archify/schemas/architecture.schema.json` (component `properties` block at lines 80-101; connection `properties` block at lines 130-150)
- Modify: `archify/renderers/shared/generated-validators.mjs` (generated)
- Test: `test/architecture-ports-schema.test.mjs`

**Interfaces:**
- Consumes: `validateSchema(type, document)` from `archify/renderers/shared/validator.mjs`.
- Produces: schema acceptance of `components[].ports[]` (`id`, `label`, `side`) and `connections[].fromPort` / `toPort`.

- [ ] **Step 1: Install the generator's dev dependency**

Run: `npm --prefix archify install`
Expected: `archify/node_modules` exists; no changes under version control.

- [ ] **Step 2: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateSchema } from '../archify/renderers/shared/validator.mjs';

const doc = (component = {}, connection = {}) => ({
  schema_version: 1,
  diagram_type: 'architecture',
  meta: { title: 'Ports' },
  components: [{ id: 'matrix', type: 'backend', label: 'Matrix', ports: [
    { id: 'in-1', label: 'HDMI IN 1', side: 'left' },
  ], ...component }],
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
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `node --test test/architecture-ports-schema.test.mjs`
Expected: FAIL — the `kind` case is accepted because `ports` is unknown and stripped.

- [ ] **Step 4: Add the schema fields and regenerate**

Add to the component `properties`: `"ports": { "type": "array", "maxItems": 16, "items": { "type": "object", "additionalProperties": false, "required": ["id", "label", "side"], "properties": { "id": { "type": "string", "pattern": "^[a-z][a-z0-9-]{0,31}$" }, "label": { "type": "string", "minLength": 1, "maxLength": 20 }, "side": { "enum": ["left", "right"] } } } }`.

Add to the connection `properties`: `"fromPort": { "type": "string", "minLength": 1, "maxLength": 32 }`, `"toPort": { "type": "string", "minLength": 1, "maxLength": 32 }`.

Run: `node archify/scripts/generate-validators.mjs`

- [ ] **Step 5: Run the tests and the freshness check**

Run: `node --test test/architecture-ports-schema.test.mjs && node archify/scripts/generate-validators.mjs --check`
Expected: PASS; freshness check exits 0 with no diff.

- [ ] **Step 6: Commit**

```bash
git add archify/schemas/architecture.schema.json archify/renderers/shared/generated-validators.mjs test/architecture-ports-schema.test.mjs
git commit -m "feat(architecture): accept named ports in the schema"
```

---

### Task 3: Router fixed endpoints and ported-side exclusivity

**Files:**
- Modify: `archify/renderers/architecture/render-architecture.mjs:355-376` (build `fixedPorts`, pass it to `createRouter`)
- Modify: `archify/renderers/architecture/routing.mjs:75-75` (option), `:743-795` (spread filter, endpoint side), `:843-875` (geometry), `:738-772` (side inference)
- Test: `test/architecture-ports-geometry.test.mjs`

**Interfaces:**
- Consumes: `portSlots` (Task 1), schema fields (Task 2).
- Produces: `createRouter(components, connections, { fixedPorts })` where `fixedPorts: Map<componentId, Map<portId, {side, point:[x,y]}>>`; `connectionEndpointSide()` returns the port side; `connectionGeometry()` starts/ends exactly at the port point; automatic side inference skips sides that have ports.

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
const renderer = path.join(skillRoot, 'renderers/architecture/render-architecture.mjs');
const cli = path.join(skillRoot, 'bin/archify.mjs');

function render(doc) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-ports-geometry-'));
  const input = path.join(tmp, 'in.json');
  const output = path.join(tmp, 'out.html');
  fs.writeFileSync(input, JSON.stringify(doc));
  try {
    execFileSync(process.execPath, [renderer, input, output], { stdio: ['ignore', 'ignore', 'pipe'] });
    return fs.readFileSync(output, 'utf8');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function validate(doc) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-ports-validate-'));
  const input = path.join(tmp, 'in.json');
  fs.writeFileSync(input, JSON.stringify(doc));
  try {
    const result = spawnSync(process.execPath, [cli, 'validate', 'architecture', input, '--json'], { encoding: 'utf8' });
    return { status: result.status, receipt: JSON.parse(result.stdout) };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function points(html, id) {
  const match = html.match(new RegExp(`data-edge-id="${id}"[^>]+data-composition-points="([^"]+)"`));
  assert.ok(match, `missing connection ${id}`);
  return match[1].split(';').map((pair) => pair.split(',').map(Number));
}

const base = (connections, extra = {}) => ({
  schema_version: 1,
  diagram_type: 'architecture',
  meta: { title: 'Ports geometry' },
  components: [
    { id: 'src', type: 'external', label: 'Source', pos: [100, 250], size: [120, 60],
      ports: [{ id: 'hdmi-out', label: 'HDMI OUT', side: 'right' }] },
    { id: 'matrix', type: 'backend', label: 'Matrix', pos: [400, 200], size: [240, 130],
      ports: [
        { id: 'in-1', label: 'HDMI IN 1', side: 'left' },
        { id: 'in-2', label: 'HDMI IN 2', side: 'left' },
        { id: 'out-1', label: 'HDMI OUT 1', side: 'right' },
      ] },
    ...(extra.components || []),
  ],
  connections,
  ...(extra.meta || {}),
});

test('a connection terminates exactly on the named port', () => {
  const html = render(base([{ id: 'feed', from: 'src', to: 'matrix', fromPort: 'hdmi-out', toPort: 'in-2' }]));
  assert.deepEqual(points(html, 'feed')[0], [220, 286]);
  assert.deepEqual(points(html, 'feed').at(-1), [400, 314]);
});

test('the route leaves a port horizontally', () => {
  const html = render(base([{ id: 'feed', from: 'src', to: 'matrix', fromPort: 'hdmi-out', toPort: 'in-1' }]));
  const pts = points(html, 'feed');
  assert.deepEqual(pts[0], [220, 286]);
  assert.deepEqual(pts.at(-1), [400, 228]);
  assert.equal(pts[1][1], 286, 'the first segment must be horizontal');
});

test('a half-ported connection still routes and keeps the port endpoint', () => {
  const html = render(base([{ id: 'feed', from: 'src', to: 'matrix', toPort: 'in-1' }]));
  assert.deepEqual(points(html, 'feed').at(-1), [400, 228]);
});

test('a portless connection avoids a ported side', () => {
  const doc = base([{ id: 'feed', from: 'src', to: 'matrix' }]);
  doc.components[0].ports = [];
  doc.components[1].ports = doc.components[1].ports.filter((port) => port.side === 'left');
  const html = render(doc);
  const ends = points(html, 'feed');
  assert.notEqual(ends.at(-1)[0], 400, 'must not enter the ported left side');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/architecture-ports-geometry.test.mjs`
Expected: FAIL at the first endpoint assertion (line currently starts at the card side midpoint) and at the conflict assertion (no such diagnostic yet).

- [ ] **Step 3: Implement the router integration**

In `render-architecture.mjs`, after the `components` map is built, build the fixed-port map from `portSlots` and pass `fixedPorts` in `routerOptions`; do not change any other router option.

In `routing.mjs`:
- Add `fixedPorts = null` to the `createRouter` option list.
- Add `fixedEndpoint(conn, endpoint)` returning `fixedPorts?.get(conn[from|to])?.get(conn[fromPort|toPort]) ?? null`.
- `connectionEndpointSide`: return `fixedEndpoint(conn, endpoint).side` first.
- `connectionGeometry`: when a fixed endpoint exists, use its `point` and `spread: false` instead of `automaticEndpoint` / legacy spread.
- Pass `connections.filter((conn) => !conn.fromPort && !conn.toPort)` to `automaticPortSpread`.
- In `inferredConnectionSides`, after computing a default side, replace it with the first side from `['left','right','top','bottom']` that has no port when the component declares ports on that default side. Authored `fromSide`/`toSide` are not rewritten; they surface in Task 5 as an error.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/architecture-ports-geometry.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add archify/renderers/architecture/routing.mjs archify/renderers/architecture/render-architecture.mjs test/architecture-ports-geometry.test.mjs
git commit -m "feat(architecture): route connections to named ports"
```

---

### Task 4: Draw jacks, port labels and the card text inset

**Files:**
- Modify: `archify/renderers/architecture/render-architecture.mjs:1083-1105` (`renderComponent`)
- Modify: `archify/renderers/shared/node-card-style.mjs` (add `.c-port-jack` rules)
- Test: `test/architecture-ports-render.test.mjs`

**Interfaces:**
- Consumes: `portSlots`, `portRails`, `PORT_JACK_*`, `PORT_LABEL_FONT_PX` (Task 1).
- Produces: SVG `<g data-ports="">` inside each ported node group, with one `<rect class="c-port-jack">` and one `<text data-detail="fine">` per declared port; the card's own label/sublabel/tag centred inside the rail inset.

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

function render(doc) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-ports-render-'));
  const input = path.join(tmp, 'in.json');
  const output = path.join(tmp, 'out.html');
  fs.writeFileSync(input, JSON.stringify(doc));
  try {
    execFileSync(process.execPath, [renderer, input, output], { stdio: ['ignore', 'ignore', 'pipe'] });
    return fs.readFileSync(output, 'utf8');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

const withPorts = (ports, width = 240) => ({
  schema_version: 1,
  diagram_type: 'architecture',
  meta: { title: 'Ports render' },
  components: [
    { id: 'matrix', type: 'backend', label: 'AV Matrix', pos: [200, 200], size: [width, 170], ports },
    { id: 'tv', type: 'external', label: 'Display', pos: [560, 250], size: [120, 60] },
  ],
  connections: [{ id: 'feed', from: 'matrix', to: 'tv', fromPort: 'out-1', toSide: 'left' }],
});

const PORTS = [
  { id: 'in-1', label: 'HDMI IN 1', side: 'left' },
  { id: 'in-2', label: 'HDMI IN 2', side: 'left' },
  { id: 'out-1', label: 'HDMI OUT 1', side: 'right' },
];

test('every declared port draws one jack and one fine label', () => {
  const html = render(withPorts(PORTS));
  assert.equal((html.match(/<g data-ports="">/g) || []).length, 1);
  assert.equal((html.match(/class="c-port-jack"/g) || []).length, 3);
  for (const port of PORTS) {
    assert.match(html, new RegExp(`<text data-detail="fine"[^>]*>${port.label}</text>`));
  }
});

test('an unconnected port still draws', () => {
  const html = render(withPorts(PORTS));
  assert.match(html, />HDMI IN 2</);
});

test('the artifact keeps a single svg', () => {
  assert.equal((render(withPorts(PORTS)).match(/<svg\b/g) || []).length, 1);
});

test('an empty ports array renders the same bytes as no ports field', () => {
  const without = withPorts(undefined);
  const empty = withPorts([]);
  assert.equal(render(empty), render(without));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/architecture-ports-render.test.mjs`
Expected: FAIL — no `data-ports` group.

- [ ] **Step 3: Implement the drawing and the inset**

In `renderComponent`, compute `const rails = portRails(c)`, shift the content centre to `c.x + rails.left + (c.width - rails.left - rails.right) / 2`, pass `c.width - rails.left - rails.right` to `fittedNodeFontSize` and to the sublabel/tag fit calls, and append a `renderPorts(c)` block inside the node group (before the node label). `renderPorts` emits one `<rect class="c-port-jack">` centred on the border and one `<text data-detail="fine" class="t-muted" font-size="6">` per slot, with `text-anchor="start"` at `x + 8` on the left and `text-anchor="end"` at `right - 8` on the right.

In `node-card-style.mjs`, add `.c-port-jack { fill: var(--mask); stroke: var(--lane-stroke); stroke-width: .8px; }` plus a `rx: 1px` override for the blueprint preset. Keep every colour a CSS variable.

- [ ] **Step 4: Run the tests and the artifact checker**

Run: `node --test test/architecture-ports-render.test.mjs`
Expected: PASS (4 tests).

Run the delivered file through the checker: `node archify/bin/archify.mjs validate architecture archify/examples/web-app.architecture.json --json`
Expected: `"ok": true` and no `composition/*` diagnostics.

- [ ] **Step 5: Commit**

```bash
git add archify/renderers/architecture/render-architecture.mjs archify/renderers/shared/node-card-style.mjs test/architecture-ports-render.test.mjs
git commit -m "feat(architecture): draw connector jacks and port labels"
```

---

### Task 5: Port diagnostics

**Files:**
- Modify: `archify/renderers/architecture/render-architecture.mjs:487-1005` (`validateArchitecture`)
- Test: `test/architecture-ports-validation.test.mjs`
- Modify: `test/architecture-ports-geometry.test.mjs` (add the side-conflict case)

**Interfaces:**
- Consumes: `componentPorts`, `portCapacity`, `portRailCrowding` (Task 1); `connectionEndpointSide` (Task 3).
- Produces: diagnostics with codes `architecture/unknown-port`, `architecture/duplicate-port-id`, `architecture/port-side-conflict`, `architecture/port-duplicate-use`, `architecture/port-capacity`, `architecture/port-rail-crowded`, `architecture/port-side-exclusive`, each with `subject`, `evidence` and `supportedFixes`.

- [ ] **Step 1: Write the failing test**

```js
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
  meta: { title: 'Port diagnostics' },
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/architecture-ports-validation.test.mjs`
Expected: FAIL — the CLI exits 0 or reports unrelated diagnostics.

- [ ] **Step 3: Implement the checks**

In `validateArchitecture`, after the component loop and before component overlap:
- For each component: duplicate ids, `portCapacity` failures, `portRailCrowding`.
- For each connection: resolve `fromPort` / `toPort` against the component's ports; unknown port, side conflict (`fromSide !== port.side`), duplicate use (key `${componentId}\u0000${portId}`), and exclusivity (endpoint without a port whose chosen side is ported).

Each diagnostic follows the existing shape: `code`, `severity: 'error'`, `message`, `subject` (diagramType, nodeId, optional portId/connectionId), `evidence`, `supportedFixes` (2-3 concrete fixes naming the required size or the available ports).

- [ ] **Step 4: Run the tests**

Run: `node --test test/architecture-ports-validation.test.mjs test/architecture-ports-geometry.test.mjs`
Expected: PASS (12 tests combined).

- [ ] **Step 5: Commit**

```bash
git add archify/renderers/architecture/render-architecture.mjs test/architecture-ports-validation.test.mjs test/architecture-ports-geometry.test.mjs
git commit -m "feat(architecture): reject structural port errors"
```

---

### Task 6: Architecture delta compares ports

**Files:**
- Modify: `archify/delta/architecture-delta.mjs:184-193`
- Test: `test/architecture-delta-ports.test.mjs`

**Interfaces:**
- Consumes: `compareArchitecture(base, head)` from `archify/delta/architecture-delta.mjs`.
- Produces: `ports` in `COMPONENT_FIELDS.semantic`, `fromPort` / `toPort` in `CONNECTION_FIELDS.semantic`.

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareArchitecture } from '../archify/delta/architecture-delta.mjs';

const base = () => ({
  schema_version: 1,
  diagram_type: 'architecture',
  meta: { title: 'Ports delta' },
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/architecture-delta-ports.test.mjs`
Expected: FAIL — no component/connection change is reported.

- [ ] **Step 3: Add the fields**

Add `'ports'` to `COMPONENT_FIELDS.semantic`; add `'fromPort'` and `'toPort'` to `CONNECTION_FIELDS.semantic`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/architecture-delta-ports.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add archify/delta/architecture-delta.mjs test/architecture-delta-ports.test.mjs
git commit -m "feat(architecture): compare port wiring in deltas"
```

---

### Task 7: Checked-in example and authoring docs

**Files:**
- Create: `archify/examples/av-patch-panel.architecture.json`
- Create: `archify/examples/av-patch-panel-rendered.html` (generated)
- Modify: `archify/scripts/render-examples.mjs` (`TARGETS`)
- Modify: `archify/SKILL.md`, `archify/references/authoring-defaults.md`, `archify/references/authoring-contract.md`, `archify/schemas/README.md`

**Interfaces:**
- Consumes: every earlier task; `node archify/bin/archify.mjs finalize`.
- Produces: a showcase-quality example that exercises named ports, an empty jack, and straight routes.

- [ ] **Step 1: Write the example JSON**

Use these components and the four port-to-port connections; every cable is straight because each pair shares a y.

```json
{
  "schema_version": 1,
  "diagram_type": "architecture",
  "meta": { "title": "Patch panel: two sources to two displays", "output": "av-patch-panel-rendered.html", "quality_profile": "showcase" },
  "components": [
    { "id": "player", "type": "external", "label": "Media Player", "pos": [40, 167], "size": [150, 70],
      "ports": [{ "id": "hdmi-out", "label": "HDMI OUT", "side": "right" }] },
    { "id": "laptop", "type": "external", "label": "Laptop", "pos": [40, 255], "size": [150, 70],
      "ports": [{ "id": "hdmi-out", "label": "HDMI OUT", "side": "right" }] },
    { "id": "matrix", "type": "backend", "label": "AV Matrix", "pos": [320, 180], "size": [250, 220],
      "ports": [
        { "id": "in-1", "label": "HDMI IN 1", "side": "left" },
        { "id": "in-2", "label": "HDMI IN 2", "side": "left" },
        { "id": "in-3", "label": "HDMI IN 3", "side": "left" },
        { "id": "out-1", "label": "HDMI OUT 1", "side": "right" },
        { "id": "out-2", "label": "HDMI OUT 2", "side": "right" }
      ] },
    { "id": "display-a", "type": "external", "label": "Display A", "pos": [700, 167], "size": [150, 70],
      "ports": [{ "id": "hdmi-in", "label": "HDMI IN", "side": "left" }] },
    { "id": "display-b", "type": "external", "label": "Display B", "pos": [700, 343], "size": [150, 70],
      "ports": [{ "id": "hdmi-in", "label": "HDMI IN", "side": "left" }] }
  ],
  "connections": [
    { "id": "player-to-in-1", "from": "player", "to": "matrix", "fromPort": "hdmi-out", "toPort": "in-1" },
    { "id": "laptop-to-in-2", "from": "laptop", "to": "matrix", "fromPort": "hdmi-out", "toPort": "in-2" },
    { "id": "out-1-to-display-a", "from": "matrix", "to": "display-a", "fromPort": "out-1", "toPort": "hdmi-in" },
    { "id": "out-2-to-display-b", "from": "matrix", "to": "display-b", "fromPort": "out-2", "toPort": "hdmi-in" }
  ]
}
```

`in-3` is deliberately unconnected: it proves an empty jack still draws.

- [ ] **Step 2: Render it and fix placement until the gates pass**

Add `['architecture', 'av-patch-panel.architecture.json', 'av-patch-panel-rendered.html']` to `TARGETS` in `archify/scripts/render-examples.mjs`, then run `node archify/scripts/render-examples.mjs` and `node archify/bin/archify.mjs finalize architecture archify/examples/av-patch-panel.architecture.json archify/examples/av-patch-panel-rendered.html --quality showcase --json`.
Expected: exit 0, `gates` all `pass`. If a geometry diagnostic names a route or label, adjust only `pos`/`size` in the example, never the renderer.

- [ ] **Step 3: Write the authoring docs**

- `SKILL.md`: one sentence in the Architecture authoring guidance pointing at named ports for AV-style wiring, and at `authoring-defaults.md` for the limits.
- `authoring-defaults.md`: when to declare ports (a jack the reader must name) versus `fromSide` (an ordinary dependency); sides left/right only; capacity `44 + 14 × (k − 1)`; one cable per port; ported sides are exclusive.
- `authoring-contract.md`: add the port geometry rules (band 28/16, even spread, rail width, jack size).
- `schemas/README.md`: the two new field groups.

- [ ] **Step 4: Verify the example and docs**

Run: `node archify/bin/archify.mjs validate architecture archify/examples/av-patch-panel.architecture.json --quality showcase --json`
Expected: `"ok": true`, zero `composition/*` diagnostics.

Run: `git status --short`
Expected: the example JSON, its rendered HTML, the `TARGETS` edit and the four doc files only.

- [ ] **Step 5: Commit**

```bash
git add archify/examples/av-patch-panel.architecture.json archify/examples/av-patch-panel-rendered.html archify/scripts/render-examples.mjs archify/SKILL.md archify/references/authoring-defaults.md archify/references/authoring-contract.md archify/schemas/README.md
git commit -m "docs(architecture): document named ports with a checked example"
```

---

### Task 8: Regression, local install, push

**Files:**
- No source files; this task proves the slice and installs it.

**Interfaces:**
- Consumes: the whole branch.
- Produces: a green test run, a verified installed skill, and the pushed branch.

- [ ] **Step 1: Install root dev dependencies and run the golden set**

Run: `npm install` (repository root) then `npm run test:generated`
Expected: exit 0 — viewer/brand/validator freshness plus `test/golden.mjs` unchanged for every non-port example.

- [ ] **Step 2: Run every port test plus the existing architecture suite**

Run: `node scripts/run-tests.mjs test/architecture-ports-layout.test.mjs test/architecture-ports-schema.test.mjs test/architecture-ports-geometry.test.mjs test/architecture-ports-render.test.mjs test/architecture-ports-validation.test.mjs test/architecture-delta-ports.test.mjs test/architecture-component-diagnostics.test.mjs test/automatic-port-spread.test.mjs`
Expected: all pass.

- [ ] **Step 3: Check for stray files**

Run: `git status --short`
Expected: clean apart from intended files; delete any temp output, screenshot or log the runs created.

- [ ] **Step 4: Back up and install the skill**

```bash
mv "C:/Users/WS/.agents/skills/archify" "C:/Users/WS/.agents/skills/archify.backup-$(date +%Y%m%d-%H%M%S)"
cp -r archify "C:/Users/WS/.agents/skills/archify"
node "C:/Users/WS/.agents/skills/archify/bin/archify.mjs" doctor
```

- [ ] **Step 5: Finalize the example with the installed skill**

Run: `node "C:/Users/WS/.agents/skills/archify/bin/archify.mjs" finalize architecture archify/examples/av-patch-panel.architecture.json /tmp/av-patch-panel-installed.html --quality showcase --json`
Expected: exit 0, all four gates pass, absolute path reported.

- [ ] **Step 6: Commit and push**

```bash
git push origin feat/architecture-ports
```

Then report the branch URL, the installed skill path, and the backup path.

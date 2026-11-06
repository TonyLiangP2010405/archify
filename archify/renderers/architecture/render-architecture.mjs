import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { esc, renderDefinitions, renderSemanticSigil, textUnits } from '../shared/utils.mjs';
import { NODE_CARD_ATTR, nodeCardStyle } from '../shared/node-card-style.mjs';
import {
  componentPorts, PORT_JACK_HEIGHT, PORT_JACK_WIDTH, PORT_LABEL_FONT_PX,
  portCapacity, portRailCrowding, portRails, portSlots,
} from '../shared/port-layout.mjs';
import { animateAttr, focusEdgeAttrs, focusNodeAttrs, focusNodeTitle, loadDiagramWithBrandMarks, writeDiagram, svgAccessibleText, svgRootAttrs } from '../shared/cli.mjs';
import { componentBox, boundaryBox, connectionPath } from '../shared/layout-report.mjs';
import { rendererFailure, throwDiagnosticProblems } from '../shared/diagnostics.mjs';
import { readFaceplateImage } from '../shared/faceplate-meta.mjs';
import { renderPictogram } from '../shared/pictograms.mjs';
import { legendFootprint, relationshipLegendObstacles, resolveLegend, renderLegend as renderResolvedLegend } from '../shared/legend.mjs';
import { availableNodeTextWidth, fittedNodeFontSize, minimumNodeTextWidth } from '../shared/text-fit.mjs';
import { brandLabelFitWidth, brandMetadataFor, brandTopRailProblem, renderBrandMark } from '../shared/brand-marks.mjs';
import { minimumReadableSourceTextPx } from '../shared/desktop-readability.mjs';
import { translateMessage as i18nText } from '../shared/i18n.mjs';
import { gridLayout, resolveComponentPos, validateGridPlacement } from './grid.mjs';
import { createRouter } from './routing.mjs';
import { placeAutomaticLabels, reservedLabelRect } from '../shared/automatic-labels.mjs';
import { cleanRouteDetourProblems } from '../shared/route-quality.mjs';
import {
  asArray,
  isFinitePoint,
  rectsOverlap,
  segmentIntersectsRect,
  cleanEndpointSideProblems,
  cleanFlowProblems,
  cleanCrossingProblems,
  cleanAmbiguousCorridorProblems,
  collectArrowheadCollisions,
  cleanBorderRunProblems,
  cleanRouteRhythmProblems,
  cleanLabelRouteClearanceProblems,
  cleanLabelCanvasContainmentProblems,
  suggestLabelObstacleFix,
  componentSeparationOptions,
  suggestComponentSeparation,
  polylinePath,
  routePointsValue,
  authoredStraightRouteAttrs,
  labelPoint,
  componentFill,
  componentText,
  arrowClassMap,
  edgeLabelAccent,
} from '../shared/geometry.mjs';

const componentTextFit = {
  sublabelPreferred: 9,
  sublabelMinimum: 6,
  tagPreferred: 7,
  tagMinimum: 6,
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const layoutJsonMode = process.argv.includes('--layout-json');
const cliArgs = process.argv.filter((arg) => arg !== '--layout-json');
const { diagram: arch, template, outPath, sourceEvidence, authoredDir } = await loadDiagramWithBrandMarks({
  rendererDir: __dirname,
  diagramType: 'architecture',
  defaultExample: 'web-app.architecture.json',
  argv: cliArgs,
});

const grid = gridLayout(arch);

const layout = {
  defaultW: 120,
  defaultH: 60,
  margin: 40,
  // Boundary padding — the 30/50 rule that was a hand-arithmetic footgun
  // (CHANGELOG v2.2.1): 30px on top/left/right, plus 20px extra at the bottom.
  boundaryPad: 30,
  boundaryExtraBottom: 20,
  boundaryLabelBaseline: 21,
  boundaryLabelClearance: 4,
  boundaryLabelFontPreferred: 12,
  boundaryLabelFontMinimum: 6,
  boundaryLabelMaskHeight: 19,
  boundaryLabelRailGap: 2,
  boundaryLabelFrameInset: 4,
  legendH: 28,
};

const LEGEND_CATALOG = [
  'frontend',
  'backend',
  'database',
  'cloud',
  'security',
  'messagebus',
  'external',
].map((kind) => ({ kind, label: i18nText(arch.meta.locale, `legend.architecture.${kind}`) }));

// ---- Measure components from free coordinates --------------------------------
function measureComponent(c) {
  const [x, y] = resolveComponentPos(c, grid);
  const [w, h] = Array.isArray(c.size) ? c.size : [layout.defaultW, layout.defaultH];
  return { ...c, x, y, width: w, height: h, cx: x + w / 2, cy: y + h / 2 };
}

const components = new Map(asArray(arch.components).map((c) => [c.id, measureComponent(c)]));
// Named connector ports: measure every declared jack once, so routing and
// rendering read the same fixed endpoint.
const fixedPorts = new Map();
for (const component of components.values()) {
  const slots = portSlots(component);
  if (!slots.size) continue;
  fixedPorts.set(component.id, new Map([...slots].map(([id, slot]) => [
    id,
    { side: slot.side, point: [slot.x, slot.y] },
  ])));
}
// ---- Faceplate nodes --------------------------------------------------------
// A faceplate is one image plus holes at 0-1 coordinates. The hole's exit sits
// on the nearest box edge in pixels and that edge point is the route endpoint;
// the cable's final stretch from the exit into the jack is drawn above the image
// by renderPortStubs, so every cable visibly ends on the hole.
const FACEPLATE_EDGES = ['top', 'right', 'bottom', 'left'];
// A photographed panel's printed silkscreen is a fixed fraction of the image,
// so a faceplate drawn far below its source width renders jack names unreadably.
// Synthetic test strips (a couple of pixels wide) are exempt.
const FACEPLATE_MIN_RENDERED_SCALE = 0.45;
const FACEPLATE_PHOTO_MIN_SOURCE_PX = 240;

function faceplateEdge(side, port, box) {
  switch (side) {
    case 'left': return [box.x, box.y + port.y * box.height];
    case 'right': return [box.x + box.width, box.y + port.y * box.height];
    case 'top': return [box.x + port.x * box.width, box.y];
    default: return [box.x + port.x * box.width, box.y + box.height];
  }
}

function nearestFaceplateSide(port, box, counterparts = []) {
  const distances = {
    left: port.x * box.width,
    right: (1 - port.x) * box.width,
    top: port.y * box.height,
    bottom: (1 - port.y) * box.height,
  };
  const nearest = FACEPLATE_EDGES.reduce((best, side) => (distances[side] < distances[best] ? side : best), 'top');
  if (nearest !== 'top' && nearest !== 'bottom') return nearest;
  // On a wide, shallow panel a jack near the vertical middle is a pixel or two
  // from both edges, and that coin flip decides whether the cable approaches
  // from above or below. Flip it wrong and the route has to wrap around the
  // chassis, which reads as a cable passing behind the device. Follow the
  // cables instead: approach from the side the connected nodes sit on.
  if (Math.abs(distances.top - distances.bottom) > Math.max(6, box.height * 0.12)) return nearest;
  if (!counterparts.length) return nearest;
  const middle = box.y + box.height / 2;
  if (counterparts.every(([, y]) => y < middle)) return 'top';
  if (counterparts.every(([, y]) => y > middle)) return 'bottom';
  return nearest;
}

function faceplateSideFor(port, box, counterparts) {
  return port.side || nearestFaceplateSide(port, box, counterparts);
}

function faceplateCaptionRect(component) {
  const width = Math.ceil(textUnits(component.label) * 4.8) + 10;
  const baseline = component.y + component.height + 10;
  return { x: component.x + component.width / 2 - width / 2, y: baseline - 9, width, height: 12, baseline };
}

function faceplateFailure(code, message, component, evidence, supportedFixes) {
  return {
    code,
    severity: 'error',
    message,
    subject: { diagramType: 'architecture', nodeId: component.id },
    evidence,
    supportedFixes,
  };
}

const faceplateModels = new Map();
const faceplateDiagnostics = [];
const faceplateProblems = [];
// Where each faceplate jack's cables come from, so a jack near the vertical
// middle can face its cables instead of a coin-flip edge.
const faceplateCounterparts = new Map();
const rememberCounterpart = (componentId, portId, counterpart) => {
  if (!componentId || !portId || !counterpart) return;
  const key = `${componentId}\u0000${portId}`;
  const list = faceplateCounterparts.get(key) || [];
  list.push([counterpart.x + counterpart.width / 2, counterpart.y + counterpart.height / 2]);
  faceplateCounterparts.set(key, list);
};
for (const conn of asArray(arch.connections)) {
  rememberCounterpart(conn.from, conn.fromPort, components.get(conn.to));
  rememberCounterpart(conn.to, conn.toPort, components.get(conn.from));
}
for (const component of components.values()) {
  if (!component.faceplate) continue;
  const { faceplate } = component;
  const absolute = path.isAbsolute(faceplate.image.path)
    ? faceplate.image.path
    : path.resolve(authoredDir, faceplate.image.path);
  let file = null;
  try {
    file = readFaceplateImage(absolute);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  if (!file) {
    const message = `Component "${component.id}" faceplate image could not be read: ${faceplate.image.path}.`;
    faceplateDiagnostics.push(faceplateFailure('architecture/faceplate-missing-image', message, component,
      { image: faceplate.image.path, resolved: absolute },
      ['fix the image path', 'or copy the image beside the JSON']));
    faceplateProblems.push(message);
    continue;
  }
  if (file.sha256 !== faceplate.image.sha256) {
    const message = `Component "${component.id}" faceplate image does not match its pinned sha256.`;
    faceplateDiagnostics.push(faceplateFailure('architecture/faceplate-image-changed', message, component,
      { expected: faceplate.image.sha256, actual: file.sha256 },
      ['update image.sha256 after a deliberate image change', 'or restore the original image']));
    faceplateProblems.push(message);
    continue;
  }
  if (file.width !== faceplate.width || file.height !== faceplate.height) {
    const message = `Component "${component.id}" declares a ${faceplate.width}x${faceplate.height} faceplate but the image is ${file.width}x${file.height}.`;
    faceplateDiagnostics.push(faceplateFailure('architecture/faceplate-image-mismatch', message, component,
      { declared: [faceplate.width, faceplate.height], actual: [file.width, file.height] },
      [`set width to ${file.width} and height to ${file.height}`]));
    faceplateProblems.push(message);
    continue;
  }
  const ports = new Map();
  // Two jacks at one height both leave through the same side edge; nudge the
  // second along that edge so two cables never share one exit point.
  const usedEdgePoints = new Map();
  const nudgeEdgePoint = (side, point) => {
    const axis = side === 'top' || side === 'bottom' ? 0 : 1;
    const low = axis === 0 ? component.x + 2 : component.y + 2;
    const high = axis === 0 ? component.x + component.width - 2 : component.y + component.height - 2;
    const span = Math.max(0, high - low);
    for (let step = 0; step <= Math.ceil(span); step += 1) {
      for (const sign of step === 0 ? [1] : [1, -1]) {
        const candidate = [...point];
        candidate[axis] = Math.min(high, Math.max(low, point[axis] + sign * step));
        const key = `${side}:${Math.round(candidate[axis] * 10) / 10}`;
        if (!usedEdgePoints.has(key)) {
          usedEdgePoints.set(key, true);
          return candidate;
        }
      }
    }
    return null;
  };
  const exhaustedExits = [];
  for (const port of faceplate.ports) {
    if (ports.has(port.id)) {
      const message = `Component "${component.id}" declares faceplate port "${port.id}" more than once — a duplicate hole would vanish.`;
      faceplateDiagnostics.push(faceplateFailure('architecture/faceplate-port-duplicate', message, component,
        { portId: port.id },
        ['give the second hole a distinct id']));
      faceplateProblems.push(message);
      continue;
    }
    const side = faceplateSideFor(port, component, faceplateCounterparts.get(`${component.id}\u0000${port.id}`) || []);
    const foot = faceplateEdge(side, port, component);
    const nudged = nudgeEdgePoint(side, foot);
    if (!nudged) exhaustedExits.push(port.id);
    ports.set(port.id, {
      side,
      point: nudged || foot,
      jack: [component.x + port.x * component.width, component.y + port.y * component.height],
      label: port.label,
    });
  }
  faceplateModels.set(component.id, { image: file, box: component, ports, exhaustedExits });
}
if (faceplateProblems.length) {
  throwDiagnosticProblems('Architecture faceplate validation failed', faceplateProblems, {
    subject: { diagramType: 'architecture' },
    diagnostics: faceplateDiagnostics,
  });
}

// Faceplate holes join the router's fixed endpoints. Named-port side
// exclusivity stays limited to `ports`, so ordinary cables may still enter a
// panel; the router keeps clear of the jacks themselves.
for (const [id, model] of faceplateModels) {
  const endpoints = fixedPorts.get(id) || new Map();
  for (const [portId, port] of model.ports) endpoints.set(portId, { side: port.side, point: port.point });
  fixedPorts.set(id, endpoints);
}
const namedPortSides = new Map();
for (const component of components.values()) {
  const sides = new Set(componentPorts(component).map((port) => port.side));
  if (sides.size) namedPortSides.set(component.id, sides);
}

const enforcesBoundaryTitleComposition = Boolean(arch.meta?.quality_profile);
const componentSteps = new Map();
for (const [index, conn] of asArray(arch.connections).entries()) {
  if (!componentSteps.has(conn.from)) componentSteps.set(conn.from, index);
  if (!componentSteps.has(conn.to)) componentSteps.set(conn.to, index + 1);
}
for (const [index, c] of asArray(arch.components).entries()) {
  if (!componentSteps.has(c.id)) componentSteps.set(c.id, index);
}

// ---- Boundaries computed from the `wraps` id list ---------------------------
function boundaryRect(boundary) {
  const members = asArray(boundary.wraps).map((id) => components.get(id)).filter(Boolean);
  if (!members.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const member of members) {
    minX = Math.min(minX, member.x);
    minY = Math.min(minY, member.y);
    maxX = Math.max(maxX, member.x + member.width);
    maxY = Math.max(maxY, member.y + member.height);
  }
  const pad = boundary.pad ?? layout.boundaryPad;
  const topPad = Math.max(
    pad,
    layout.boundaryLabelBaseline + layout.boundaryLabelClearance,
    // Routes must avoid the title rail that the final frame will contain.
    enforcesBoundaryTitleComposition
      ? layout.boundaryLabelMaskHeight + layout.boundaryLabelClearance + layout.boundaryLabelFrameInset
      : 0,
  );
  return {
    ...boundary,
    x: minX - pad,
    y: minY - topPad,
    width: maxX - minX + pad * 2,
    height: maxY - minY + topPad + layout.boundaryExtraBottom,
    memberTop: minY,
  };
}

function rectContains(outer, inner) {
  const epsilon = 1e-9;
  return outer.x <= inner.x + epsilon
    && outer.y <= inner.y + epsilon
    && outer.x + outer.width + epsilon >= inner.x + inner.width
    && outer.y + outer.height + epsilon >= inner.y + inner.height;
}

function boundaryLabelWidth(label, fontSize) {
  return Math.max(30, textUnits(label) * fontSize * 0.6 + 10);
}

const architectureLegendEntries = resolveLegend(
  arch.meta?.legend,
  LEGEND_CATALOG,
  new Set([...components.values()].map((component) => component.type)),
);

// One source for connection label geometry: the rect the containment rule
// measures is the rect the SVG mask draws, the auto canvas covers, the legend
// avoids, and the layout report publishes.
const resolvedLabelPoints = new Map();
function connectionLabelBox(conn) {
  if (!conn.label) return null;
  return connectionLabelBoxAt(conn, resolvedLabelPoints.get(conn) || labelPoint(conn, pathFor(conn).points));
}

function connectionLabelBoxAt(conn, [lx, ly]) {
  const width = Math.max(30, textUnits(conn.label) * 4.8 + 10);
  return { x: lx - width / 2, y: ly - 10, width, height: 14, lx, ly };
}

function connectionLabelRects() {
  const rects = [];
  for (const [relationIndex, conn] of asArray(arch.connections).entries()) {
    if (!components.has(conn.from) || !components.has(conn.to)) continue;
    const box = connectionLabelBox(conn);
    if (!box) continue;
    rects.push({ relation: conn, relationIndex, label: conn.label, ...box });
  }
  return rects;
}

function autoViewBoxFor(candidateBoundaries, extraRects = []) {
  let maxX = 0;
  let maxY = 0;
  for (const rects of [components.values(), candidateBoundaries, extraRects]) {
    for (const rect of rects) {
      maxX = Math.max(maxX, rect.x + rect.width);
      maxY = Math.max(maxY, rect.y + rect.height);
    }
  }
  let width = Math.ceil(maxX + layout.margin);
  let footprint = legendFootprint(architectureLegendEntries, {
    width: Math.max(1, width - layout.margin * 2),
  });
  if (footprint.minWidth > width - layout.margin * 2) {
    width = Math.ceil(footprint.minWidth + layout.margin * 2);
    footprint = legendFootprint(architectureLegendEntries, {
      width: width - layout.margin * 2,
    });
  }
  return [
    width,
    Math.ceil(maxY + layout.margin + layout.legendH + footprint.extraHeight),
  ];
}

function resolvedViewBoxWidth(candidateBoundaries) {
  if (Array.isArray(arch.meta?.viewBox) && Number.isFinite(arch.meta.viewBox[0])) {
    return arch.meta.viewBox[0];
  }
  return autoViewBoxFor(candidateBoundaries, connectionGeometry)[0];
}

function expandBoundaryForReadableTitle(boundary, minimumFontSize) {
  if (!enforcesBoundaryTitleComposition) return boundary;
  const requiredWidth = boundaryLabelWidth(boundary.label, minimumFontSize)
    + layout.boundaryLabelFrameInset * 2;
  const extra = Math.max(0, requiredWidth - boundary.width);
  if (!extra) return boundary;
  return {
    ...boundary,
    x: boundary.x - extra / 2,
    width: boundary.width + extra,
  };
}

function measureBoundaryTitle(boundary, minimumFontSize) {
  const availableWidth = Math.max(0, boundary.width - layout.boundaryLabelFrameInset * 2);
  const units = textUnits(boundary.label);
  const fitted = units > 0
    ? (availableWidth - 10) / (units * 0.6)
    : layout.boundaryLabelFontPreferred;
  const preferredFontSize = Math.max(layout.boundaryLabelFontPreferred, minimumFontSize);
  const fontSize = Math.max(
    minimumFontSize,
    Math.min(preferredFontSize, fitted),
  );
  const desiredWidth = boundaryLabelWidth(boundary.label, fontSize);
  const height = Math.max(layout.boundaryLabelMaskHeight, Math.ceil(fontSize + 7));
  return {
    x: boundary.x + layout.boundaryLabelFrameInset,
    y: boundary.memberTop
      - layout.boundaryLabelClearance
      - height,
    width: Math.min(availableWidth, desiredWidth),
    height,
    fontSize,
    minimumFontSize,
    baselineOffset: fontSize + 4,
    availableWidth,
    minimumWidth: boundaryLabelWidth(boundary.label, minimumFontSize),
  };
}

function horizontalOverlap(left, right) {
  return left.x < right.x + right.width && left.x + left.width > right.x;
}

// A route through a title disappears under its mask and reads as struck-through
// text. Keep the left rail position when it is clear; otherwise slide the title
// along its rail to the nearest clear position inside the frame.
let titleRouteSegments = null;
function slideTitleOffRoutes(boundary, title, placedTitles) {
  if (!enforcesBoundaryTitleComposition) return;
  titleRouteSegments ||= asArray(arch.connections)
    .filter((conn) => components.has(conn.from) && components.has(conn.to))
    .flatMap((conn) => {
      const points = pathFor(conn).points;
      return points.slice(1).map((end, index) => ({ start: points[index], end }));
    });
  const clear = (x) => {
    const rect = { ...title, x };
    return !titleRouteSegments.some((segment) => segmentIntersectsRect(segment, rect, 2))
      && ![...placedTitles, ...components.values(), ...connectionLabels].some((other) => rectsOverlap(rect, other));
  };
  if (clear(title.x)) return;
  const left = boundary.x + layout.boundaryLabelFrameInset;
  const right = boundary.x + boundary.width - layout.boundaryLabelFrameInset - title.width;
  const band = titleRouteSegments.filter(({ start, end }) => (
    Math.max(start[1], end[1]) >= title.y - 2 && Math.min(start[1], end[1]) <= title.y + title.height + 2
  ));
  const labelBlockers = connectionLabels.filter((label) => (
    label.y < title.y + title.height && label.y + label.height > title.y
  ));
  const x = [right, ...band.flatMap(({ start, end }) => [
    Math.max(start[0], end[0]) + 8, Math.min(start[0], end[0]) - 8 - title.width,
  ]), ...labelBlockers.flatMap((label) => [
    label.x + label.width + 8, label.x - 8 - title.width,
  ])].filter((value) => value >= left && value <= right)
    .sort((a, b) => a - b)
    .find(clear);
  if (x !== undefined) title.x = x;
}

function layoutBoundaryTitles(rawBoundaries, minimumFontSize) {
  const placedTitles = [];
  const measured = new Map();
  const ordered = rawBoundaries
    .map((boundary, index) => ({ boundary, index }))
    .sort((left, right) => {
      const areaDelta = left.boundary.width * left.boundary.height
        - right.boundary.width * right.boundary.height;
      return areaDelta || left.index - right.index;
    });

  for (const entry of ordered) {
    const { index } = entry;
    const boundary = expandBoundaryForReadableTitle(entry.boundary, minimumFontSize);
    const title = measureBoundaryTitle(boundary, minimumFontSize);
    let guard = 0;
    while (guard < rawBoundaries.length + components.size + 1) {
      guard += 1;
      const blockers = [
        ...placedTitles,
        ...components.values(),
      ].filter((candidate) => horizontalOverlap(title, candidate) && rectsOverlap(title, candidate));
      if (!blockers.length) break;
      title.y = blockers.reduce(
        (min, blocker) => Math.min(min, blocker.y - layout.boundaryLabelRailGap - title.height),
        Infinity,
      );
    }
    slideTitleOffRoutes(boundary, title, placedTitles);
    placedTitles.push(title);
    measured.set(index, { boundary, title });
  }

  return rawBoundaries.map((_boundary, index) => {
    const { boundary, title } = measured.get(index);
    const bottom = boundary.y + boundary.height;
    // Profile-less schema-v1 inputs keep their legacy boundary geometry. A
    // quality profile opts into the stricter title-composition contract and
    // may expand the frame to contain an adapted title rail.
    const y = enforcesBoundaryTitleComposition
      ? Math.min(boundary.y, title.y - layout.boundaryLabelFrameInset)
      : boundary.y;
    return {
      ...boundary,
      y,
      height: bottom - y,
      title,
    };
  });
}

// ---- Routing state ----------------------------------------------------------
// Initialized before the boundary-title work below: connection label rects are
// part of the derived canvas, so the title convergence must measure the same
// width the diagram actually renders into (a title sized for a narrower canvas
// would fall below the desktop-readability floor once labels grow it). Routing
// reads components, connections and the member-derived boundary frames (so an
// automatic route never borrows a frame border as its corridor), never the
// title-expanded frames or the viewBox.
const rawBoundaries = asArray(arch.boundaries).map(boundaryRect).filter(Boolean);
const routerOptions = {
  distinctAutomaticPorts: true,
  preferReadableRoutes: true,
  fixedPorts,
  namedPortSides,
  // A single outward stub below the scene can remove a crossing without
  // widening the canvas or shrinking its text. Fixed canvases keep their bounds.
  readabilityBottomMargin: arch.meta?.viewBox ? 0 : 24,
  frames: rawBoundaries.map((boundary) => ({
    ...boundary,
    radius: boundary.kind === 'security-group' ? 8 : 12,
  })),
  labelRectFor: (conn, points, { routes, labels }) => (conn.label ? reservedLabelRect({
    label: { relation: conn, label: conn.label, ...connectionLabelBoxAt(conn, labelPoint(conn, points)) },
    points,
    routes: routes.map((route, index) => ({ relationIndex: index, points: route })),
    labels,
    components: [...components.values()],
  }) : null),
};
const { pathFor, connectionSides, connectionEndpointSide } = createRouter(components, arch.connections, routerOptions);
function hasAutomaticRouteGeometry(connection) {
  return !Array.isArray(connection?.via)
    && (!connection?.route || connection.route === 'auto')
    && connection?.channelX === undefined
    && connection?.channelY === undefined;
}
// The auto canvas has to cover these rects; an authored viewBox is never
// resized to fit them — there the containment rule reports the clipping.
let connectionLabels = connectionLabelRects();
// Unlabelled outer corridors are geometry too. Fitting only nodes and labels
// can clip a valid explicit via route while every browser overflow check passes.
const connectionGeometry = [
  ...connectionLabels,
  ...[...components.values()].filter((c) => c.faceplate || c.pictogram)
    .map((c) => ({ ...faceplateCaptionRect(c) })),
  ...asArray(arch.connections)
    .filter((conn) => components.has(conn.from) && components.has(conn.to))
    .flatMap((conn) => pathFor(conn).points.map(([x, y]) => ({ x, y, width: 0, height: 0 }))),
];

function resolveBoundaryTitles() {
  if (!enforcesBoundaryTitleComposition || rawBoundaries.length === 0) {
    return {
      boundaries: layoutBoundaryTitles(rawBoundaries, layout.boundaryLabelFontMinimum),
      readabilityProblem: null,
    };
  }

  const maximumIterations = 32;
  let candidateBoundaries = rawBoundaries;
  for (let iteration = 0; iteration < maximumIterations; iteration += 1) {
    const budgetViewBoxWidth = resolvedViewBoxWidth(candidateBoundaries);
    const minimumFontSize = Math.max(
      layout.boundaryLabelFontMinimum,
      minimumReadableSourceTextPx(budgetViewBoxWidth) + 1e-6,
    );
    const nextBoundaries = layoutBoundaryTitles(rawBoundaries, minimumFontSize);
    const finalViewBoxWidth = resolvedViewBoxWidth(nextBoundaries);
    const finalMinimumFontSize = Math.max(
      layout.boundaryLabelFontMinimum,
      minimumReadableSourceTextPx(finalViewBoxWidth),
    );
    if (minimumFontSize >= finalMinimumFontSize) {
      return { boundaries: nextBoundaries, readabilityProblem: null };
    }
    candidateBoundaries = nextBoundaries;
  }

  const finalViewBoxWidth = resolvedViewBoxWidth(candidateBoundaries);
  return {
    boundaries: candidateBoundaries,
    readabilityProblem: `[composition/desktop-readability] Boundary title layout did not converge after ${maximumIterations} iterations for the final ${finalViewBoxWidth}px viewBox — shorten boundary labels, provide a wider authored viewBox, or move wrapped components closer to the left edge.`,
  };
}

const resolvedBoundaryTitles = resolveBoundaryTitles();
const boundaries = resolvedBoundaryTitles.boundaries;
const compositionFrames = boundaries.map((boundary, index) => ({
  ...boundary,
  id: boundary.id || index,
  kind: boundary.kind || 'boundary',
  radius: boundary.kind === 'security-group' ? 8 : 12,
}));

function componentContext(component) {
  const scopes = boundaries
    .filter((boundary) => asArray(boundary.wraps).includes(component.id))
    .sort((a, b) => (b.width * b.height) - (a.width * a.height))
    .map((boundary) => boundary.label);
  return scopes.length ? scopes.join(' › ') : i18nText(arch.meta.locale, 'node.context.architecture');
}

// ---- Auto viewBox: fit all geometry + the measured resolved legend ----------
// Connection labels are diagram content, so an auto canvas that stopped at the
// component/boundary bbox would clip them; the label rects join the fit here
// and in the title convergence above, which sizes fonts for this same width.
const viewBox = arch.meta?.viewBox || autoViewBoxFor(boundaries, connectionGeometry);
const legendY = () => viewBox[1] - 16;

// Fit titles and canvas from the original geometry first. Fallback labels must
// fit inside that canvas, so moving a label cannot trigger title reflow or a
// canvas/label feedback loop. Keep standard and every authored label control.
if (arch.meta?.quality_profile === 'showcase') {
  connectionLabels = placeAutomaticLabels({
    keepFallbackNearRoute: true,
    labels: connectionLabels,
    routes: asArray(arch.connections).flatMap((conn, relationIndex) => (
      components.has(conn.from) && components.has(conn.to)
        ? [{ relationIndex, points: pathFor(conn).points }] : []
    )),
    components: [...components.values()],
    titles: boundaries.map(boundary => boundary.title),
    viewBox,
    // Leave the resolved legend band available; moving a label must not hide
    // an otherwise visible legend. Existing labels keep their placement.
    placementBottom: architectureLegendEntries.length
      ? legendY() - 32 - legendFootprint(architectureLegendEntries, { width: viewBox[0] - layout.margin * 2 }).extraHeight
      : viewBox[1],
  });
  for (const rect of connectionLabels) resolvedLabelPoints.set(rect.relation, [rect.lx, rect.ly]);
}

// ---- Validation: mechanical correctness, never layout taste -----------------
function componentDiagnosticBox(component) {
  return {
    ...componentBox(component),
    x: component.x,
    y: component.y,
    ...(Array.isArray(component.pos) ? { pos: [...component.pos] } : {}),
  };
}

function validateArchitecture() {
  const problems = [];
  const diagnostics = [];
  if (resolvedBoundaryTitles.readabilityProblem) {
    problems.push(resolvedBoundaryTitles.readabilityProblem);
  }
  const requiresNestedBoundaryMembership = arch.meta?.engineering_profile === 'deployment-ownership';
  if (components.size !== asArray(arch.components).length) problems.push('Component ids must be unique.');
  if (grid) {
    validateGridPlacement(arch, grid, problems);
  } else {
    for (const c of asArray(arch.components)) {
      if (!Array.isArray(c.pos) || c.pos.length !== 2) {
        problems.push(`Component "${c.id}" must include pos [x, y] when layout.mode is omitted (free placement).`);
      }
    }
  }

  for (const c of components.values()) {
    if (!isFinitePoint(c.x, c.y, c.width, c.height)) {
      const message = `Component "${c.id}" has non-finite pos/size — pos and size must be [number, number].`;
      diagnostics.push({
        code: 'architecture/non-finite-component-geometry', severity: 'error', message,
        subject: { diagramType: 'architecture', nodeId: c.id },
        evidence: { pos: c.pos ?? null, size: [c.width, c.height] },
        supportedFixes: [`replace component "${c.id}" pos and size with finite [number, number] values`],
      });
      problems.push(message);
      continue;
    }
    if (c.width <= 0 || c.height <= 0) {
      const message = `Component "${c.id}" has invalid size ${c.width}x${c.height} — width and height must be greater than 0.`;
      diagnostics.push({
        code: 'architecture/invalid-component-size', severity: 'error', message,
        subject: { diagramType: 'architecture', nodeId: c.id },
        evidence: { width: c.width, height: c.height },
        supportedFixes: [`set component "${c.id}" width and height to values greater than 0`],
      });
      problems.push(message);
      continue;
    }
    if (c.x < 0 || c.y < 0 || c.x + c.width > viewBox[0] || c.y + c.height > viewBox[1]) {
      const message = `Component "${c.id}" falls outside the viewBox ${viewBox[0]}x${viewBox[1]} — adjust pos/size or set a larger meta.viewBox.`;
      const overflow = {
        left: Math.max(0, -c.x),
        top: Math.max(0, -c.y),
        right: Math.max(0, c.x + c.width - viewBox[0]),
        bottom: Math.max(0, c.y + c.height - viewBox[1]),
      };
      const widerThanCanvas = overflow.left > 0 && overflow.right > 0;
      const tallerThanCanvas = overflow.top > 0 && overflow.bottom > 0;
      const supportedFixes = [];
      // Move by exactly the overflow: it lands the edge flush (x + (-x) is exact
      // in IEEE 754), while a rounded-up move pushes the opposite edge past a
      // tight canvas and a rounded-down one leaves the overflow in place. When
      // the component is larger than the canvas, the move must shrink it too.
      if (overflow.left > 0) {
        const shrink = Math.max(0, c.width - viewBox[0]);
        supportedFixes.push(shrink > 0
          ? `move component "${c.id}" right by ${overflow.left}px and shrink its width by at least ${shrink}px`
          : `move component "${c.id}" right by ${overflow.left}px`);
      }
      if (overflow.top > 0) {
        const shrink = Math.max(0, c.height - viewBox[1]);
        supportedFixes.push(shrink > 0
          ? `move component "${c.id}" down by ${overflow.top}px and shrink its height by at least ${shrink}px`
          : `move component "${c.id}" down by ${overflow.top}px`);
      }
      if ((overflow.right > 0 && !widerThanCanvas) || (overflow.bottom > 0 && !tallerThanCanvas)) {
        const coveredWidth = overflow.right > 0 && !widerThanCanvas ? Math.ceil(c.x + c.width) : viewBox[0];
        const coveredHeight = overflow.bottom > 0 && !tallerThanCanvas ? Math.ceil(c.y + c.height) : viewBox[1];
        supportedFixes.push(`set meta.viewBox to at least [${Math.max(viewBox[0], coveredWidth)}, ${Math.max(viewBox[1], coveredHeight)}]`);
      }
      diagnostics.push({
        code: 'layout/component-out-of-bounds', severity: 'error', message,
        subject: { diagramType: 'architecture', nodeId: c.id },
        evidence: { bounds: componentDiagnosticBox(c), viewBox: [...viewBox], overflow },
        supportedFixes,
      });
      problems.push(message);
    }
    const estLabelW = textUnits(c.label) * 6.6;
    if (estLabelW > c.width + 8) {
      const message = `Label "${c.label}" (~${Math.round(estLabelW)}px) is wider than component "${c.id}" (${c.width}px) — shorten the label or widen size.`;
      diagnostics.push({
        code: 'architecture/component-label-overflow', severity: 'error', message,
        subject: { diagramType: 'architecture', nodeId: c.id },
        evidence: { text: c.label, estimatedWidthPx: Math.round(estLabelW), availableWidthPx: c.width },
        supportedFixes: [
          `shorten component "${c.id}" label "${c.label}" while preserving its meaning`,
          `or widen component "${c.id}" to at least ${Math.ceil(estLabelW - 8)}px`,
        ],
      });
      problems.push(message);
    }
    const brandRailProblem = brandTopRailProblem(c, c.width, 8, 'Component');
    if (brandRailProblem) problems.push(brandRailProblem);
    // sublabel and tag render as single unwrapped <text> elements; shrink-to-fit
    // handles the ordinary case, this rejects what it cannot rescue.
    const availableTextW = availableNodeTextWidth(c.width);
    for (const [field, value, minimum] of [
      ['Sublabel', c.sublabel, componentTextFit.sublabelMinimum],
      ['Tag', c.tag, componentTextFit.tagMinimum],
    ]) {
      if (!value) continue;
      const minimumW = minimumNodeTextWidth(value, minimum);
      if (minimumW > availableTextW) {
        const fieldKey = field.toLowerCase();
        const message = `${field} "${value}" needs ~${Math.ceil(minimumW)}px at the ${minimum}px legible minimum, but component "${c.id}" provides ${availableTextW}px — shorten the ${fieldKey} or widen size.`;
        diagnostics.push({
          code: `architecture/component-${fieldKey}-overflow`, severity: 'error', message,
          subject: { diagramType: 'architecture', nodeId: c.id },
          evidence: { text: value, minimumFontPx: minimum, requiredWidthPx: Math.ceil(minimumW), availableWidthPx: availableTextW },
          supportedFixes: [
            `shorten component "${c.id}" ${fieldKey} "${value}" while preserving its meaning`,
            `or widen component "${c.id}" so the ${fieldKey} keeps at least ${Math.ceil(minimumW)}px of text width at the ${minimum}px legible minimum`,
          ],
        });
        problems.push(message);
      }
    }
  }

  // Faceplate structure: the image is the node, so nothing may overdraw it and
  // the box must keep the panel's ratio.
  for (const c of components.values()) {
    if (!c.faceplate) continue;
    const forbidden = ['sublabel', 'tag', 'icon', 'brand']
      .filter((field) => c[field] !== undefined && c[field] !== '')
      .concat(Array.isArray(c.ports) && c.ports.length ? ['ports'] : [])
      .concat(grid ? ['layout.mode: grid'] : []);
    if (forbidden.length) {
      const message = `Component "${c.id}" is a faceplate, so ${forbidden.join(', ')} cannot be drawn on it.`;
      diagnostics.push({
        code: 'architecture/faceplate-layout-conflict', severity: 'error', message,
        subject: { diagramType: 'architecture', nodeId: c.id },
        evidence: { forbidden },
        supportedFixes: [
          `remove ${forbidden.join(', ')} from component "${c.id}"`,
          'or use a plain card instead of a faceplate',
        ],
      });
      problems.push(message);
    }
    const requiredHeightPx = Math.round(c.width * (c.faceplate.height / c.faceplate.width));
    if (Math.abs(c.height - requiredHeightPx) > 0.5) {
      const message = `Component "${c.id}" is ${c.width}x${c.height} but its faceplate ratio needs height ${requiredHeightPx}.`;
      diagnostics.push({
        code: 'architecture/faceplate-aspect', severity: 'error', message,
        subject: { diagramType: 'architecture', nodeId: c.id },
        evidence: { width: c.width, height: c.height, requiredHeightPx },
        supportedFixes: [`set component "${c.id}" height to ${requiredHeightPx}`],
      });
      problems.push(message);
    }
    const sourceWidth = c.faceplate.width;
    const renderedScale = sourceWidth ? c.width / sourceWidth : 1;
    // A portless faceplate is a product photo, not a connector panel: there is
    // no silkscreen to keep legible, so it may be drawn small.
    const faceplatePorts = asArray(c.faceplate.ports).length;
    if ((process.env.ARCHIFY_QUALITY_PROFILE || arch.meta?.quality_profile) === 'showcase'
      && faceplatePorts > 0
      && sourceWidth >= FACEPLATE_PHOTO_MIN_SOURCE_PX
      && renderedScale < FACEPLATE_MIN_RENDERED_SCALE) {
      const minWidth = Math.ceil(sourceWidth * FACEPLATE_MIN_RENDERED_SCALE);
      const message = `Faceplate "${c.id}" draws its ${sourceWidth}px panel at ${Math.round(renderedScale * 100)}% (${Math.round(c.width)}px), which makes the printed silkscreen unreadable; widen it to at least ${minWidth}px.`;
      diagnostics.push({
        code: 'architecture/faceplate-too-small', severity: 'error', message,
        subject: { diagramType: 'architecture', nodeId: c.id },
        evidence: { width: Math.round(c.width), sourceWidth, renderedScale: Math.round(renderedScale * 1000) / 1000, minWidth },
        supportedFixes: [
          `widen component "${c.id}" to at least ${minWidth}px`,
          '620–700px keeps a photographed panel legible without letting it dominate the diagram',
        ],
      });
      problems.push(message);
    }
    const exhausted = faceplateModels.get(c.id)?.exhaustedExits || [];
    if (exhausted.length) {
      const message = `Faceplate "${c.id}" has no free exit point left on the edge for ${exhausted.join(', ')} — two cables would share one point.`;
      diagnostics.push({
        code: 'architecture/faceplate-port-duplicate', severity: 'error', message,
        subject: { diagramType: 'architecture', nodeId: c.id, portId: exhausted[0] },
        evidence: { ports: exhausted },
        supportedFixes: [
          'spread the holes along the edge',
          'or give an explicit side to holes that should leave elsewhere',
        ],
      });
      problems.push(message);
    }
    const caption = faceplateCaptionRect(c);
    // Cables may pass behind the caption; its mask keeps the name readable.
    // Only an authored canvas that clips the caption is an error.
    if (arch.meta?.viewBox && caption.y + caption.height > viewBox[1]) {
      const message = `The faceplate caption of "${c.id}" falls outside the authored viewBox.`;
      diagnostics.push({
        code: 'architecture/faceplate-caption-outside', severity: 'error', message,
        subject: { diagramType: 'architecture', nodeId: c.id },
        evidence: { captionBottom: caption.y + caption.height, viewBoxHeight: viewBox[1] },
        supportedFixes: [`raise meta.viewBox height to at least ${Math.ceil(caption.y + caption.height)}`],
      });
      problems.push(message);
    }
    const seenPoints = new Map();
    for (const [portId, port] of faceplateModels.get(c.id)?.ports || new Map()) {
      const key = `${Math.round(port.jack[0] * 10) / 10}:${Math.round(port.jack[1] * 10) / 10}`;
      const first = seenPoints.get(key);
      if (first) {
        const message = `Faceplate ports "${first}" and "${portId}" on "${c.id}" sit at the same jack position.`;
        diagnostics.push({
          code: 'architecture/faceplate-port-duplicate', severity: 'error', message,
          subject: { diagramType: 'architecture', nodeId: c.id, portId },
          evidence: { firstPortId: first, side: port.side, jack: port.jack.map((value) => Math.round(value * 10) / 10) },
          supportedFixes: [
            'move one of the two holes in the inventory',
            'or remove the duplicate jack',
          ],
        });
        problems.push(message);
      } else {
        seenPoints.set(key, portId);
      }
    }
  }

  // Pictogram nodes: the art is the node, so the same overdraw rules apply.
  for (const c of components.values()) {
    if (!c.pictogram) continue;
    if (c.faceplate) {
      const message = `Component "${c.id}" declares both a pictogram and a faceplate; a node has one body.`;
      diagnostics.push({
        code: 'architecture/pictogram-faceplate-conflict', severity: 'error', message,
        subject: { diagramType: 'architecture', nodeId: c.id },
        evidence: { pictogram: c.pictogram },
        supportedFixes: [`remove ${c.faceplate ? 'faceplate' : 'pictogram'} from component "${c.id}"`],
      });
      problems.push(message);
      continue;
    }
    const forbidden = ['sublabel', 'tag', 'icon', 'brand']
      .filter((field) => c[field] !== undefined && c[field] !== '')
      .concat(Array.isArray(c.ports) && c.ports.length ? ['ports'] : []);
    if (forbidden.length) {
      const message = `Component "${c.id}" is a pictogram, so ${forbidden.join(', ')} cannot be drawn on it.`;
      diagnostics.push({
        code: 'architecture/pictogram-layout-conflict', severity: 'error', message,
        subject: { diagramType: 'architecture', nodeId: c.id },
        evidence: { forbidden },
        supportedFixes: [
          `remove ${forbidden.join(', ')} from component "${c.id}"`,
          'or use a plain card instead of a pictogram',
        ],
      });
      problems.push(message);
    }
    const caption = faceplateCaptionRect(c);
    if (arch.meta?.viewBox && caption.y + caption.height > viewBox[1]) {
      const message = `The caption of pictogram "${c.id}" falls outside the authored viewBox.`;
      diagnostics.push({
        code: 'architecture/pictogram-caption-outside', severity: 'error', message,
        subject: { diagramType: 'architecture', nodeId: c.id },
        evidence: { captionBottom: caption.y + caption.height, viewBoxHeight: viewBox[1] },
        supportedFixes: [`raise meta.viewBox height to at least ${Math.ceil(caption.y + caption.height)}`],
      });
      problems.push(message);
    }
  }

  // Named connector ports — structural truth, not layout taste.
  const portUse = new Map();
  for (const c of components.values()) {
    const seen = new Set();
    for (const port of componentPorts(c)) {
      if (seen.has(port.id)) {
        const message = `Component "${c.id}" declares port "${port.id}" more than once — every port id must be unique on its component.`;
        diagnostics.push({
          code: 'architecture/duplicate-port-id', severity: 'error', message,
          subject: { diagramType: 'architecture', nodeId: c.id, portId: port.id },
          evidence: { portId: port.id },
          supportedFixes: [`rename one of the "${port.id}" ports on component "${c.id}"`],
        });
        problems.push(message);
      }
      seen.add(port.id);
    }
    for (const capacity of portCapacity(c)) {
      if (capacity.ok) continue;
      const message = `Component "${c.id}" needs ${capacity.requiredPx}px for ${capacity.count} ${capacity.side} ports, but its card is ${capacity.availablePx}px tall — jacks sit at least 14px apart.`;
      diagnostics.push({
        code: 'architecture/port-capacity', severity: 'error', message,
        subject: { diagramType: 'architecture', nodeId: c.id, side: capacity.side },
        evidence: {
          count: capacity.count,
          requiredPx: capacity.requiredPx,
          availablePx: capacity.availablePx,
        },
        supportedFixes: [
          `increase component "${c.id}" height to at least ${capacity.requiredPx}px`,
          `move some ${capacity.side} ports to the other side of "${c.id}"`,
          `remove ports that are not needed`,
        ],
      });
      problems.push(message);
    }
    const crowding = portRailCrowding(c);
    if (crowding) {
      const message = `Port labels on component "${c.id}" need ${crowding.requiredWidthPx}px of card width, but it is ${crowding.availableWidthPx}px wide — the rails leave no room for "${c.label}".`;
      diagnostics.push({
        code: 'architecture/port-rail-crowded', severity: 'error', message,
        subject: { diagramType: 'architecture', nodeId: c.id },
        evidence: {
          requiredWidthPx: crowding.requiredWidthPx,
          availableWidthPx: crowding.availableWidthPx,
          leftRailPx: portRails(c).left,
          rightRailPx: portRails(c).right,
        },
        supportedFixes: [
          `widen component "${c.id}" to at least ${crowding.requiredWidthPx}px`,
          `shorten its port labels`,
        ],
      });
      problems.push(message);
    }
  }
  for (const conn of asArray(arch.connections)) {
    // An unknown endpoint is reported by the existing endpoint gate; the port
    // checks need both boxes to resolve a side.
    if (!components.has(conn.from) || !components.has(conn.to)) continue;
    const connectionId = conn.id || `${conn.from}->${conn.to}`;
    for (const [endpoint, componentId, portId, authoredSide] of [
      ['source', conn.from, conn.fromPort, conn.fromSide],
      ['target', conn.to, conn.toPort, conn.toSide],
    ]) {
      const component = components.get(componentId);
      if (!component) continue;
      const namedPorts = componentPorts(component);
      const platePorts = (component.faceplate?.ports || []).map((port) => ({
        ...port,
        side: faceplateSideFor(port, component, [(conn.from === componentId
          ? components.get(conn.to)
          : components.get(conn.from))].filter(Boolean).map((other) => [
          other.x + other.width / 2, other.y + other.height / 2,
        ])),
      }));
      // Holes answer unknown-port and one-cable-per-hole; only named ports own
      // a side, so a faceplate never triggers side exclusivity.
      const ports = [...namedPorts, ...platePorts];
      if (!portId) {
        const side = connectionEndpointSide(conn, endpoint);
        if (!namedPorts.some((port) => port.side === side)) continue;
        const message = `Connection "${connectionId}" enters the ${side} side of "${componentId}", which carries named ports — declare a port or use another side.`;
        diagnostics.push({
          code: 'architecture/port-side-exclusive', severity: 'error', message,
          subject: { diagramType: 'architecture', nodeId: componentId, side, connectionId },
          evidence: { declaredPorts: namedPorts.filter((port) => port.side === side).map((port) => port.id) },
          supportedFixes: [
            `declared a ${side} port on connection "${connectionId}"`,
            `set ${endpoint === 'source' ? 'fromSide' : 'toSide'} to a side without ports`,
            `move connection "${connectionId}" to another side of "${componentId}"`,
          ],
        });
        problems.push(message);
        continue;
      }
      const port = ports.find((candidate) => candidate.id === portId);
      if (!port) {
        const message = `Connection "${connectionId}" names port "${portId}" on component "${componentId}", which does not declare it.`;
        diagnostics.push({
          code: 'architecture/unknown-port', severity: 'error', message,
          subject: { diagramType: 'architecture', nodeId: componentId, portId, connectionId },
          evidence: {
            endpoint,
            availablePorts: ports.map((candidate) => candidate.id),
          },
          supportedFixes: [
            `use one of: ${ports.map((candidate) => candidate.id).join(', ') || '(none declared)'}`,
            `declare port "${portId}" on component "${componentId}"`,
          ],
        });
        problems.push(message);
        continue;
      }
      if (authoredSide && authoredSide !== 'auto' && authoredSide !== port.side) {
        const message = `Connection "${connectionId}" sets ${endpoint === 'source' ? 'fromSide' : 'toSide'} "${authoredSide}" while port "${portId}" sits on the ${port.side} side.`;
        diagnostics.push({
          code: 'architecture/port-side-conflict', severity: 'error', message,
          subject: { diagramType: 'architecture', nodeId: componentId, portId, connectionId },
          evidence: { authoredSide, portSide: port.side },
          supportedFixes: [
            `remove ${endpoint === 'source' ? 'fromSide' : 'toSide'} from connection "${connectionId}"`,
            `move port "${portId}" to the ${authoredSide} side`,
          ],
        });
        problems.push(message);
        continue;
      }
      const key = `${componentId}\u0000${portId}`;
      const first = portUse.get(key);
      if (first && first !== connectionId) {
        const message = `Port "${portId}" on "${componentId}" already carries connection "${first}" — a jack takes one cable.`;
        diagnostics.push({
          code: 'architecture/port-duplicate-use', severity: 'error', message,
          subject: { diagramType: 'architecture', nodeId: componentId, portId, connectionId },
          evidence: { firstConnectionId: first },
          supportedFixes: [
            `move "${connectionId}" to another port on "${componentId}"`,
            `remove the duplicate connection`,
          ],
        });
        problems.push(message);
      } else {
        portUse.set(key, connectionId);
      }
    }
  }

  // Component overlap — the highest-traffic hand-placement failure mode.
  const list = [...components.values()];
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      if (rectsOverlap(list[i], list[j], 8)) {
        const separation = componentSeparationOptions(list[i], list[j], 8);
        const message = `Components "${list[i].id}" and "${list[j].id}" are less than 8px apart — move one or shrink its size.\n${suggestComponentSeparation(list[i], list[j], 8)}`;
        diagnostics.push({
          code: 'layout/component-overlap', severity: 'error', message,
          subject: { diagramType: 'architecture', nodeId: list[i].id },
          evidence: { otherId: list[j].id, minimumGapPx: 8, boxes: [componentDiagnosticBox(list[i]), componentDiagnosticBox(list[j])] },
          supportedFixes: [
            `move component "${list[j].id}" pos to [${separation[0].pos[0]}, ${separation[0].pos[1]}] (${separation[0].relation})`,
            `or move component "${list[j].id}" pos to [${separation[1].pos[0]}, ${separation[1].pos[1]}] (${separation[1].relation})`,
            `or shrink "${list[i].id}" or "${list[j].id}" while keeping every label and sublabel readable`,
          ],
        });
        problems.push(message);
      }
    }
  }

  // Boundaries: every wrapped id must exist; the computed box must stay in view.
  for (const boundary of asArray(arch.boundaries)) {
    for (const id of asArray(boundary.wraps)) {
      if (!components.has(id)) problems.push(`Boundary "${boundary.label}" wraps unknown component "${id}".`);
    }
  }
  const viewBoxRect = { x: 0, y: 0, width: viewBox[0], height: viewBox[1] };
  for (const boundary of boundaries) {
    if (!enforcesBoundaryTitleComposition) continue;
    if (boundary.title.minimumWidth > boundary.title.availableWidth) {
      problems.push(
        `Boundary label "${boundary.label}" needs ~${Math.ceil(boundary.title.minimumWidth)}px to fit at the `
        + `${Number(boundary.title.minimumFontSize.toFixed(2))}px desktop-readable source minimum, but its frame provides ${Math.floor(boundary.title.availableWidth)}px — `
        + 'shorten the boundary label, increase pad, or widen the wrapped component layout.',
      );
    }
    if (!rectContains(boundary, boundary.title)) {
      problems.push(
        `Boundary label "${boundary.label}" extends outside its final frame — shorten the label or increase boundary pad.`,
      );
    }
    if (!rectContains(viewBoxRect, boundary.title)) {
      problems.push(
        `Boundary label "${boundary.label}" extends outside the viewBox — move wrapped components away from the canvas edge, shorten the label, or increase the viewBox.`,
      );
    }
    for (const component of components.values()) {
      if (!rectsOverlap(boundary.title, component)) continue;
      problems.push(
        `Boundary label "${boundary.label}" overlaps component "${component.id}" — move the component, increase boundary title space, or shorten the label.`,
      );
    }
  }
  for (let leftIndex = 0; leftIndex < boundaries.length; leftIndex += 1) {
    const left = boundaries[leftIndex];
    const leftMembers = new Set(asArray(left.wraps));
    for (let rightIndex = leftIndex + 1; rightIndex < boundaries.length; rightIndex += 1) {
      const right = boundaries[rightIndex];
      if (enforcesBoundaryTitleComposition && rectsOverlap(left.title, right.title)) {
        problems.push(
          `Boundary labels "${left.label}" and "${right.label}" overlap — shorten a label or increase boundary title space.`,
        );
      }
      // Ordinary architecture boundaries are sets, not an implied ownership
      // tree: orthogonal scopes such as runtime and compliance may share some
      // components while each contains others. The opt-in deployment profile
      // does promise hierarchical region/private-scope membership, so only it
      // receives the stricter membership-to-frame containment contract.
      if (!requiresNestedBoundaryMembership) continue;
      const rightMembers = new Set(asArray(right.wraps));
      const shared = [...leftMembers].filter((id) => rightMembers.has(id));
      const leftNested = [...leftMembers].every((id) => rightMembers.has(id));
      const rightNested = [...rightMembers].every((id) => leftMembers.has(id));
      if (shared.length && !leftNested && !rightNested) {
        const leftOnly = [...leftMembers].filter((id) => !rightMembers.has(id));
        const rightOnly = [...rightMembers].filter((id) => !leftMembers.has(id));
        problems.push(
          `Boundary "${left.label}" crosses boundary "${right.label}" because their memberships partially overlap `
          + `(shared: ${shared.map((id) => `"${id}"`).join(', ')}; `
          + `only in "${left.label}": ${leftOnly.map((id) => `"${id}"`).join(', ')}; `
          + `only in "${right.label}": ${rightOnly.map((id) => `"${id}"`).join(', ')}) — `
          + 'keep one boundary fully nested by removing outside members, or split the boundary.',
        );
        continue;
      }

      if (!rectsOverlap(left, right)) continue;
      const leftContainsRight = rectContains(left, right);
      const rightContainsLeft = rectContains(right, left);
      if (!leftContainsRight && !rightContainsLeft) {
        problems.push(
          `Boundary "${left.label}" and boundary "${right.label}" final frames partially overlap — `
          + 'adjust wraps, pad, or component positions so the frames are disjoint or one fully contains the other.',
        );
        continue;
      }

      if (!shared.length) {
        problems.push(
          `Boundary "${left.label}" and boundary "${right.label}" final frames overlap even though their memberships are disjoint — `
          + 'adjust pad or component positions so the frames are disjoint, or make wraps express the intended nesting.',
        );
        continue;
      }

      const containmentMatchesMembership = (leftNested && rightContainsLeft)
        || (rightNested && leftContainsRight);
      if (!containmentMatchesMembership) {
        problems.push(
          `Boundary "${left.label}" and boundary "${right.label}" final frame containment contradicts their wraps membership — `
          + 'reduce the inner boundary pad, move its components, or correct wraps so geometry and nesting agree.',
        );
      }
    }
  }
  for (const b of boundaries) {
    if (b.x < 0 || b.y < 0 || b.x + b.width > viewBox[0] || b.y + b.height > viewBox[1]) {
      const overflow = {
        left: Math.max(0, -b.x),
        top: Math.max(0, -b.y),
        right: Math.max(0, b.x + b.width - viewBox[0]),
        bottom: Math.max(0, b.y + b.height - viewBox[1]),
      };
      const sides = Object.entries(overflow).filter(([, pixels]) => pixels > 0)
        .map(([side, pixels]) => `${side} by ${Math.ceil(pixels)}px`).join(', ');
      const supportedFixes = [];
      if (overflow.left || overflow.top) {
        supportedFixes.push(`move the wrapped components right by at least ${Math.ceil(overflow.left)}px and down by at least ${Math.ceil(overflow.top)}px, then revalidate connected routes and the opposite canvas sides; enlarging meta.viewBox cannot fix left/top overflow`);
      }
      if (overflow.right || overflow.bottom) {
        supportedFixes.push(`increase meta.viewBox to at least [${Math.ceil(Math.max(viewBox[0], b.x + b.width))}, ${Math.ceil(Math.max(viewBox[1], b.y + b.height))}] for right/bottom overflow, or move the wrapped components inward; revalidate desktop readability`);
      }
      const message = `Boundary "${b.label}" extends outside the viewBox (${sides}) — preserve wraps membership and repair the measured canvas side.`;
      diagnostics.push({
        code: 'layout/boundary-out-of-bounds',
        severity: 'error',
        message,
        subject: { diagramType: 'architecture', boundary: { kind: b.kind, label: b.label, wraps: b.wraps } },
        evidence: {
          bounds: { x: b.x, y: b.y, width: b.width, height: b.height },
          viewBox: [...viewBox],
          overflow,
          members: asArray(b.wraps).map((id) => components.get(id)).filter(Boolean).map(componentBox),
        },
        supportedFixes,
      });
      problems.push(message);
    }
  }

  // A boundary frame is drawn as the padded box around its members, so a
  // component that is not in `wraps` but sits wholly inside that box reads as
  // a member. Report it instead of letting the picture claim false ownership.
  // A box the frame border visibly cuts through does not claim membership,
  // and earlier valid inputs depend on that, so only full enclosure fails.
  // This new composition gate applies to showcase; standard keeps its existing
  // acceptance contract while authors can opt into the stricter check.
  if (arch.meta?.quality_profile === 'showcase') {
    for (const b of boundaries) {
      const members = new Set(asArray(b.wraps));
      for (const component of components.values()) {
        if (members.has(component.id) || !rectContains(b, component)) continue;
        const message = `Component "${component.id}" is not wrapped by boundary "${b.label}" but sits inside its frame — `
          + 'move it outside the frame, place the wrapped members in one compact axis-aligned cluster (no empty bay for a non-member), or add it to wraps only when it truly belongs there.';
        problems.push(message);
        diagnostics.push({
          code: 'layout/boundary-encloses-non-member',
          severity: 'error',
          message,
          subject: { diagramType: 'architecture', boundary: { kind: b.kind, label: b.label, wraps: b.wraps }, component: component.id },
          evidence: {
            bounds: { x: b.x, y: b.y, width: b.width, height: b.height },
            component: componentBox(component),
          },
          supportedFixes: [
            `move "${component.id}" outside the boundary frame`,
            'reposition the wrapped members into one compact axis-aligned cluster (no empty bay) that leaves non-members outside',
          ],
        });
      }
    }
  }

  const connectionList = asArray(arch.connections);
  const knownComponentIds = [...components.keys()].sort();
  for (const conn of connectionList) {
    const connIndex = connectionList.indexOf(conn);
    for (const [field, endpoint] of [['from', 'source'], ['to', 'target']]) {
      if (components.has(conn[field])) continue;
      const message = `Connection "${conn.label || conn[field]}" references unknown ${endpoint} "${conn[field]}".`;
      const otherId = conn[field === 'from' ? 'to' : 'from'];
      const neighbors = new Set();
      for (const edge of connectionList) {
        if (edge === conn) continue;
        if (edge.from === otherId) neighbors.add(edge.to);
        if (edge.to === otherId) neighbors.add(edge.from);
      }
      const candidates = knownComponentIds
        .filter((id) => id !== otherId)
        .sort((a, b) => (neighbors.has(b) - neighbors.has(a)) || a.localeCompare(b));
      diagnostics.push({
        code: 'architecture/unknown-endpoint', severity: 'error', message,
        subject: {
          diagramType: 'architecture',
          connection: conn.id ?? null,
          path: `/connections/${connIndex}/${field}`,
          from: conn.from,
          to: conn.to,
        },
        evidence: { endpoint, unknownNodeId: conn[field], availableNodeIds: knownComponentIds },
        supportedFixes: candidates.slice(0, 3).map((id) => `set /connections/${connIndex}/${field} to verified node id "${id}"`),
      });
      problems.push(message);
      problems.push(`Connection "${conn.label || conn[field]}" endpoint "${conn[field]}" does not name a declared component.`);
    }
    if (components.has(conn.from) && components.has(conn.to)) {
      const routed = pathFor(conn);
      const outsidePoints = routed.points.filter(([x, y]) => x < 0 || y < 0 || x > viewBox[0] || y > viewBox[1]);
      if (arch.meta?.quality_profile === 'showcase' && outsidePoints.length) {
        const message = `Connection "${conn.id || `${conn.from}->${conn.to}`}" extends outside the viewBox — move the measured outside route points inward or enlarge an authored viewBox for right/bottom overflow.`;
        diagnostics.push({
          code: 'layout/route-out-of-bounds', severity: 'error', message,
          subject: { diagramType: 'architecture', collection: 'connections', index: asArray(arch.connections).indexOf(conn), ...(conn.id ? { id: conn.id } : {}), from: conn.from, to: conn.to },
          evidence: { viewBox: [...viewBox], outsidePoints, points: routed.points },
          supportedFixes: ['move negative route coordinates inside the canvas; for right/bottom overflow, enlarge meta.viewBox or reroute inward; preserve endpoints, direction and labels, then revalidate'],
        });
        problems.push(message);
      }
      const [start, end] = [routed.points[0], routed.points[routed.points.length - 1]];
      // The stub from the panel edge into the jack is drawn at the port's own
      // exit point. If the cable stops anywhere else, the artifact shows a
      // cable diving under the panel plus a detached arrow at the jack.
      for (const [endpoint, componentId, portId] of [
        ['source', conn.from, conn.fromPort],
        ['target', conn.to, conn.toPort],
      ]) {
        const port = portId ? faceplateModels.get(componentId)?.ports.get(portId) : null;
        if (!port) continue;
        const tip = endpoint === 'source' ? start : end;
        const gap = Math.hypot(tip[0] - port.point[0], tip[1] - port.point[1]);
        if (gap <= 2) continue;
        const message = `Connection "${conn.id || `${conn.from}->${conn.to}`}" stops ${Math.round(gap)}px away from the "${portId}" exit on "${componentId}" — the stub is drawn at the jack, so the cable appears to dive under the panel and the arrow sits detached.`;
        diagnostics.push({
          code: 'architecture/cable-stub-gap', severity: 'error', message,
          subject: {
            diagramType: 'architecture', collection: 'connections',
            index: asArray(arch.connections).indexOf(conn), ...(conn.id ? { id: conn.id } : {}),
            nodeId: componentId, portId,
          },
          evidence: { endpoint, gap: Math.round(gap), cableEnd: tip, portExit: port.point, side: port.side },
          supportedFixes: [
            `let the router approach the "${portId}" exit: drop the harmful via points on this connection`,
            'or pin fromSide/toSide so the cable reaches the jack from its own edge',
          ],
        });
        problems.push(message);
      }
      const distance = Math.hypot(end[0] - start[0], end[1] - start[1]);
      if (distance < 24 && conn.from === conn.to) {
        // "Move the components apart" cannot be executed for a self-loop; the
        // ports sit on one component and the sides decide how far apart.
        const message = `Self-loop "${conn.id || conn.label || conn.from}" on component "${conn.from}" has its two ports only ${Math.round(distance)}px apart (minimum 24px) — remove fromSide/toSide so the renderer can choose the loop's sides, or set fromSide and toSide to different sides.`;
        diagnostics.push({
          code: 'layout/self-loop-ports', severity: 'error', message,
          subject: { diagramType: 'architecture', collection: 'connections', index: asArray(arch.connections).indexOf(conn), ...(conn.id ? { id: conn.id } : {}), from: conn.from, to: conn.to },
          evidence: { distancePx: Math.round(distance), minimumPx: 24, fromSide: connectionEndpointSide(conn, 'source'), toSide: connectionEndpointSide(conn, 'target'), points: routed.points },
          supportedFixes: ['remove fromSide/toSide from the self-loop', 'set fromSide and toSide to different sides of the component'],
        });
        problems.push(message);
      } else if (distance < 24) {
        problems.push(`Connection "${conn.label || `${conn.from}->${conn.to}`}" is too short (${Math.round(distance)}px; minimum 24px) — place its components farther apart.`);
      }
    }
  }

  // A connection whose authored side contradicts its named port is reported as
  // architecture/port-side-conflict; the side-direction check would repeat it.
  const portSideConflict = (relation) => [
    [relation.from, relation.fromPort, relation.fromSide],
    [relation.to, relation.toPort, relation.toSide],
  ].some(([componentId, portId, side]) => {
    if (!portId || !side || side === 'auto') return false;
    const port = componentPorts(components.get(componentId)).find((candidate) => candidate.id === portId);
    return Boolean(port && port.side !== side);
  });

  problems.push(...cleanEndpointSideProblems({
    relations: arch.connections,
    shouldCheckRelation: (relation) => !portSideConflict(relation),
    endpointIds: new Set(components.keys()),
    pathFor,
    diagramType: 'architecture',
    relationCollection: 'connections',
    fromSideFor: (conn) => connectionEndpointSide(conn, 'source'),
    toSideFor: (conn) => connectionEndpointSide(conn, 'target'),
    routeHint: 'keep automatic routing so the renderer can use a side-aware bridge, or set truthful fromSide/toSide with perpendicular via segments',
  }));
  problems.push(...cleanFlowProblems({
    relations: arch.connections,
    obstacles: components.values(),
    pathFor,
    diagramType: 'architecture',
    relationCollection: 'connections',
    obstacleKind: 'component',
    routeHint: 'adjust fromSide/toSide, set route/via, or move the component'
  }));
  problems.push(...cleanCrossingProblems({
    relations: arch.connections,
    endpointIds: new Set(components.keys()),
    pathFor,
    diagramType: 'architecture',
    relationCollection: 'connections',
    profile: arch.meta?.quality_profile,
    // Automatic architecture routes render with an opaque crossover halo.
    // That makes a proper X visually unambiguous while explicit authored
    // crossings remain a blocking composition error.
    crossingResolved: (left, right) => (
      hasAutomaticRouteGeometry(left) && hasAutomaticRouteGeometry(right)
    ),
    routeHint: 'adjust route/via or fromSide/toSide so the connections use separate corridors'
  }));
  problems.push(...cleanAmbiguousCorridorProblems({
    relations: arch.connections,
    endpointIds: new Set(components.keys()),
    pathFor,
    diagramType: 'architecture',
    relationCollection: 'connections',
    profile: arch.meta?.quality_profile,
    includeSharedEndpoints: (left, right) => hasAutomaticRouteGeometry(left) && !left.labelAt
      && hasAutomaticRouteGeometry(right) && !right.labelAt,
    routeHint: 'adjust route/via or fromSide/toSide so distinct connections do not visually merge'
  }));
  if ((process.env.ARCHIFY_QUALITY_PROFILE || arch.meta?.quality_profile) === 'showcase') {
    const collisions = collectArrowheadCollisions({
      routedRelations: asArray(arch.connections)
        .filter((conn) => components.has(conn.from) && components.has(conn.to) && hasAutomaticRouteGeometry(conn) && !conn.labelAt)
        .map((relation) => ({ relation, points: pathFor(relation).points })),
    });
    for (const hit of collisions) {
      const left = hit.left.relation;
      const right = hit.right.relation;
      const message = `[composition/arrowhead-collision] automatic connections "${left.id || left.from}" and "${right.id || right.from}" into "${left.to}" have arrowheads ${hit.distance}px apart (minimum ${hit.minimum}px) — enlarge or reposition the destination, or choose separate toSide ports.`;
      problems.push(message);
      diagnostics.push({
        code: 'composition/arrowhead-collision', severity: 'error', message,
        subject: { diagramType: 'architecture', collection: 'connections', id: left.id, from: left.from, to: left.to },
        evidence: { otherId: right.id, distancePx: hit.distance, minimumPx: hit.minimum, endpoints: [hit.left.tip, hit.right.tip] },
        supportedFixes: ['enlarge or reposition the destination', 'choose separate toSide ports'],
      });
    }
  }
  problems.push(...cleanBorderRunProblems({
    relations: arch.connections,
    endpointIds: new Set(components.keys()),
    frames: compositionFrames,
    pathFor,
    diagramType: 'architecture',
    relationCollection: 'connections',
    profile: arch.meta?.quality_profile,
    routeHint: 'adjust route/via or fromSide/toSide so the connection crosses the boundary perpendicularly instead of following its border'
  }));
  problems.push(...cleanRouteRhythmProblems({
    relations: arch.connections,
    endpointIds: new Set(components.keys()),
    pathFor,
    diagramType: 'architecture',
    relationCollection: 'connections',
    profile: arch.meta?.quality_profile,
    routeHint: 'move route/via points into a wider corridor or move the component so every turn has room to read'
  }));
  problems.push(...cleanRouteDetourProblems({
    relations: arch.connections,
    obstacles: components.values(),
    contentRects: [...components.values(), ...boundaries],
    endpointIds: new Set(components.keys()),
    pathFor,
    fromSideFor: (conn) => connectionEndpointSide(conn, 'source'),
    toSideFor: (conn) => connectionEndpointSide(conn, 'target'),
    diagramType: 'architecture',
    relationCollection: 'connections',
    profile: arch.meta?.quality_profile,
  }));
  // Connection labels must not land on top of components.
  const labelRects = connectionLabels;
  for (const rect of labelRects) {
    const blockedComponents = [...components.values()].filter(c => rectsOverlap(rect, c, -2));
    const labelPinned = ['labelAt', 'labelDx', 'labelDy', 'labelSegment'].some(key => rect.relation[key] !== undefined);
    const points = pathFor(rect.relation).points;
    const shortHorizontalGap = points.length === 2 && Math.abs(points[0][1] - points[1][1]) < 0.0001
      ? Math.abs(points[1][0] - points[0][0]) : null;
    const requiredGap = Math.ceil(rect.width + 16);
    if (arch.meta?.quality_profile === 'showcase' && !labelPinned && blockedComponents.length
        && shortHorizontalGap != null && shortHorizontalGap < requiredGap) {
      const message = `Label "${rect.label}" has only ${Math.round(shortHorizontalGap)}px between "${rect.relation.from}" and "${rect.relation.to}"; it needs at least ${requiredGap}px to stay beside its route — increase that clear gap or place the connected nodes on another readable row, preserving the label.`;
      problems.push(message);
      diagnostics.push({
        code: 'composition/label-gap', severity: 'error', message,
        subject: { diagramType: 'architecture', collection: 'connections', id: rect.relation.id, from: rect.relation.from, to: rect.relation.to },
        evidence: { clearGapPx: shortHorizontalGap, minimumGapPx: requiredGap, labelWidthPx: rect.width, obstacles: blockedComponents.map(c => c.id) },
        supportedFixes: [`increase the clear gap between the connected nodes to at least ${requiredGap}px`, 'reposition the connected nodes together while preserving the full relationship label'],
      });
    } else {
      for (const c of blockedComponents) {
        problems.push(`Label "${rect.label}" overlaps component "${c.id}" — adjust labelDx/labelDy/labelSegment or set labelAt.\n${suggestLabelObstacleFix(rect, rect.lx, rect.ly, c, 'component', viewBox, components.values())}`);
      }
    }
    if (enforcesBoundaryTitleComposition) {
      for (const boundary of boundaries) {
        if (!rectsOverlap(boundary.title, rect)) continue;
        problems.push(
          `Boundary label "${boundary.label}" overlaps connection label "${rect.label}" — move the boundary title rail by adjusting wrapped component positions, or move the connection label with labelAt/labelDx/labelDy/labelSegment.`,
        );
      }
    }
  }
  problems.push(...cleanLabelRouteClearanceProblems({
    relations: arch.connections,
    labels: labelRects,
    endpointIds: new Set(components.keys()),
    pathFor,
    diagramType: 'architecture',
    relationCollection: 'connections',
    profile: arch.meta?.quality_profile,
  }));
  // See collectLabelCanvasOverflow in shared/geometry.mjs. An auto canvas now
  // covers these rects, so this reports authored viewBoxes and the origin side,
  // which growth cannot reach.
  problems.push(...cleanLabelCanvasContainmentProblems({
    labels: labelRects,
    viewBox,
    diagramType: 'architecture',
    relationCollection: 'connections',
    profile: arch.meta?.quality_profile,
  }));

  if (problems.length) {
    throwDiagnosticProblems('Architecture layout validation failed', problems, {
      subject: { diagramType: 'architecture' },
      diagnostics,
    });
  }
}

function buildLayoutReport() {
  const labels = connectionLabels.map((rect) => ({
    text: rect.label,
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: 14,
    labelAt: [Math.round(rect.lx), Math.round(rect.ly)],
  }));
  return {
    ok: true,
    diagram_type: 'architecture',
    layout: grid ? { mode: 'grid', ...grid } : { mode: 'free' },
    viewBox,
    components: [...components.values()].map(componentBox),
    boundaries: boundaries.map(boundaryBox),
    connections: asArray(arch.connections)
      .filter((conn) => components.has(conn.from) && components.has(conn.to))
      .map((conn) => {
        const routed = pathFor(conn);
        const labelAt = conn.label ? resolvedLabelPoints.get(conn) || labelPoint(conn, routed.points) : null;
        return connectionPath(conn, routed, labelAt);
      }),
    labels,
  };
}

// ---- Rendering ---------------------------------------------------------------
function renderBoundaryFrame(b, index) {
  const cls = b.kind === 'security-group' ? 'c-security-group' : 'c-region';
  const rx = b.kind === 'security-group' ? 8 : 12;
  // A zone carries one colour, so its frame, pill and title all inherit the
  // same tone; without one the stylesheet's default amber applies.
  const tone = b.tone ? ` data-boundary-tone="${esc(b.tone)}"` : '';
  return `        <rect data-graph-role="structural-frame" data-composition-frame-kind="${esc(b.kind || 'boundary')}" data-composition-frame-id="${index}" data-composition-frame-label="${esc(b.label)}"${tone} x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" rx="${rx}" class="${cls}" stroke-width="1"/>`;
}

function renderBoundaryLabel(b, index) {
  const labelCls = b.kind === 'security-group' ? 't-security' : 't-cloud';
  const tone = b.tone ? ` data-boundary-tone="${esc(b.tone)}"` : '';
  return `        <g data-graph-role="structural-frame-label" data-composition-frame-id="${index}" data-composition-frame-kind="${esc(b.kind || 'boundary')}" data-composition-frame-label="${esc(b.label)}"${tone}>
          <rect data-graph-role="structural-frame-label-mask" x="${b.title.x}" y="${b.title.y}" width="${b.title.width}" height="${b.title.height}" rx="3" class="c-mask"/>
          <text data-boundary-label="" x="${b.title.x + 4}" y="${b.title.y + b.title.baselineOffset}" class="${labelCls}" font-size="${b.title.fontSize}" font-weight="600">${esc(b.label)}</text>
        </g>`;
}

function renderConnectionPath(conn, index) {
  const [cls, marker] = arrowClassMap[conn.variant || 'default'] || arrowClassMap.default;
  const routed = pathFor(conn);
  const strokeWidth = conn.width || (conn.variant === 'emphasis' ? 2.8 : 2.4);
  const automaticRoute = hasAutomaticRouteGeometry(conn);
  const underlay = automaticRoute
    ? `          <path data-graph-role="automatic-crossover-underlay" d="${routed.d}" fill="none" stroke="var(--mask)" stroke-width="${strokeWidth + 4}" stroke-linecap="round" stroke-linejoin="round" pointer-events="none"/>\n`
    : '';
  const crossover = automaticRoute
    ? ` data-composition-crossover="halo"${conn.labelAt ? '' : ' data-composition-independent="true"'}` : '';
  // A faceplate hole owns its arrowhead: the stub drawn above the panel image
  // carries it, so the cable ends visibly on the jack instead of the border.
  const head = faceplatePortEntry(conn.to, conn.toPort) ? '' : ` marker-end="url(#${marker})"`;
  const edge = `        <path ${focusEdgeAttrs(conn.from, conn.to, conn.label, index, conn.id)} data-composition-points="${routePointsValue(routed.points)}"${crossover}${authoredStraightRouteAttrs(conn, routed.points)} d="${routed.d}" class="${cls}"${animateAttr(arch.meta, 'edge', index)} stroke-width="${strokeWidth}"${head}/>`;
  if (!automaticRoute) return edge;
  // The wrapper is presentation-only: viewer state remains on the one semantic
  // edge, while CSS can keep its preceding mask underlay at the same opacity.
  return `        <g data-graph-role="automatic-crossover" style="--step:${index}">\n${underlay}${edge.replace(/^        /, '          ')}\n        </g>`;
}

function faceplatePortEntry(componentId, portId) {
  if (!portId) return null;
  return faceplateModels.get(componentId)?.ports.get(portId) || null;
}

// A faceplate cable finishes inside the node box, where the panel image paints
// over it. Redraw that last stretch above the image so the cable runs into the
// hole and any arrowhead lands on the jack.
function renderPortStubs() {
  const parts = [];
  for (const conn of asArray(arch.connections)) {
    const [cls, marker] = arrowClassMap[conn.variant || 'default'] || arrowClassMap.default;
    const strokeWidth = conn.width || (conn.variant === 'emphasis' ? 2.8 : 2.4);
    for (const endpoint of ['from', 'to']) {
      const port = faceplatePortEntry(
        endpoint === 'from' ? conn.from : conn.to,
        endpoint === 'from' ? conn.fromPort : conn.toPort,
      );
      if (!port) continue;
      const [exitX, exitY] = port.point;
      const [jackX, jackY] = port.jack;
      if (Math.abs(exitX - jackX) < 0.01 && Math.abs(exitY - jackY) < 0.01) continue;
      const head = endpoint === 'to' ? ` marker-end="url(#${marker})"` : '';
      parts.push(`          <line data-port-stub="${esc(conn.id)}" x1="${exitX}" y1="${exitY}" x2="${jackX}" y2="${jackY}" class="${cls}" stroke-width="${strokeWidth}"${head} pointer-events="none"/>`);
    }
  }
  return parts.length ? `        <g data-port-stubs="">\n${parts.join('\n')}\n        </g>` : '';
}

function renderConnectionLabel(conn, index) {
  const box = connectionLabelBox(conn);
  if (!box) return '';
  return `        <g data-detail="context" ${focusEdgeAttrs(conn.from, conn.to, conn.label, index, conn.id)}>
          <rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" rx="3" class="c-mask"/>
          <text x="${box.lx}" y="${box.ly}" class="${edgeLabelAccent(conn.variant)}" font-size="8" text-anchor="middle">${esc(conn.label)}</text>
        </g>`;
}

function renderPorts(c) {
  const slots = portSlots(c);
  if (!slots.size) return '';
  const parts = [];
  for (const slot of slots.values()) {
    const jackX = slot.x - PORT_JACK_WIDTH / 2;
    const jackY = slot.y - PORT_JACK_HEIGHT / 2;
    const textX = slot.side === 'left' ? c.x + 8 : c.x + c.width - 8;
    const anchor = slot.side === 'left' ? 'start' : 'end';
    parts.push(`<rect class="c-port-jack" x="${jackX}" y="${jackY}" width="${PORT_JACK_WIDTH}" height="${PORT_JACK_HEIGHT}" rx="1.5"/>`);
    parts.push(`<text data-detail="context" x="${textX}" y="${slot.y + 3}" class="t-muted" font-size="${PORT_LABEL_FONT_PX}" text-anchor="${anchor}">${esc(slot.label)}</text>`);
  }
  return `\n          <g data-ports="">${parts.join('')}</g>`;
}

function renderFaceplateMarks(model) {
  const parts = [];
  // The panel image is painted above the cables, so a cable's last stretch into
  // the jack is drawn by renderPortStubs, not by the route itself.
  for (const port of model.ports.values()) {
    parts.push(`<circle data-faceplate-port="" data-faceplate-exit="${port.point[0]},${port.point[1]}" cx="${port.jack[0]}" cy="${port.jack[1]}" r="2.5" class="c-port-jack"><title>${esc(port.label)}</title></circle>`);
  }
  return `
          <g data-faceplate-ports="">${parts.join('')}</g>`;
}

function renderComponent(c) {
  const plate = faceplateModels.get(c.id);
  const pictogram = c.pictogram ? renderPictogram(c.pictogram, c) : '';
  // A faceplate or a pictogram is the node: the box is only the routing anchor,
  // so the label moves below it and the card body disappears.
  const art = Boolean(plate || pictogram);
  const fill = componentFill[c.type] || 'c-external';
  const accent = componentText[c.type] || 't-muted';
  const rails = portRails(c);
  const contentWidth = c.width - rails.left - rails.right;
  const cx = art ? c.x + c.width / 2 : c.x + rails.left + contentWidth / 2;
  const hasSub = !art && c.sublabel != null && c.sublabel !== '';
  const labelY = art ? c.y + c.height + 10 : hasSub ? c.y + c.height / 2 - 2 : c.y + c.height / 2 + 4;
  const sub = hasSub
    ? `\n        <text data-detail="context" x="${cx}" y="${c.y + c.height / 2 + 14}" class="t-muted" font-size="${fittedNodeFontSize(c.sublabel, contentWidth, componentTextFit.sublabelPreferred, componentTextFit.sublabelMinimum)}" text-anchor="middle">${esc(c.sublabel)}</text>`
    : '';
  const tag = !art && c.tag
    ? `\n        <text data-detail="fine" x="${cx}" y="${c.y + c.height - 8}" class="${accent}" font-size="${fittedNodeFontSize(c.tag, contentWidth, componentTextFit.tagPreferred, componentTextFit.tagMinimum)}" text-anchor="middle">${esc(c.tag)}</text>`
    : '';
  const brand = art ? '' : renderBrandMark(c, { x: c.x + c.width - 22, y: c.y + 6 });
  const labelFontSize = fittedNodeFontSize(c.label,
    art ? c.width : Math.min(brandLabelFitWidth(c, c.width), contentWidth), 11, 8);
  const passport = { kind: c.type, sublabel: c.sublabel, tag: c.tag, context: componentContext(c), ...brandMetadataFor(c) };
  return `        <g ${focusNodeAttrs(c.id, c.label, passport, arch.meta.locale)}>
          ${focusNodeTitle(c.label, passport)}
          ${plate || pictogram ? '' : `<rect x="${c.x}" y="${c.y}" width="${c.width}" height="${c.height}" rx="8" class="c-mask"/>`}
          ${plate
            ? `<image href="${esc(plate.image.dataUrl)}" x="${c.x}" y="${c.y}" width="${c.width}" height="${c.height}" preserveAspectRatio="none"/><rect x="${c.x}" y="${c.y}" width="${c.width}" height="${c.height}" rx="0" class="${fill}" style="fill:none" stroke-width="1.5"/>`
            : pictogram
              ? `<g data-pictogram-node="${esc(c.pictogram)}">${pictogram}</g>`
              : `<rect x="${c.x}" y="${c.y}" width="${c.width}" height="${c.height}" rx="8" class="${fill}"${animateAttr(arch.meta, 'node', componentSteps.get(c.id))} stroke-width="1.5"/>`}
          ${art ? '' : renderSemanticSigil(c.type, { icon: c.icon, x: c.x + 6, y: c.y + 6 })}${brand ? `\n          ${brand}` : ''}${plate ? renderFaceplateMarks(plate) : pictogram ? '' : renderPorts(c)}${art ? `
          <rect x="${faceplateCaptionRect(c).x}" y="${faceplateCaptionRect(c).y}" width="${faceplateCaptionRect(c).width}" height="${faceplateCaptionRect(c).height}" class="c-mask"/>` : ''}
          <text data-node-label=""${hasSub ? ' data-detail-anchor=""' : ''} x="${cx}" y="${labelY}" class="t-primary" font-size="${labelFontSize}" font-weight="600" text-anchor="middle">${esc(c.label)}</text>${sub}${tag}
        </g>`;
}

function renderLegend() {
  const entries = architectureLegendEntries;
  const relationshipObstacles = relationshipLegendObstacles(arch.connections, {
    pointsFor: (connection) => pathFor(connection).points,
    labelRectFor: connectionLabelBox,
  });
  let contentBottom = 0;
  for (const component of components.values()) {
    contentBottom = Math.max(contentBottom, component.y + component.height);
  }
  for (const boundary of boundaries) {
    contentBottom = Math.max(contentBottom, boundary.y + boundary.height);
  }
  return renderResolvedLegend({
    entries,
    locale: arch.meta.locale,
    layout: {
      x: layout.margin,
      baselineY: legendY(),
      width: viewBox[0] - layout.margin * 2,
      minTitleY: contentBottom + 8,
      obstacles: relationshipObstacles,
      unfit: arch.meta?.legend === undefined ? 'hide' : 'error',
      diagramType: 'architecture',
    },
    renderSwatch: (entry) => `<rect x="${entry.x}" y="${entry.baseline - 9}" width="16" height="10" rx="2.5" class="${componentFill[entry.kind] || 'c-external'}" stroke-width="1"/>`,
  });
}

function renderSvg() {
  // An automatic architecture canvas is compiler-measured geometry. Let the
  // Reader spend the real desktop height budget on it, including when an
  // outer route makes the canvas taller than the ordinary wide-diagram
  // threshold. Authored viewBoxes keep their geometry and existing Reader width policy;
  // their declared height may use readable document scrolling without reflow.
  const readerFit = arch.meta?.viewBox
    ? ' data-diagram-type="architecture" data-reader-fit="authored-height"'
    : ' data-reader-fit="intrinsic-height"';
  // A complete repository architecture is allowed to use normal page scroll;
  // keep its common-desktop text at a comfortable reading size instead of
  // shrinking a semantically rich graph to the universal emergency floor.
  const readerMinimumText = arch.meta?.viewBox ? '' : ' data-reader-min-text="7.5"';
  const readerPrimaryText = arch.meta?.viewBox ? '' : ' data-reader-primary-text="14"';
  return `      <svg viewBox="0 0 ${viewBox[0]} ${viewBox[1]}" ${svgRootAttrs(arch.meta)} ${NODE_CARD_ATTR}${readerFit}${readerMinimumText}${readerPrimaryText}>
${svgAccessibleText(arch.meta, 'architecture')}
${renderDefinitions()}
${nodeCardStyle({ portJacks: fixedPorts.size > 0 })}

        <!-- Background Grid -->
        <rect width="100%" height="100%" fill="url(#grid)" />

        <!-- Boundaries (behind everything) -->
${boundaries.map(renderBoundaryFrame).join('\n\n')}

        <!-- Connection paths (before components for correct z-order) -->
${asArray(arch.connections).map(renderConnectionPath).join('\n')}

        <!-- Components -->
${[...components.values()].map(renderComponent).join('\n\n')}

        <!-- Cables entering a faceplate hole (above the panel image) -->
${renderPortStubs()}

        <!-- Connection labels -->
${asArray(arch.connections).map(renderConnectionLabel).join('\n')}

        <!-- Boundary labels (foreground masks keep routes out of titles) -->
${boundaries.map(renderBoundaryLabel).join('\n\n')}

        <!-- Legend -->
${renderLegend()}
      </svg>`;
}

if (layoutJsonMode) {
  try {
    validateArchitecture();
  } catch (error) {
    // A rejected layout is still useful repair evidence. Input/implementation
    // failures must retain their existing failure boundary, not partial geometry.
    if (!error.archifyDiagnostics?.length) throw error;
    console.log(JSON.stringify({
      ...buildLayoutReport(),
      ...rendererFailure(error),
      contract: 'archify-architecture-layout-v1',
    }, null, 2));
    process.exitCode = 1;
  }
  if (!process.exitCode) console.log(JSON.stringify(buildLayoutReport(), null, 2));
} else {
  validateArchitecture();
  writeDiagram({
    outPath,
    template,
    diagramType: 'architecture',
    meta: arch.meta,
    svg: renderSvg(),
    cards: arch.cards,
    sourceEvidence,
    authoredDir,
  });
}

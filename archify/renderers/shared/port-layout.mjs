// Deterministic connector-port geometry for Architecture components.
// Slots depend only on the measured component box and the authored port order,
// so the router, the renderer and the validator share one source of truth.

import { textUnits } from './utils.mjs';
import { minimumNodeTextWidth } from './text-fit.mjs';

export const PORT_BAND_TOP = 28;
export const PORT_BAND_BOTTOM = 16;
export const PORT_MIN_SPACING = 14;
export const PORT_LABEL_FONT_PX = 8;
export const PORT_LABEL_UNIT_PX = 4.8;
export const PORT_RAIL_PADDING = 10;
export const PORT_JACK_WIDTH = 8;
export const PORT_JACK_HEIGHT = 10;

const SIDES = ['left', 'right'];
const LABEL_MINIMUM_PX = 8;
const DETAIL_MINIMUM_PX = 6;
// Text padding already reserved inside a card by availableNodeTextWidth().
const CARD_TEXT_PADDING = 8;

export function componentPorts(component) {
  return Array.isArray(component?.ports) ? component.ports : [];
}

export function portedSides(component) {
  const sides = new Set();
  for (const port of componentPorts(component)) {
    if (SIDES.includes(port.side)) sides.add(port.side);
  }
  return sides;
}

export function portRailWidth(component, side) {
  let widest = 0;
  for (const port of componentPorts(component)) {
    if (port.side !== side) continue;
    widest = Math.max(widest, Math.ceil(textUnits(port.label) * PORT_LABEL_UNIT_PX) + PORT_RAIL_PADDING);
  }
  return widest;
}

export function portRails(component) {
  return { left: portRailWidth(component, 'left'), right: portRailWidth(component, 'right') };
}

export function portSlots(component) {
  const slots = new Map();
  const bySide = { left: [], right: [] };
  for (const port of componentPorts(component)) {
    if (bySide[port.side]) bySide[port.side].push(port);
  }
  const usable = Math.max(0, component.height - PORT_BAND_TOP - PORT_BAND_BOTTOM);
  const top = component.y + PORT_BAND_TOP;
  for (const side of SIDES) {
    const ports = bySide[side];
    if (!ports.length) continue;
    ports.forEach((port, index) => {
      const y = ports.length === 1
        ? top + usable / 2
        : top + (usable * index) / (ports.length - 1);
      const x = side === 'left' ? component.x : component.x + component.width;
      slots.set(port.id, { id: port.id, label: port.label, side, x, y });
    });
  }
  return slots;
}

export function portCapacity(component) {
  const counts = { left: 0, right: 0 };
  for (const port of componentPorts(component)) {
    if (counts[port.side] !== undefined) counts[port.side] += 1;
  }
  return SIDES.filter((side) => counts[side] > 0).map((side) => {
    const requiredPx = PORT_BAND_TOP + PORT_BAND_BOTTOM + PORT_MIN_SPACING * (counts[side] - 1);
    return {
      side,
      count: counts[side],
      requiredPx,
      availablePx: component.height,
      ok: component.height >= requiredPx,
    };
  });
}

export function portRailCrowding(component, { labelMinimum = LABEL_MINIMUM_PX, detailMinimum = DETAIL_MINIMUM_PX } = {}) {
  const rails = portRails(component);
  if (!rails.left && !rails.right) return null;
  // Every text row the card draws has to fit between the rails, not just the
  // label: a long sublabel or tag collides with the jacks the same way.
  const minimumTextWidth = Math.max(
    minimumNodeTextWidth(component.label ?? '', labelMinimum),
    component.sublabel ? minimumNodeTextWidth(component.sublabel, detailMinimum) : 0,
    component.tag ? minimumNodeTextWidth(component.tag, detailMinimum) : 0,
  );
  const requiredPx = rails.left + rails.right + minimumTextWidth + CARD_TEXT_PADDING;
  if (component.width >= requiredPx) return null;
  return { requiredWidthPx: Math.ceil(requiredPx), availableWidthPx: component.width };
}

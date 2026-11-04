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

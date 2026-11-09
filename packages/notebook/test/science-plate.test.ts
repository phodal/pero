import assert from 'node:assert/strict';
import test from 'node:test';
import { assignPlate, createPlate, plateRectangle, plateSnapshot, plateTraversal, plateWellIndex, plateWellName } from '../src/science-plate.ts';

test('plate geometry keeps names and rectangular selection correct through 48 columns', () => {
  for (const [rows, columns] of [[4, 6], [8, 12], [16, 24], [32, 48]]) {
    const { size } = createPlate(rows, columns);
    for (let i = 0; i < rows * columns; i++) assert.equal(plateWellIndex(plateWellName(i, size), size), i);
  }
  const { size } = createPlate(8, 12), rectangle = plateRectangle(14, 0, size);
  assert.deepEqual(rectangle.map(i => plateWellName(i, size)), ['A1', 'A2', 'A3', 'B1', 'B2', 'B3']);
  assert.deepEqual(plateTraversal(rectangle, size, 'columns').map(i => plateWellName(i, size)), ['A1', 'B1', 'A2', 'B2', 'A3', 'B3']);
  assert.throws(() => plateWellIndex('A13', size), /outside/);
  assert.throws(() => plateWellIndex('A0', size), /Invalid/);
  assert.throws(() => createPlate(33, 48), /dimensions/);
});
test('plate assignment replaces, adds without duplicates and clears selected wells only', () => {
  const initial = createPlate(8, 12);
  let layout = assignPlate(initial, [0, 1], 'Sample', 'replace');
  layout = assignPlate(layout, [0], 'Control', 'add');
  layout = assignPlate(layout, [0], 'Control', 'add');
  assert.deepEqual(layout.groups.A1, ['Sample', 'Control']); assert.deepEqual(initial.groups, {});
  layout = assignPlate(layout, [1], '', 'clear'); assert.equal(layout.groups.A2, undefined);
  const snapshot = plateSnapshot(layout, [12, 0, 1], 'columns');
  assert.deepEqual(snapshot.selected, ['A1', 'B1', 'A2']); assert.equal(snapshot.wells.length, 96);
  assert.equal(snapshot.wells[12].order, 2); assert.deepEqual(snapshot.wells[0].groups, ['Sample', 'Control']);
  assert.throws(() => assignPlate(layout, [0], ' ', 'replace'), /name/);
});

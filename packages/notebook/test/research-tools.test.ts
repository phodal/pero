import assert from 'node:assert/strict';
import test from 'node:test';
import { masterMixExample, masterMixDefaults, inspectCellEvidence, compareCellEvidence } from '../src/research-tools.ts';
import { inspectWorksheetCell } from '../src/formula-inspection.ts';

test('master mix uses actual workbook evaluation and mixture recipe/QS owners without inventing measurements', () => {
  const eighty = masterMixExample(masterMixDefaults), hundred = masterMixExample({ ...masterMixDefaults, reactions: 100 });
  assert.equal(eighty.total, 1760); assert.equal(eighty.diluent, 1320); assert.equal(hundred.total, 2200);
  assert.deepEqual(eighty.mixture.measurements, {}); assert.deepEqual(eighty.mixture.records, []);
  assert.equal(eighty.mixture.recipes[0].recipe.target.value, eighty.total);
  const inspection = inspectWorksheetCell([eighty.worksheet], 'Master mix', 'C6');
  assert.equal(inspection.value, eighty.total); assert.ok(inspection.dependencies.some(dependency => dependency.from.column === 2));
  for (const patch of [{ reactions: 0 }, { reactions: 1.5 }, { reactions: 10001 }, { excessPercent: NaN }, { stockPerReaction: 30 }, { stockPerReaction: 0 }, { volumePerReaction: Infinity }]) assert.throws(() => masterMixExample({ ...masterMixDefaults, ...patch }));
});

test('formula evidence preserves complete baseline inputs while source/result/reads differences stay independent', () => {
  const sheets = [{ name: 'Data', sheet: { rows: 2, columns: 2, cells: { A1: '2', A2: '=A1*2', B1: '4' } } }];
  const baseline = inspectCellEvidence(sheets, 'Data', 'A2');
  const sameValue = compareCellEvidence(baseline, inspectCellEvidence(sheets, 'Data', 'B1'));
  assert.equal(sameValue.sameResult, true); assert.equal(sameValue.sameSource, false); assert.equal(sameValue.sameDependencies, false);
  sheets[0].sheet.cells.A1 = '3';
  const edited = compareCellEvidence(baseline, inspectCellEvidence(sheets, 'Data', 'A2'));
  assert.equal(edited.sameSource, true); assert.equal(edited.sameResult, false); assert.equal(edited.sameWorkbook, false);
  assert.equal(baseline.inputs[0].sheet.cells.A1, '2');
  assert.throws(() => inspectCellEvidence(sheets, 'Data', 'A3')); assert.throws(() => inspectCellEvidence(sheets, 'Other', 'A1'));
  assert.throws(() => inspectCellEvidence([...sheets, { ...sheets[0], name: 'data' }], 'Data', 'A1'));
});

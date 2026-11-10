import assert from 'node:assert/strict';
import test from 'node:test';
import { changeWorksheetStructure, rewriteStructuralFormula, type AxisChange, type StructuredWorksheet } from '../src/worksheet-structure.ts';
import { emptyGridPresentation } from '../src/grid-presentation.ts';
import { evaluateWorkbook } from '../src/spreadsheet.ts';
import { renameWorksheet } from '../src/worksheet.ts';

const worksheets = (): StructuredWorksheet[] => [
  { ...emptyGridPresentation(), id: 'data', name: "O'Brien", sheet: { rows: 4, columns: 3, cells: { A1: '2', A2: '3', A3: '=A1+A2', A4: '9', B1: '=$A$2', C1: '=SUM(A1:A3)' } },
    formats: { A2: { bold: true, precision: 2 } }, annotations: { A2: { unit: 'mL', evidenceIds: ['e1'] } }, rowHeights: { 1: 44 }, columnWidths: { 0: 180 } },
  { ...emptyGridPresentation(), id: 'result', name: 'Results', sheet: { rows: 2, columns: 2, cells: { A1: "='O''Brien'!$A$2*2", A2: '=A1+1', B1: '=IF(TRUE,"O\'Brien!A2",0)' } }, annotations: {} },
];

test('structural reference semantics preserve absolute flags, sheet identity and literal text', () => {
  const rows: { source: string; change: AxisChange; expected: string | null }[] = [
    { source: '=SUM($A$1:A3)+A$2+$B2+"A2"', change: { kind: 'insert', axis: 'row', index: 1 }, expected: '=SUM($A$1:A4)+A$3+$B3+"A2"' },
    { source: '=SUM(A1:A3)+$A$2+A4', change: { kind: 'delete', axis: 'row', index: 1 }, expected: '=SUM(A1:A2)+#REF!+A3' },
    { source: '=SUM(A:A)+SUM($1:$3)', change: { kind: 'insert', axis: 'row', index: 1 }, expected: '=SUM(A:A)+SUM($1:$4)' },
    { source: '=SUM(A:C)+$B$2', change: { kind: 'delete', axis: 'column', index: 1 }, expected: '=SUM(A:B)+#REF!' },
    { source: '=A1+A2+A3+A4', change: { kind: 'move', axis: 'row', index: 1, to: 3 }, expected: '=A1+A4+A2+A3' },
    { source: '=SUM(A2:A3)', change: { kind: 'move', axis: 'row', index: 1, to: 3 }, expected: null },
    { source: '=SUM(A1:A4)', change: { kind: 'move', axis: 'row', index: 1, to: 3 }, expected: '=SUM(A1:A4)' },
    { source: '=Other!A1+A1+1E3+LOG10(10)', change: { kind: 'insert', axis: 'row', index: 0 }, expected: '=Other!A1+A2+1E3+LOG10(10)' },
    { source: "='O''Brien'!#REF!+A1", change: { kind: 'insert', axis: 'row', index: 0 }, expected: "='O''Brien'!#REF!+A2" },
  ];
  for (const { source, change, expected } of rows) assert.equal(rewriteStructuralFormula(source, "O'Brien", "O'Brien", change), expected, source);
  for (const source of ['=INDIRECT("A1")', '=OFFSET(A1,1,0)', '=Budget+A1', '=[Book]Sheet!A1', "='[Book]Sheet'!A1", '=Sheet1:Sheet2!A1', '=Table1[Amount]', '=A1#', '=SUM({A1,A2})']) {
    assert.equal(rewriteStructuralFormula(source, 'Data', 'Data', { kind: 'insert', axis: 'row', index: 0 }), null, source);
  }
});

test('insert/delete move inputs, styles, dimensions and evidence with workbook dependencies in one pure transition', () => {
  const initial = worksheets(), before = structuredClone(initial);
  const result = changeWorksheetStructure(initial, 'data', { kind: 'insert', axis: 'row', index: 1 });
  assert.equal(result.status, 'ok');
  if (result.status !== 'ok') return;
  const [data, dependent] = result.worksheets;
  assert.equal(data.sheet.rows, 5);
  assert.equal(data.sheet.cells.A3, '3');
  assert.equal(data.sheet.cells.A4, '=A1+A3');
  assert.deepEqual(data.formats.A3, initial[0].formats.A2);
  assert.deepEqual(data.annotations.A3, initial[0].annotations.A2);
  assert.deepEqual(data.rowHeights, { 2: 44 });
  assert.equal(dependent.sheet.cells.A1, "='O''Brien'!$A$3*2");
  assert.equal(dependent.sheet.cells.A2, '=A1+1');
  assert.equal(evaluateWorkbook(result.worksheets).Results.A1, 6);
  assert.deepEqual(initial, before);
  const deleted = changeWorksheetStructure(result.worksheets, 'data', { kind: 'delete', axis: 'row', index: 2 });
  assert.equal(deleted.status, 'ok');
  if (deleted.status !== 'ok') return;
  assert.equal(deleted.worksheets[1].sheet.cells.A1, "='O''Brien'!#REF!*2");
  assert.equal(evaluateWorkbook(deleted.worksheets).Results.A1, '#REF!');
  assert.deepEqual(deleted.worksheets[0].annotations, {});
  assert.deepEqual(deleted.worksheets[0].formats, {});
});

test('reordering preserves all cell metadata and refuses a split merged range or formula range atomically', () => {
  const initial = worksheets();
  initial[0].sheet.cells.C1 = '=SUM(A1:A4)';
  const moved = changeWorksheetStructure(initial, 'data', { kind: 'move', axis: 'row', index: 1, to: 3 });
  assert.equal(moved.status, 'ok');
  if (moved.status !== 'ok') return;
  assert.equal(moved.worksheets[0].sheet.cells.A4, '3');
  assert.deepEqual(moved.worksheets[0].formats.A4, initial[0].formats.A2);
  assert.deepEqual(moved.worksheets[0].rowHeights, { 3: 44 });
  assert.equal(evaluateWorkbook(moved.worksheets).Results.A1, 6);
  initial[0].merges = [{ start: { column: 0, row: 1 }, end: { column: 1, row: 2 } }];
  assert.equal(changeWorksheetStructure(initial, 'data', { kind: 'move', axis: 'row', index: 1, to: 3 }).status, 'split-range');
  initial[0].merges = [];
  initial[0].sheet.cells.C1 = '=SUM(A2:A3)';
  assert.equal(changeWorksheetStructure(initial, 'data', { kind: 'move', axis: 'row', index: 1, to: 3 }).status, 'unsupported-formula');
});

test('structure edits retain merges, bounded limits and worksheet renaming', () => {
  const initial = worksheets();
  initial[0].merges = [{ start: { column: 0, row: 0 }, end: { column: 1, row: 2 } }];
  const result = changeWorksheetStructure(initial, 'data', { kind: 'insert', axis: 'row', index: 1 });
  assert.equal(result.status, 'ok');
  if (result.status !== 'ok') return;
  assert.equal(result.worksheets[0].merges[0].end.row, 3);
  const named = worksheets();
  named[0].columnNames = { 1: '1x Solution' };
  const shifted = changeWorksheetStructure(named, 'data', { kind: 'insert', axis: 'column', index: 1 });
  assert.equal(shifted.status, 'ok');
  if (shifted.status === 'ok') assert.equal(shifted.worksheets[0].columnNames['2'], '1x Solution');
  const renamed = renameWorksheet(result.worksheets, 'data', 'Measurements');
  assert.equal(renamed.status, 'ok');
  if (renamed.status === 'ok') assert.equal(renamed.worksheets[1].sheet.cells.A1, "='Measurements'!$A$3*2");
  initial[0].sheet.rows = 200;
  assert.equal(changeWorksheetStructure(initial, 'data', { kind: 'insert', axis: 'row', index: 0 }).status, 'limit');
  initial[0].sheet.columns = 50;
  assert.equal(changeWorksheetStructure(initial, 'data', { kind: 'insert', axis: 'column', index: 0 }).status, 'limit');
});

test('structure edits move notes with cells and keep a row filter on its column', () => {
  const sheet = (): StructuredWorksheet => ({
    ...emptyGridPresentation(), id: 'data', name: 'Data', annotations: { B2: { unit: 'mL', evidenceIds: [] } },
    sheet: { rows: 3, columns: 3, cells: { A1: 'a', B2: 'b', C3: 'c' } },
    notes: { A1: 'first', B2: 'middle', C3: 'last' }, rowFilter: { column: 1, query: 'b' },
  });
  const other = (): StructuredWorksheet => ({
    ...emptyGridPresentation(), id: 'other', name: 'Other', annotations: {},
    sheet: { rows: 1, columns: 1, cells: {} }, notes: { A1: 'stay' }, rowFilter: { column: 0, query: 'stay' },
  });
  const cases: { change: AxisChange; notes: Record<string, string>; filter: { column: number; query: string } | null; annotation?: string }[] = [
    { change: { kind: 'insert', axis: 'row', index: 1 }, notes: { A1: 'first', B3: 'middle', C4: 'last' }, filter: { column: 1, query: 'b' }, annotation: 'B3' },
    { change: { kind: 'delete', axis: 'row', index: 1 }, notes: { A1: 'first', C2: 'last' }, filter: { column: 1, query: 'b' } },
    { change: { kind: 'move', axis: 'row', index: 1, to: 2 }, notes: { A1: 'first', B3: 'middle', C2: 'last' }, filter: { column: 1, query: 'b' }, annotation: 'B3' },
    { change: { kind: 'insert', axis: 'column', index: 1 }, notes: { A1: 'first', C2: 'middle', D3: 'last' }, filter: { column: 2, query: 'b' }, annotation: 'C2' },
    { change: { kind: 'delete', axis: 'column', index: 1 }, notes: { A1: 'first', B3: 'last' }, filter: null },
    { change: { kind: 'move', axis: 'column', index: 1, to: 2 }, notes: { A1: 'first', C2: 'middle', B3: 'last' }, filter: { column: 2, query: 'b' }, annotation: 'C2' },
  ];
  for (const { change, notes, filter, annotation } of cases) {
    const initial = [sheet(), other()];
    const before = structuredClone(initial);
    const result = changeWorksheetStructure(initial, 'data', change);
    assert.equal(result.status, 'ok', JSON.stringify(change));
    if (result.status !== 'ok') return;
    assert.deepEqual(result.worksheets[0].notes, notes, JSON.stringify(change));
    assert.deepEqual(result.worksheets[0].rowFilter, filter, JSON.stringify(change));
    assert.equal(annotation ? result.worksheets[0].annotations[annotation]?.unit : result.worksheets[0].annotations.B2?.unit, annotation ? 'mL' : undefined, JSON.stringify(change));
    assert.deepEqual(result.worksheets[1].notes, { A1: 'stay' });
    assert.deepEqual(result.worksheets[1].rowFilter, { column: 0, query: 'stay' });
    assert.deepEqual(initial, before);
  }
});

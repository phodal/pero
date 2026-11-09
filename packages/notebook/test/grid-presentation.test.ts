import assert from 'node:assert/strict';
import test from 'node:test';
import { displayNumber, emptyGridPresentation, formatCellRange, formatCellValue, mergeCellRange, unmergeCellRange, gridWriteConflicts, resizeGridAxis, exportWorksheetCsv, type WorksheetGrid } from '../src/grid-presentation.ts';
import { pasteCellGrid } from '../src/spreadsheet-range.ts';
import { evaluateSpreadsheet } from '../src/spreadsheet.ts';

const selection = { start: { column: 0, row: 0 }, end: { column: 1, row: 1 } };
const grid = (): WorksheetGrid => ({ ...emptyGridPresentation(), sheet: { rows: 3, columns: 3, cells: { A1: '=1/3', B1: '7', A2: '4', B2: '=A1*3' } }, annotations: { B1: { unit: 'mL', evidenceIds: ['e1'] } } });

test('presentation changes preserve source precision and evidence, including clear and paste', () => {
  const initial = grid(), before = structuredClone(initial);
  const formatted = formatCellRange(initial, selection, { bold: true, foreground: 'green', precision: 2, align: 'right' });
  assert.equal(formatCellValue(evaluateSpreadsheet(formatted.sheet).A1, formatted.formats.A1), '0.33');
  assert.equal(evaluateSpreadsheet(formatted.sheet).B2, 1);
  assert.deepEqual(formatted.sheet, initial.sheet);
  assert.deepEqual(formatted.annotations, initial.annotations);
  const result = pasteCellGrid(formatted.sheet, { column: 0, row: 0 }, [['=2/3']]);
  assert.ok('sheet' in result);
  const pasted = { ...formatted, sheet: result.sheet };
  assert.equal(formatCellValue(evaluateSpreadsheet(pasted.sheet).A1, pasted.formats.A1), '0.67');
  assert.equal(evaluateSpreadsheet(pasted.sheet).B2, 2);
  const calculated = evaluateSpreadsheet({ rows: 1, columns: 1, cells: { A1: '=0.1+0.2' } });
  assert.equal(calculated.A1, 0.1 + 0.2);
  for (const [value, shown] of [
    [calculated.A1, '0.3'], [0.7 + 0.1, '0.8'], [1, '1'], [-2, '-2'], [1e21, '1e+21'],
    [1 / 3, '0.3333333333333333'], [Math.PI, '3.141592653589793'], [1.23e-8, '1.23e-8'],
  ] as const) {
    assert.equal(formatCellValue(value), shown, String(value));
    assert.equal(displayNumber(value), shown, String(value));
  }
  assert.equal(formatCellValue(0.1 + 0.2, { precision: 4 }), '0.3000');
  const cleared = formatCellRange(pasted, selection, null);
  assert.deepEqual(cleared.formats, {});
  assert.equal(cleared.sheet.cells.A1, '=2/3');
  assert.deepEqual(initial, before);
});

test('merges require explicit preservation confirmation and reject conflicting writes and overlaps', () => {
  const initial = grid();
  assert.equal(mergeCellRange(initial, selection).status, 'confirmation-required');
  const merged = mergeCellRange(initial, selection, true);
  assert.equal(merged.status, 'ok');
  if (merged.status !== 'ok') return;
  assert.deepEqual(merged.grid.sheet, initial.sheet);
  assert.deepEqual(merged.grid.annotations, initial.annotations);
  assert.equal(mergeCellRange(merged.grid, selection, true).status, 'overlap');
  assert.equal(gridWriteConflicts(merged.grid, { start: { column: 1, row: 0 }, end: { column: 2, row: 2 } }), true);
  assert.deepEqual(unmergeCellRange(merged.grid, selection), initial);
  assert.equal(mergeCellRange(initial, { start: { column: 0, row: 0 }, end: { column: 3, row: 1 } }, true).status, 'invalid');
});

test('dimensions are bounded and evaluated CSV preserves unrounded values with safe escaped text', () => {
  const initial = grid();
  for (const pixels of [0, 23, 241, 30.5, NaN]) assert.equal(resizeGridAxis(initial, 'row', 0, pixels), null);
  assert.equal(resizeGridAxis(initial, 'column', 2, 640)?.columnWidths['2'], 640);
  const sheet = { rows: 2, columns: 3, cells: {} };
  assert.equal(exportWorksheetCsv(sheet, { A1: 1/3, B1: 'a,b"c', C1: true, A2: '=danger()', B2: -2 }), '0.3333333333333333,"a,b""c",TRUE\r\n\'=danger(),-2,');
});

test('presentation boundary accepts legacy defaults and rejects unsafe coordinates, styles, dimensions and overlaps', async () => {
  const { isGridPresentation } = await import('../src/grid-presentation.ts');
  const initial = grid();
  for (const metadata of [{}, initial, { formats: { A1: { precision: 0, foreground: 'rose', bold: false } }, rowHeights: { 0: 240 }, merges: [selection] }]) {
    assert.equal(isGridPresentation(metadata, initial.sheet), true);
  }
  for (const metadata of [
    { formats: { D1: {} } }, { formats: { a1: {} } }, { formats: { A1: { precision: 13 } } }, { formats: { A1: { precision: 0.5 } } },
    { formats: { A1: { foreground: 'red' } } }, { formats: { A1: { fontSize: 100 } } }, { formats: { A1: { bold: 1 } } },
    { rowHeights: { '01': 32 } }, { rowHeights: { 3: 32 } }, { columnWidths: { 1: 641 } }, { rowHeights: { 1: 20.5 } },
    { formats: null }, { merges: [selection, selection] }, { merges: [{ ...selection, other: true }] },
    { merges: [{ start: { column: 0, row: 0 }, end: { column: 3, row: 1 } }] },
    { merges: [{ start: { column: 0, row: 0 }, end: { column: 0, row: 0 } }] },
  ]) assert.equal(isGridPresentation(metadata, initial.sheet), false, JSON.stringify(metadata));
  const automatic = formatCellRange(formatCellRange(initial, selection, { precision: 3, bold: true }), selection, { precision: undefined });
  assert.equal(isGridPresentation(automatic, automatic.sheet), true);
  assert.deepEqual(automatic.formats.A1, { bold: true });
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyGridPresentation } from '../src/grid-presentation.ts';
import { cellAddress } from '../src/spreadsheet.ts';
import {
  asOperableGrid, hiddenRows, matchingRows, parseSheetOperations, setCellNote, setRowFilter, sheetOperationLimits,
  sheetOperationRecord, sortGridColumn, type OperableGrid, type SortDirection,
} from '../src/sheet-operations.ts';

function grid(cells: Record<string, string>, patch: Partial<OperableGrid> = {}, rows = 3, columns = 3): OperableGrid {
  return { ...emptyGridPresentation(), sheet: { rows, columns, cells: { ...cells } }, annotations: {}, notes: {}, rowFilter: null, ...patch };
}

function column(sheet: OperableGrid, index: number): string[] {
  return Array.from({ length: sheet.sheet.rows }, (_, row) => sheet.sheet.cells[cellAddress(index, row)] ?? '');
}

test('sort reorders value rows and leaves formulas, merges, and the original grid intact', () => {
  const initial = grid({
    A1: '10', B1: 'keep', A3: '2', B3: 'two', C3: '=1+1', A4: 'b', B4: 'text', A5: "'10", B5: 'forced',
    A6: 'b', B6: 'text-2', A7: 'TRUE', B7: 'yes', A8: '50%', B8: 'half', A9: 'FALSE', B9: 'no', B2: 'blank', C2: '=SUM(C:C)',
  }, {
    notes: { B1: 'with ten' }, formats: { A3: { bold: true } }, rowHeights: { 1: 48 },
    columnNames: { 0: '1x Solution' }, columnWidths: { 1: 180 },
    annotations: { A8: { unit: 'mL', evidenceIds: ['e1'], url: 'https://example.test/half' } },
  }, 9, 3);
  const before = structuredClone(initial);
  const ascending = sortGridColumn(initial, 0, 'asc');
  assert.equal(ascending.status, 'ok');
  if (ascending.status !== 'ok') return;
  assert.deepEqual(column(ascending.grid, 0), ['50%', '2', '10', 'FALSE', 'TRUE', "'10", 'b', 'b', '']);
  assert.deepEqual(column(ascending.grid, 1), ['half', 'two', 'keep', 'no', 'yes', 'forced', 'text', 'text-2', 'blank']);
  assert.equal(ascending.grid.sheet.cells.C2, '=1+1');
  assert.equal(ascending.grid.sheet.cells.C9, '=SUM(C:C)');
  assert.equal(ascending.grid.notes.B3, 'with ten');
  assert.deepEqual(ascending.grid.formats.A2, { bold: true });
  assert.deepEqual(ascending.grid.annotations.A1, initial.annotations.A8);
  assert.deepEqual(ascending.grid.rowHeights, { 8: 48 });
  assert.deepEqual(ascending.grid.columnNames, { 0: '1x Solution' });
  assert.deepEqual(ascending.grid.columnWidths, { 1: 180 });
  assert.equal(ascending.grid.rowFilter, null);
  assert.deepEqual(initial, before);

  const descending = sortGridColumn(initial, 0, 'desc');
  assert.equal(descending.status, 'ok');
  if (descending.status !== 'ok') return;
  assert.deepEqual(column(descending.grid, 1), ['text', 'text-2', 'forced', 'yes', 'no', 'keep', 'two', 'half', 'blank']);
  assert.equal(descending.grid.sheet.cells.C7, '=1+1');
  assert.equal(descending.grid.sheet.cells.C9, '=SUM(C:C)');
});

test('sort rejects formula keys, broken references, opaque formulas, and split merges', () => {
  const rows: {
    name: string; cells: Record<string, string>; rows?: number; column?: number; direction?: SortDirection | 'side';
    sheetName?: string; merges?: OperableGrid['merges']; expect: string; address?: string;
  }[] = [
    { name: 'formula sort key', cells: { A1: 'b', A2: '=10' }, expect: 'formula:A2:sort-key' },
    { name: 'already ordered formula key', cells: { A1: 'a', A2: '=10' }, expect: 'formula:A2:sort-key' },
    { name: 'relative reference', cells: { A1: 'a', A2: 'b', B2: '=A1' }, direction: 'desc', expect: 'formula:B2:reference' },
    { name: 'row range', cells: { A1: 'b', A2: 'a', B2: '=SUM(1:1)' }, expect: 'formula:B2:reference' },
    { name: 'indirect', cells: { A1: 'b', A2: 'a', B1: '=INDIRECT("A1")' }, expect: 'formula:B1:opaque' },
    { name: 'offset', cells: { A1: 'b', A2: 'a', B1: '=OFFSET(A1,0,0)' }, expect: 'formula:B1:opaque' },
    { name: 'named range', cells: { A1: 'b', A2: 'a', B1: '=Budget+A1' }, expect: 'formula:B1:opaque' },
    { name: 'unqualified sheet', cells: { A1: 'b', A2: 'a', B1: '=Other!A1' }, expect: 'formula:B1:opaque' },
    { name: 'same sheet', cells: { A1: 'b', A2: 'a', B1: '=Data!A1' }, sheetName: 'Data', expect: 'formula:B1:reference' },
    { name: 'external plus local', cells: { A1: 'b', A2: 'a', B1: '=Other!Z9+A1' }, sheetName: 'Data', expect: 'formula:B1:reference' },
    { name: 'quoted same sheet', cells: { A1: 'b', A2: 'a', B1: "='O''Brien'!A1" }, sheetName: "O'Brien", expect: 'formula:B1:reference' },
    { name: 'split merge', cells: { A1: 'b', A2: 'a' }, merges: [{ start: { column: 0, row: 0 }, end: { column: 0, row: 1 } }], expect: 'split-merge' },
    { name: 'bad column', cells: { A1: 'b', A2: 'a' }, column: 3, expect: 'invalid' },
    { name: 'bad direction', cells: { A1: 'b', A2: 'a' }, direction: 'side', expect: 'invalid' },
  ];
  for (const row of rows) {
    const initial = grid(row.cells, { merges: row.merges ?? [] }, row.rows ?? 3);
    const before = structuredClone(initial);
    const result = sortGridColumn(initial, row.column ?? 0, (row.direction ?? 'asc') as SortDirection, { sheetName: row.sheetName });
    const actual = result.status === 'formula' ? `formula:${result.address}:${result.reason}` : result.status;
    assert.equal(actual, row.expect, row.name);
    assert.deepEqual(initial, before, row.name);
  }

  const unchanged = grid({ A1: 'a', A2: 'b', B2: '=A1' });
  const same = sortGridColumn(unchanged, 0, 'asc');
  assert.equal(same.status, 'ok');
  if (same.status === 'ok') assert.equal(same.grid, unchanged);

  const oneRow = grid({ A1: '=10' }, {}, 1, 1);
  const single = sortGridColumn(oneRow, 0, 'asc');
  assert.equal(single.status, 'ok');
  if (single.status === 'ok') assert.equal(single.grid, oneRow);

  const external = grid({ A1: 'b', A2: 'a', B1: '=Other!Z9' });
  const moved = sortGridColumn(external, 0, 'asc', { sheetName: 'Data' });
  assert.equal(moved.status, 'ok');
  if (moved.status === 'ok') {
    assert.equal(moved.grid.sheet.cells.A1, 'a');
    assert.equal(moved.grid.sheet.cells.B2, '=Other!Z9');
  }
  const quoted = grid({ A1: 'b', A2: 'a', B1: "='O''Brien'!Z9" });
  const quotedMove = sortGridColumn(quoted, 0, 'asc', { sheetName: 'Data' });
  assert.equal(quotedMove.status, 'ok');
  if (quotedMove.status === 'ok') assert.equal(quotedMove.grid.sheet.cells.B2, "='O''Brien'!Z9");

  const literal = grid({ A1: 'b', A2: 'a', B1: '="A1"' });
  const text = sortGridColumn(literal, 0, 'asc');
  assert.equal(text.status, 'ok');
  if (text.status === 'ok') assert.equal(text.grid.sheet.cells.B2, '="A1"');

  const constant = grid({ A1: '=1+1', B1: 'b', B2: 'a' });
  const byOther = sortGridColumn(constant, 1, 'asc');
  assert.equal(byOther.status, 'ok');
  if (byOther.status === 'ok') {
    assert.equal(byOther.grid.sheet.cells.B1, 'a');
    assert.equal(byOther.grid.sheet.cells.A2, '=1+1');
  }

  const kept = grid({ A1: 'a', A2: 'b', A3: 'd', A4: 'c' }, {
    merges: [{ start: { column: 0, row: 0 }, end: { column: 0, row: 1 } }],
  }, 4);
  const partial = sortGridColumn(kept, 0, 'asc');
  assert.equal(partial.status, 'ok');
  if (partial.status === 'ok') {
    assert.deepEqual(column(partial.grid, 0), ['a', 'b', 'c', 'd']);
    assert.deepEqual(partial.grid.merges, kept.merges);
  }

  const span = grid({ A1: 'b', B1: 'x', A2: 'a', B2: 'y' }, {
    merges: [{ start: { column: 0, row: 0 }, end: { column: 1, row: 0 } }],
  });
  const shifted = sortGridColumn(span, 0, 'asc');
  assert.equal(shifted.status, 'ok');
  if (shifted.status === 'ok') {
    assert.deepEqual(shifted.grid.merges, [{ start: { column: 0, row: 1 }, end: { column: 1, row: 1 } }]);
    assert.equal(shifted.grid.sheet.cells.A1, 'a');
    assert.equal(shifted.grid.sheet.cells.B2, 'x');
  }
});

test('row filters hide non-matching rows and do not delete them', () => {
  const samples = grid({ A1: 'sample-a', A2: 'Other', A3: 'SAMPLE-b' }, { notes: { A2: 'secret' }, annotations: { A1: { unit: 'mL', evidenceIds: [] } } });
  const filtered = setRowFilter(samples, 0, '  Sample  ');
  assert.equal(filtered.status, 'ok');
  if (filtered.status !== 'ok') return;
  assert.equal(filtered.grid.sheet, samples.sheet);
  assert.deepEqual(filtered.grid.notes, samples.notes);
  assert.deepEqual(filtered.grid.annotations, samples.annotations);
  assert.deepEqual(matchingRows(filtered.grid), [0, 2]);
  assert.deepEqual(hiddenRows(filtered.grid), [1]);
  assert.deepEqual(hiddenRows(setRowFilter(filtered.grid, 0, '   ').grid), []);

  const calculated = grid({ A1: '=1+1', A2: '5' }, {}, 2);
  assert.deepEqual(hiddenRows(setRowFilter(calculated, 0, '2').grid), [1]);
  assert.deepEqual(matchingRows(setRowFilter(calculated, 0, '=1+').grid), [0]);
  assert.deepEqual(hiddenRows(setRowFilter(grid({ A1: 'abc', A2: 'a.c' }, {}, 2), 0, '.').grid), [0]);
  assert.deepEqual(hiddenRows(setRowFilter(samples, 0, 'secret').grid), [0, 1, 2]);

  const sorted = sortGridColumn(filtered.grid, 0, 'asc');
  assert.equal(sorted.status, 'ok');
  if (sorted.status !== 'ok') return;
  assert.deepEqual(sorted.grid.rowFilter, { column: 0, query: 'Sample' });
  assert.equal(sorted.grid.sheet.cells.A1, 'Other');
  assert.deepEqual(hiddenRows(sorted.grid), [0]);

  assert.equal(setRowFilter(samples, 3, 'a').status, 'invalid');
  assert.equal(setRowFilter(samples, 0, 'a'.repeat(sheetOperationLimits.query + 1)).status, 'limit');
  assert.equal(setRowFilter(samples, 0, 'a\nb').status, 'invalid');
  assert.deepEqual(samples.sheet.cells, { A1: 'sample-a', A2: 'Other', A3: 'SAMPLE-b' });
  const stale = { ...samples, rowFilter: { column: 9, query: 'sample' } };
  assert.deepEqual(matchingRows(stale), [0, 1, 2]);
});

test('cell notes stay off the annotation and round-trip as their own record', () => {
  const initial = grid({ A1: '2' }, { annotations: { A1: { unit: 'mL', evidenceIds: ['e1'], url: 'https://example.test/a' } } });
  const before = structuredClone(initial);
  const saved = setCellNote(initial, 'A1', '  diluted 1:10  ');
  assert.equal(saved.status, 'ok');
  if (saved.status !== 'ok') return;
  assert.equal(saved.grid.notes.A1, 'diluted 1:10');
  assert.deepEqual(saved.grid.annotations, initial.annotations);
  assert.equal(saved.grid.sheet, initial.sheet);
  const both = setCellNote(saved.grid, 'B2', 'second');
  assert.equal(both.status, 'ok');
  if (both.status !== 'ok') return;
  assert.deepEqual(both.grid.notes, { A1: 'diluted 1:10', B2: 'second' });
  const cleared = setCellNote(both.grid, 'A1', '   ');
  assert.equal(cleared.status, 'ok');
  if (cleared.status !== 'ok') return;
  assert.deepEqual(cleared.grid.notes, { B2: 'second' });
  assert.equal(setCellNote(cleared.grid, 'B2', 'second').grid, cleared.grid);
  assert.equal(setCellNote(initial, 'A1', 'n'.repeat(sheetOperationLimits.note + 1)).status, 'limit');
  assert.equal(setCellNote(initial, 'A1', 'a\nb').status, 'invalid');
  assert.equal(setCellNote(initial, 'Z9', 'no').status, 'invalid');
  assert.equal(setCellNote(initial, 'a1', 'no').status, 'invalid');
  assert.deepEqual(initial, before);

  const record = sheetOperationRecord(both.grid);
  assert.deepEqual(parseSheetOperations({ formats: { A1: { bold: true } }, ...record }, initial.sheet), {
    notes: { A1: 'diluted 1:10', B2: 'second' }, rowFilter: null,
  });
  const filtered = setRowFilter(both.grid, 1, 'second');
  assert.equal(filtered.status, 'ok');
  if (filtered.status !== 'ok') return;
  assert.deepEqual(parseSheetOperations(sheetOperationRecord(filtered.grid), initial.sheet), {
    notes: filtered.grid.notes, rowFilter: { column: 1, query: 'second' },
  });
  assert.deepEqual(sheetOperationRecord(grid({})), {});
  assert.equal(asOperableGrid({ ...emptyGridPresentation(), sheet: initial.sheet, annotations: {} }).rowFilter, null);

  const sheet = initial.sheet;
  const rejected = [
    { notes: { A9: 'out' } }, { notes: { A1: '' } }, { notes: { A1: '  x' } }, { notes: { A1: 'a\nb' } },
    { notes: { A1: 1 } }, { notes: [] }, { notes: { A1: 'n'.repeat(501) } },
    { rowFilter: { column: 0, query: 'a', extra: true } }, { rowFilter: { column: -1, query: 'a' } },
    { rowFilter: { column: 1.5, query: 'a' } }, { rowFilter: { column: 3, query: 'a' } },
    { rowFilter: { column: 0, query: '' } }, { rowFilter: { column: 0, query: ' a ' } },
    { rowFilter: { column: 0, query: 'a\nb' } }, { rowFilter: { column: true, query: 'a' } },
    { rowFilter: [] }, { notes: { A1: 'ok' }, rowFilter: { column: 0 } },
  ];
  for (const value of rejected) assert.equal(parseSheetOperations(value, sheet), null, JSON.stringify(value));
  assert.deepEqual(parseSheetOperations({ notes: {}, rowFilter: null }, sheet), { notes: {}, rowFilter: null });
  assert.deepEqual(parseSheetOperations({ notes: { A1: 'n'.repeat(500) }, rowFilter: { column: 0, query: 'q'.repeat(200) } }, sheet)?.rowFilter?.query.length, 200);
});

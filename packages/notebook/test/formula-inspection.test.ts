import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectWorksheetCell, formulaHelp } from '../src/formula-inspection.ts';
import { formulaFunctions } from '../src/spreadsheet.ts';

test('formula inspection reports actual cross-sheet reads, typed values and errors without inventing an AST', () => {
  const worksheets = [
    { name: 'Data', sheet: { rows: 3, columns: 2, cells: { A1: '2', A2: '3', A3: '5', B1: "'#REF!" } } },
    { name: 'Results', sheet: { rows: 2, columns: 3, cells: { A1: '=SUM(Data!A1:A3)*2', A2: '=Data!A1/0', B1: '=TRUE', B2: '=Missing!A1' } } },
  ];
  const result = inspectWorksheetCell(worksheets, 'Results', 'A1');
  assert.equal(result.value, 20);
  assert.equal(result.type, 'number');
  assert.deepEqual(result.dependencies, [{ sheet: 'Data', from: { column: 0, row: 0 }, to: { column: 0, row: 2 } }]);
  for (const [sheet, address, type, value] of [['Results', 'A2', 'error', '#DIV/0!'], ['Results', 'B1', 'boolean', true], ['Results', 'B2', 'error', '#REF!'], ['Data', 'B1', 'text', '#REF!'], ['Data', 'B3', 'blank', '']] as const) {
    const inspection = inspectWorksheetCell(worksheets, sheet, address);
    assert.equal(inspection.type, type);
    assert.equal(inspection.value, value);
  }
  assert.ok(formulaFunctions.every(name => formulaHelp[name]?.syntax && formulaHelp[name]?.description));
});

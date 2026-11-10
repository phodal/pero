import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectFormulaSyntax } from '../src/formula-syntax.ts';
import { inspectFormulaSandbox } from '../src/formula-inspection.ts';

const worksheets = [
  { name: 'Data', sheet: { rows: 6, columns: 3, cells: { A1: '2', A2: '3', A3: '5', B1: '10', B2: '20', B3: '30' } } },
  { name: 'Preview', sheet: { rows: 3, columns: 2, cells: {} } },
];

test('workbench computes supported categories through the actual engine, preserving sheets', () => {
  const before = JSON.stringify(worksheets);
  const cases: [string, unknown][] = [
    ['=IF(2>1,"yes","no")', 'yes'], ['=SUM(1,2,3)', 6],
    ['=XLOOKUP(2,{1,2,3},{10,20,30})', 20], ['=SUM(Data!A1:A3)', 10],
    ['=XLOOKUP(3,Data!A1:A3,Data!B1:B3)', 20],
    ['=VLOOKUP(3,Data!A1:B3,2,FALSE)', 20],
    ['=SQRT(9)', 3], ['=CORREL(Data!A1:A3,Data!A1:A3)', 1],
    ['=REVERSECOMPLEMENT("ATGCRY")', 'RYGCAT'],
    ['=REVERSECOMPLEMENT("augc","RNA")', 'GCAU'],
    ['=REVERSECOMPLEMENT("at gc1")', 'GCAT'],
    ['=REVERSECOMPLEMENT("AT-X")', '#VALUE!'],
    ['=REVERSECOMPLEMENT("ATGC","RNA")', '#VALUE!'],
    ['=REVERSECOMPLEMENT(42)', '#VALUE!'], ['=REVERSECOMPLEMENT(1/0)', '#DIV/0!'],
    ['=REVERSECOMPLEMENT("A","DNA",2)', '#VALUE!'],
    ['=1/0', '#DIV/0!'], ['=NOT_A_FUNCTION(1)', '#NAME?'],
    ['=SUM(', '#ERROR!'], ['=A1', '#CIRC!'],
  ];
  for (const [source, expected] of cases) {
    assert.equal(inspectFormulaSandbox(worksheets, 'Preview', 'A1', source).value, expected, source);
  }
  const inspection = inspectFormulaSandbox(worksheets, 'Preview', 'A1', '=SUM(Data!A1:A3)');
  assert.deepEqual(inspection.dependencies, [{ sheet: 'Data', from: { column: 0, row: 0 }, to: { column: 0, row: 2 } }]);
  assert.equal(JSON.stringify(worksheets), before);
  for (const [name, cell, source] of [['Missing', 'A1', '=1'], ['Data', 'D1', '=1'], ['Data', 'A7', '=1'], ['Data', 'A0', '=1'], ['Data', 'A1', 'SUM(1)']]) {
    assert.throws(() => inspectFormulaSandbox(worksheets, name, cell, source));
  }
});

test('syntax reports engine tokens and exact source spans, never an invented AST', () => {
  const source = '=  IF(Data!A1>2,SUM(1,2),"a(b)") ';
  const syntax = inspectFormulaSyntax(source);
  assert.equal(syntax.representation, 'engine-tokens-and-delimiter-groups');
  assert.equal(syntax.error, null);
  for (const token of syntax.tokens) assert.equal(source.slice(token.start, token.end), token.text);
  assert.equal(syntax.tokens[0].kind, 'Function');
  assert.equal(syntax.tokens[0].text, 'IF(');
  assert.ok(syntax.tokens.some(token => token.kind === 'String' && token.text === '"a(b)"'));
  assert.ok(syntax.structure[0].children?.some(node => node.token.text === 'SUM(' && node.children?.length));
  assert.ok(inspectFormulaSyntax('=SUM(').error);
  assert.ok(inspectFormulaSyntax('=1)').error);
  assert.ok(inspectFormulaSyntax('=💡').error);
  assert.deepEqual(inspectFormulaSyntax('ordinary text').tokens, []);
});

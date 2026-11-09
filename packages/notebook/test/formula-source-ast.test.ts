import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectFormulaSyntax } from '../src/formula-syntax.ts';
import { inspectFormulaSandbox } from '../src/formula-inspection.ts';
import type { FormulaSourceNode } from '../src/formula-source-ast.ts';

const context = [{ name: 'Data', sheet: { rows: 4, columns: 4, cells: { A1: '2', A2: '3', A3: '4', B1: '8' } } },
  { name: 'Preview', sheet: { rows: 1, columns: 1, cells: {} } }];
const tree = (source: string) => {
  const ast = inspectFormulaSyntax(source).sourceAst;
  assert.equal(ast.status, 'supported', JSON.stringify(ast));
  if (ast.status !== 'supported') throw new Error(ast.detail);
  return ast.root;
};
const shape = (node: FormulaSourceNode): unknown => {
  switch (node.kind) {
    case 'literal': case 'reference': return node.text;
    case 'qualified': return [node.sheet, shape(node.reference)];
    case 'unary': case 'postfix': return [node.kind, node.operator, shape(node.operand)];
    case 'binary': case 'range': case 'intersection': return [node.operator, shape(node.left), shape(node.right)];
    case 'group': return ['()', shape(node.expression)];
    case 'call': return [node.name, ...node.arguments.map(node => node && shape(node))];
    case 'array': return node.rows.map(row => row.map(shape));
    case 'union': return ['union', ...node.items.map(shape)];
  }
};

test('source AST records real expression structure and pinned-engine precedence without evaluating it', () => {
  const cases: [string, unknown, unknown][] = [
    ['=1+2*3', ['+', '1', ['*', '2', '3']], 7],
    ['=2^3^2', ['^', ['^', '2', '3'], '2'], 64],
    ['=-2^2', ['^', ['unary', '-', '2'], '2'], 4],
    ['=-2%^2', ['^', ['postfix', '%', ['unary', '-', '2']], '2'], 0.0004],
    ['=2*(3+4)', ['*', '2', ['()', ['+', '3', '4']]], 14],
    ['=1+2&"x"', ['&', ['+', '1', '2'], '"x"'], '3x'],
    ['=IF(2>1,SUM(1,2),0)', ['IF', ['>', '2', '1'], ['SUM', '1', '2'], '0'], 3],
    ['=SUM(Data!$A$1:A3)', ['SUM', ['Data!', [':', '$A$1', 'A3']]], 9],
    ['=SUM(\'Data\'!A:A)', ['SUM', ["'Data'!", [':', 'A', 'A']]], 9],
    ['=SUM(Data!1:1)', ['SUM', ['Data!', [':', '1', '1']]], 10],
    ['=SUM({1,-2;3,4})', ['SUM', [['1', ['unary', '-', '2']], ['3', '4']]], 6],
    ['=SUM((Data!A1,Data!A2))', ['SUM', ['union', ['Data!', 'A1'], ['Data!', 'A2']]], 5],
    ['=SUM(Data!A1:A3 Data!A2:A3)', ['SUM', [' ', ['Data!', [':', 'A1', 'A3']], ['Data!', [':', 'A2', 'A3']]]], 7],
    ['=ROUND(1.5,)', ['ROUND', '1.5', null], 2],
    ['=IF(TRUE,,4)', ['IF', 'TRUE', null, '4'], '#N/A'],
    ['=#REF!', '#REF!', '#REF!'],
  ];
  for (const [source, expected, value] of cases) {
    const root = tree(source);
    assert.deepEqual(shape(root), expected, source);
    assert.equal(source.slice(root.start, root.end), source.slice(1), 'spans refer to original source');
    assert.equal(inspectFormulaSandbox(context, 'Preview', 'A1', source).value, value, `actual engine: ${source}`);
  }
});

test('source AST distinguishes unsupported grammar, malformed source, and calculation errors', () => {
  for (const source of ['=named_input', '=Table1[Amount]', '=@A1']) {
    assert.equal(inspectFormulaSyntax(source).sourceAst.status, 'unsupported', source);
  }
  for (const source of ['=SUM(', '=1+', '=SUM({1+2})', '=1%%', '=💡', '=()']) {
    assert.equal(inspectFormulaSyntax(source).sourceAst.status, 'invalid', source);
  }
  const deep = '=' + '('.repeat(140) + '1' + ')'.repeat(140);
  assert.equal(inspectFormulaSyntax(deep).sourceAst.status, 'unsupported');
  assert.equal(inspectFormulaSyntax('literal').sourceAst.status, 'not-formula');
  // A valid source tree does not assert a successful calculation or valid arity.
  assert.equal(tree('=1/0').kind, 'binary');
  assert.equal(inspectFormulaSandbox(context, 'Preview', 'A1', '=1/0').value, '#DIV/0!');
  assert.equal(tree('=NOT_A_FUNCTION(1)').kind, 'call');
  assert.equal(inspectFormulaSandbox(context, 'Preview', 'A1', '=NOT_A_FUNCTION(1)').value, '#NAME?');
});

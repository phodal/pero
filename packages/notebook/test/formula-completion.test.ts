import assert from 'node:assert/strict';
import test from 'node:test';
import { completeFormulaFunction, formulaCompletion } from '../src/formula-inspection.ts';

test('function prefix completion replaces only the engine identifier at the caret', () => {
  const cases: [string, number, string, string, number][] = [
    ['=su', 3, 'SUM', '=SUM()', 5],
    ['=1+AV', 5, 'AVERAGE', '=1+AVERAGE()', 11],
    ['=IF(TRUE,SU,0)', 11, 'SUM', '=IF(TRUE,SUM(),0)', 13],
    ['=su(1,2)', 3, 'SUM', '=SUM(1,2)', 5],
    ['=su (1,2)', 3, 'SUM', '=SUM (1,2)', 6],
    ['=AVERAGE(1)', 3, 'AVERAGEIF', '=AVERAGEIF(1)', 11],
  ];
  for (const [source, caret, name, expected, nextCaret] of cases) {
    assert.ok(formulaCompletion(source, caret)?.names.includes(name));
    assert.deepEqual(completeFormulaFunction(source, caret, name), { source: expected, caret: nextCaret }, source);
  }
  for (const [source, caret] of [
    ['SU', 2], ['="SU"', 4], ["='SU'!A1", 4], ['=SU!A1', 3], ['=SU1', 3], ['=Data!SU', 8],
    ['=SUM(A:SU)', 9], ['=SUM(SU:Z)', 7], ['=1+2', 3], ['=SUM(1)', 5], ['=\u005bBook\u005dData!SU', 14], ['=💡SU', 5],
  ] as const) assert.equal(formulaCompletion(source, caret), null, source);
  assert.equal(completeFormulaFunction('=SU', 3, 'AVERAGE'), null);
  assert.equal(formulaCompletion('=SU', -1), null);
  assert.equal(formulaCompletion('=SU', 4), null);
  assert.equal(completeFormulaFunction(`=${' '.repeat(8188)}SU`, 8191, 'SUM'), null);
});

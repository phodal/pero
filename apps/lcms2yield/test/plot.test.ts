import test from 'node:test';
import assert from 'node:assert/strict';
import { plotBounds, showsRerun, yieldPercent, readCsv, uploadSmiles, matchingPredictions } from '../ui-src/plot.ts';

test('yield fractions become percentages and the parity plot includes the unit interval', () => {
  assert.equal(yieldPercent('0.5'), 50);
  const bounds = plotBounds([{ index: 0, x: 40, y: 42 }]);
  assert.ok(bounds.low < 0);
  assert.ok(bounds.high > 100);
});

test('an unrun weight comparison adds no second series', () => {
  assert.equal(showsRerun('UNRUN'), false);
  assert.equal(showsRerun('PASS'), true);
  assert.equal(showsRerun('FAIL'), true);
  assert.equal(showsRerun('INCONCLUSIVE'), false);
});


test('CSV keeps quoted commas, escaped quotes and multiline names out of SMILES', () => {
  for (const text of ['name,SMILES\r\n"sample, one",CCO', 'name,SMILES\n"sample ""one""\ncontinued",CCO']) {
    const table = readCsv(text);
    assert.deepEqual(uploadSmiles(table, 'SMILES'), ['CCO']);
  }
  assert.throws(() => readCsv('name,SMILES\n"unfinished,CCO'));
  assert.throws(() => uploadSmiles(readCsv('SMILES\n' + 'CCO\n'.repeat(33)), 'SMILES'), /at most 32/);
  assert.equal(uploadSmiles(readCsv('SMILES\n' + 'CCO\n'.repeat(32)), 'SMILES').length, 32);
});

test('custom results belong to the exact ordered molecule input', () => {
  const predictions = [{ smiles: 'CCO', predicted: '1' }];
  assert.deepEqual(matchingPredictions(['CCO'], predictions), predictions);
  for (const input of [undefined, [], ['CO'], ['CCO', 'CO']]) assert.deepEqual(matchingPredictions(input, predictions), []);
});

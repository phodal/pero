import test from 'node:test';
import assert from 'node:assert/strict';
import { plotBounds, showsRerun, yieldPercent } from '../ui-src/plot.ts';

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

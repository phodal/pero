import test from 'node:test';
import assert from 'node:assert/strict';
import { comparableDelta } from '../ui-src/lab.mjs';
const result = (error, origin = 'synthetic') => ({ verification: { absolute_error: error, origin } });
test('comparison reports regressions rather than promising improvement', () => {
  assert.equal(comparableDelta(result(0.25), result(0.125)), 0.125);
  assert.equal(comparableDelta(result(0.125), result(0.25)), -0.125);
  assert.equal(comparableDelta(result(0.25), result(0.25)), 0);
});
test('missing or mixed-origin evidence cannot claim a comparable improvement', () => {
  assert.equal(comparableDelta(result(0), null), null);
  assert.equal(comparableDelta(result(null), result(0.5)), null);
  assert.equal(comparableDelta(result(0, 'imported'), result(0.5)), null);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { providerEvaluationPlan, providerBudgetArgs, providerConnectionArgs } from './plan.mjs';

const commit = 'a'.repeat(40);
const configuration = () => ({ schema: 'paper-study-plan.v1', confirmed: true, authorizationReference: 'new-specific-request',
  sourceCommit: commit, endpoint: 'https://provider.example.test/v1', model: 'explicit-model',
  scenes: ['standard', 'nonstandard-decline', 'ambiguity', 'injection'],
  limits: { maxSessions: 4, maxRequests: 24, maxTokens: 2048, perTurnWallTimeMs: 120000 } });

test('real plan is explicit, commit/scene bound; absent budgets and historical config fail closed', () => {
  const parse = value => providerEvaluationPlan(value, 'standard', commit);
  const value = configuration(), parsed = parse(value);
  assert.deepEqual(providerConnectionArgs({ endpoint: parsed.endpoint, model: parsed.model, providerBudget: parsed.limits }),
    ['--endpoint', 'https://provider.example.test/v1', '--model', 'explicit-model', '--max-requests', '24', '--max-tokens', '2048']);
  assert.deepEqual(providerBudgetArgs(parsed.limits), ['--max-requests', '24', '--max-tokens', '2048']);
  for (const mutate of [v => delete v.limits.maxTokens, v => v.confirmed = false, v => v.schema = 'historical',
    v => v.sourceCommit = 'b'.repeat(40), v => v.scenes = ['injection'], v => v.endpoint = 'http://example.org',
    v => v.endpoint = 'https://key@example.org', v => v.secret = 'must-not-be-accepted', v => v.model = '',
    v => v.limits.maxSessions = 0]) {
    const invalid = configuration(); mutate(invalid); assert.throws(() => parse(invalid));
  }
  const unlimited = configuration();
  for (const key of ['maxSessions', 'maxRequests', 'maxTokens']) unlimited.limits[key] = null;
  assert.deepEqual(providerBudgetArgs(parse(unlimited).limits), ['--max-requests', '0', '--max-tokens', '0']);
  assert.throws(() => providerBudgetArgs({ maxRequests: null }));
  assert.notEqual(parse(unlimited).digest, parsed.digest);
});


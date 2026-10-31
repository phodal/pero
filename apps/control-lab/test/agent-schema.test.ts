import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { AppParameterSchema } from '../../../packages/app-sdk/src/app-use.ts';

test('Agent routes expose only existing experiments and bounded proposals', () => {
  const app = JSON.parse(readFileSync(new URL('../app.json', import.meta.url), 'utf8'));
  const routes = app.contributes.writes as { name: string; schema: Record<string, unknown> }[];
  const step = AppParameterSchema.parse(routes.find(route => route.name === 'experiment-step')!.schema);
  const propose = AppParameterSchema.parse(routes.find(route => route.name === 'propose-candidate')!.schema);
  const experimentId = 'a'.repeat(32);
  for (const action of ['read', 'baseline', 'search-next', 'search', 'cancel', 'lock', 'verify', 'reevaluate'])
    assert.doesNotThrow(() => step.validate({ action, experimentId }));
  for (const document of [
    { action: 'create', experimentId }, { action: 'list', experimentId }, { action: 'read' },
    { action: 'read', experimentId, criteria: { steadyErrorMax: 0.5 } },
    { action: 'search', experimentId, candidateBudget: 30 },
    { action: 'search', experimentId, budget: 2 },
    { action: 'baseline', experimentId, budget: 1 },
    { action: 'search-next', experimentId, candidateBudget: 3 },
    { action: 'read', experimentId, parameters: { horizon: 50 } },
  ]) assert.throws(() => step.validate(document));
  assert.doesNotThrow(() => propose.validate({ action: 'propose', experimentId, parameters: { kp: 3 } }));
  for (const document of [
    { action: 'propose', experimentId, parameters: { horizon: 50 } },
    { action: 'propose', experimentId, parameters: { kp: 3 }, criteria: {} },
  ]) assert.throws(() => propose.validate(document));
});

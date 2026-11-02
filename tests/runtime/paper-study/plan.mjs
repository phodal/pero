// Test-campaign configuration only; not a human identity or product permission.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export function providerEvaluationPlan(value, scene, sourceCommit) {
  assert(value && value.schema === 'paper-study-plan.v1' && value.confirmed === true,
    'Real inference requires a new explicit campaign plan configuration');
  assert.deepEqual(Object.keys(value).sort(), ['schema', 'confirmed', 'authorizationReference', 'sourceCommit', 'endpoint', 'model', 'scenes', 'limits'].sort());
  assert(typeof value.authorizationReference === 'string' && /^[a-zA-Z0-9_-]{8,100}$/.test(value.authorizationReference), 'Use a new plan reference');
  assert(value.sourceCommit === sourceCommit && /^[a-f0-9]{40}$/.test(sourceCommit), 'Plan must identify this frozen source commit');
  const endpoint = new URL(value.endpoint);
  assert(endpoint.protocol === 'https:' && !endpoint.username && !endpoint.password && !endpoint.search && !endpoint.hash,
    'Real provider endpoint must be explicit credential-free HTTPS');
  assert(typeof value.model === 'string' && /^[\w./:-]{1,200}$/.test(value.model), 'Explicit model required');
  assert(Array.isArray(value.scenes) && value.scenes.length && new Set(value.scenes).size === value.scenes.length && value.scenes.includes(scene),
    'Scene is not approved');
  assert.deepEqual(Object.keys(value.limits).sort(), ['maxSessions', 'maxRequests', 'maxTokens', 'perTurnWallTimeMs'].sort());
  for (const name of ['maxSessions', 'maxRequests', 'maxTokens'])
    assert(value.limits[name] === null || (Number.isSafeInteger(value.limits[name]) && value.limits[name] > 0),
      `${name} must be an explicit positive limit or null (no additional limit)`);
  assert(Number.isSafeInteger(value.limits.perTurnWallTimeMs) && value.limits.perTurnWallTimeMs > 0,
    'Explicit positive turn timeout required');
  const normalized = { schema: value.schema, confirmed: value.confirmed, authorizationReference: value.authorizationReference,
    sourceCommit: value.sourceCommit, endpoint: value.endpoint, model: value.model, scenes: [...value.scenes].sort(), limits: { maxSessions: value.limits.maxSessions,
    maxRequests: value.limits.maxRequests, maxTokens: value.limits.maxTokens, perTurnWallTimeMs: value.limits.perTurnWallTimeMs } };
  return Object.freeze({ ...normalized, digest: createHash('sha256').update(JSON.stringify(normalized)).digest('hex') });
}

export function providerBudgetArgs(budget) {
  if (!budget) return [];
  // Both values are required even when explicitly unlimited. The Go owner enforces them.
  for (const name of ['maxRequests', 'maxTokens'])
    assert(budget[name] === null || (Number.isSafeInteger(budget[name]) && budget[name] > 0), `Invalid ${name}`);
  return ['--max-requests', String(budget.maxRequests ?? 0), '--max-tokens', String(budget.maxTokens ?? 0)];
}

export function providerConnectionArgs({ endpoint, model, providerBudget }) {
  return ['--endpoint', endpoint, '--model', model, ...providerBudgetArgs(providerBudget)];
}

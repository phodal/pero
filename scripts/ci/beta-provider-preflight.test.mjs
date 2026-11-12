import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('beta provider preflight does not pass without a live credential', () => {
  const env = { ...process.env };
  delete env.DEEPSEEK_API_KEY;
  delete env.PERO_BETA_LIVE;
  const missing = spawnSync(process.execPath, ['scripts/ci/beta-provider-preflight.mjs'], { env, encoding: 'utf8' });
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /DEEPSEEK_API_KEY/);
  assert.doesNotMatch(missing.stdout, /ready.:true/);
  env.PERO_BETA_LIVE = '1';
  env.DEEPSEEK_API_KEY = 'present-not-used';
  const ready = spawnSync(process.execPath, ['scripts/ci/beta-provider-preflight.mjs'], { env, encoding: 'utf8' });
  assert.equal(ready.status, 0);
  assert.equal(JSON.parse(ready.stdout).credential, 'present');
  assert.doesNotMatch(ready.stdout, /present-not-used/);
});

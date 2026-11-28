import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('App SDK capability client corpus', () => {
  const result = spawnSync(process.execPath, ['--test', 'packages/app-sdk/test/capability-client.test.mjs'], { encoding: 'utf8' });
  if (result.status !== 0) {
    console.log(result.stdout);
    console.error(result.stderr);
  }
  assert.equal(result.status, 0);
});

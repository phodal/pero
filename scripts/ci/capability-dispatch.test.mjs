import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('Electron dispatch corpus runs with the desktop shell', () => {
  const result = spawnSync(process.execPath, ['--experimental-transform-types', '--test', 'desktop/src/main/capability-dispatch.test.ts'], {
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    console.log(result.stdout);
    console.error(result.stderr);
  }
  assert.equal(result.status, 0);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { harnessEnvironment, providerConfiguration } from './harness-environment.ts';

test('provider dotenv configuration: quoted values, process precedence, absent file and credential exclusion', () => {
  const directory = mkdtempSync(join(tmpdir(), 'pero-harness-env-'));
  try {
    const path = join(directory, '.env');
    assert.deepEqual(harnessEnvironment(path, {}), {});
    writeFileSync(path, 'DEEPSEEK_API_KEY="file-key"\nDEEPSEEK_MODEL=custom-model\nGITHUB_KEY=private\nPERO_OPERATOR_TOKEN=private\n');
    assert.deepEqual(harnessEnvironment(path, { DEEPSEEK_API_KEY: 'process-key' }), {
      DEEPSEEK_API_KEY: 'process-key', DEEPSEEK_MODEL: 'custom-model',
    });
    assert.equal(harnessEnvironment(path, { DEEPSEEK_API_KEY: '' }).DEEPSEEK_API_KEY, '');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});


test('provider routes accept HTTPS and loopback, and reject invalid route/model inputs', () => {
  for (const [endpoint, model, valid] of [
    ['https://api.deepseek.com/', 'deepseek-chat', true],
    ['http://127.0.0.1:1234/v1', 'local-model', true],
    ['http://example.com', 'model', false],
    ['https://user:secret@example.com', 'model', false],
    ['https://api.deepseek.com?key=secret', 'model', false],
    ['https://api.deepseek.com', '', false],
    ['https://api.deepseek.com', 'bad model', false],
  ] as const) {
    if (valid) assert.equal(providerConfiguration(endpoint, model).model, model);
    else assert.throws(() => providerConfiguration(endpoint, model));
  }
});

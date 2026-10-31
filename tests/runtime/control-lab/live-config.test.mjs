import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { providerEndpoint } from './live-config.mjs';
test('production endpoint is fixed; fixture rejects real credentials and non-loopback addresses', () => {
  const input = { fixture: true, key: 'local-control-lab-fixture', endpoint: 'http://127.0.0.1:1234/v1', ledger: '/tmp/output/run/ledger', outputRoot: '/tmp/output' };
  assert.equal(providerEndpoint(input), 'http://127.0.0.1:1234/v1');
  for (const change of [{ key: 'not-the-fixture-key' }, { endpoint: 'https://api.deepseek.com' }, { endpoint: 'http://localhost:1234/v1' }, { endpoint: 'http://127.0.0.1:1234/v1?override=1' }, { ledger: '/tmp/output/../other/ledger' }])
    assert.throws(() => providerEndpoint({ ...input, ...change }));
  assert.throws(() => providerEndpoint({ ...input, fixture: false }));
  assert.equal(providerEndpoint({ ...input, key: 'non-fixture-test-value', fixture: false, endpoint: 'https://elsewhere.invalid' }), 'https://api.deepseek.com');
});

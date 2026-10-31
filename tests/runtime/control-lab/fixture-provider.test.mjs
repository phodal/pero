import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import Ajv from 'ajv';
import { startFixtureProvider } from './fixture-provider.mjs';
test('fixture speaks only loopback protocol with the fixed synthetic credential', async () => {
  const provider = await startFixtureProvider('control-design', `sha256:${'a'.repeat(64)}`);
  try {
    const denied = await fetch(`${provider.endpoint}/chat/completions`, { method: 'POST' });
    assert.equal(denied.status, 403);
    const response = await fetch(`${provider.endpoint}/chat/completions`, { method: 'POST', headers: { authorization: 'Bearer local-control-lab-fixture' }, body: JSON.stringify({ max_tokens: 8192, messages: [] }) });
    assert.equal(response.status, 200);
    assert.match(await response.text(), /"name":"skill"/);
    assert.equal(provider.attempts(), 1);
  } finally { await provider.close(); }
});

test('all six fixture requests emit valid current Control Lab tool documents', async () => {
  const provider = await startFixtureProvider('control-design', `sha256:${'b'.repeat(64)}`);
  const manifest = JSON.parse(await readFile(new URL('../../../apps/control-lab/app.json', import.meta.url)));
  const schema = manifest.contributes.writes.find(item => item.name === 'experiment-step').schema;
  const validate = new Ajv().compile(schema);
  const id = 'a'.repeat(32), actions = [];
  try {
    for (let index = 0; index < 6; index++) {
      const response = await fetch(`${provider.endpoint}/chat/completions`, { method: 'POST', headers: { authorization: 'Bearer local-control-lab-fixture' },
        body: JSON.stringify({ max_tokens: 8192, messages: [{ role: 'user', content: `Review Control Lab experiment ${id}` }] }) });
      assert.equal(response.status, 200);
      const first = (await response.text()).split('\n')[0];
      const chunk = JSON.parse(first.slice('data: '.length));
      for (const call of chunk.choices[0].delta.tool_calls) if (call.function.name === 'mcp__pero-app-use__app_write') {
        const args = JSON.parse(call.function.arguments);
        assert.equal(args.app, 'control-lab'); assert.equal(args.tool, 'experiment-step');
        assert.equal(args.document.experimentId, id);
        assert.ok(validate(args.document), JSON.stringify(validate.errors));
        actions.push(args.document.action);
      }
    }
    assert.deepEqual(actions, ['read', 'search', 'read', 'lock', 'verify']);
    assert.equal(provider.attempts(), 6);
  } finally { await provider.close(); }
});

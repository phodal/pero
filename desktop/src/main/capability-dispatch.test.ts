import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import test from 'node:test';
import { capabilityErrorBody, directOperation, dispatchEnvelope } from './capability-dispatch.mjs';

const electron = 'data:text/javascript,export const net = { fetch() { throw new Error("Unexpected Electron HTTP"); } };';
registerHooks({ resolve(specifier, context, nextResolve) {
  return specifier === 'electron' ? { url: electron, shortCircuit: true } : nextResolve(specifier, context);
} });
const { DesktopApps } = await import('./apps.ts');
const cases = JSON.parse(readFileSync(new URL('../../../protocol/fixtures/capability-dispatch/cases.json', import.meta.url), 'utf8'));

test('the shared corpus is the Electron dispatch', () => {
  for (const item of cases) {
    if (item.kind === 'direct') {
      const result = directOperation(item.path, item.body);
      if (item.error) assert.equal(result.error.code, item.error, item.id);
      else assert.equal(result.ok, true, item.id);
      continue;
    }
    const result = dispatchEnvelope(item.body);
    if (item.error) {
      assert.equal(result.ok, false, item.id);
      assert.equal(result.error.code, item.error, item.id);
      assert.equal(capabilityErrorBody(result.error).message, 'Host capability unavailable');
      continue;
    }
    assert.equal(result.ok, true, item.id);
    assert.equal(result.route, item.route, item.id);
    assert.equal(result.owner, item.owner, item.id);
    assert.equal(result.injectOperation, item.injectOperation, item.id);
    assert.deepEqual(result.body, item.forward, item.id);
  }
});

function hostDouble() {
  const commands = [];
  const apps = new DesktopApps(command => {
    commands.push(command);
    apps.accept({ version: 1, kind: 'apps_result', request_id: command.id, text: '', data: { ok: true, value: { state: 'queued' } } });
  }, () => { throw new Error('Private Host result was published'); }, async () => undefined);
  return { apps, commands };
}

test('Electron serves the corpus and does not call the Host for a denied operation', async () => {
  const { apps, commands } = hostDouble();
  try {
    const status = cases.find(item => item.id === 'agent-status');
    const response = await apps.serve(new Request('pero-app://paper-agent/host/capability', {
      method: 'POST', headers: { Origin: 'pero-app://paper-agent', 'Content-Type': 'application/json' },
      body: JSON.stringify(status.body),
    }));
    assert.equal(response.status, 200);
    assert.equal(commands.at(-1).action, 'agentrun');
    assert.deepEqual(commands.at(-1).request, status.forward);

    const lookup = cases.find(item => item.id === 'agent-lookup');
    const looked = await apps.serve(new Request('pero-app://paper-agent/host/capability', {
      method: 'POST', headers: { Origin: 'pero-app://paper-agent' }, body: JSON.stringify(lookup.body),
    }));
    assert.equal(looked.status, 200);
    assert.equal(commands.at(-1).action, 'agentrun');
    assert.deepEqual(commands.at(-1).request, lookup.forward);

    const queries = cases.find(item => item.id === 'research-queries');
    const read = await apps.serve(new Request('pero-app://paper-agent/host/capability', {
      method: 'POST', headers: { Origin: 'pero-app://paper-agent' }, body: JSON.stringify(queries.body),
    }));
    assert.equal(read.status, 200);
    assert.equal(commands.at(-1).action, 'research-assets');
    assert.deepEqual(commands.at(-1).request, queries.forward);

    const science = cases.find(item => item.id === 'agent-science');
    const kernel = await apps.serve(new Request('pero-app://paper-agent/host/capability', {
      method: 'POST', headers: { Origin: 'pero-app://paper-agent' }, body: JSON.stringify(science.body),
    }));
    assert.equal(kernel.status, 200);
    assert.equal(commands.at(-1).action, 'agent');
    assert.deepEqual(commands.at(-1).request, science.forward);

    const automation = cases.find(item => item.id === 'automation-envelope');
    const recipe = await apps.serve(new Request('pero-app://paper-agent/host/capability', {
      method: 'POST', headers: { Origin: 'pero-app://paper-agent' }, body: JSON.stringify(automation.body),
    }));
    assert.equal(recipe.status, 200);
    assert.equal(commands.at(-1).action, 'automation');
    assert.equal(Object.hasOwn(commands.at(-1).request, 'operation'), false);
    assert.deepEqual(commands.at(-1).request, automation.forward);

    const before = commands.length;
    for (const id of ['unknown-capability', 'unknown-operation', 'operation-casing', 'input-array', 'agent-info-envelope', 'automation-operation-field']) {
      const item = cases.find(entry => entry.id === id);
      const denied = await apps.serve(new Request('pero-app://paper-agent/host/capability', {
        method: 'POST', headers: { Origin: 'pero-app://paper-agent' }, body: JSON.stringify(item.body),
      }));
      assert.equal(denied.status, 403, id);
      assert.equal((await denied.json()).code, item.error, id);
    }
    const bypass = await apps.serve(new Request('pero-app://paper-agent/host/app-agent', {
      method: 'POST', headers: { Origin: 'pero-app://paper-agent' }, body: JSON.stringify({ operation: 'science' }),
    }));
    assert.equal(bypass.status, 403);
    assert.equal((await bypass.json()).code, 'unknown_operation');
    const spoofed = await apps.serve(new Request('pero-app://paper-agent/host/capability', {
      method: 'POST', headers: { Origin: 'pero-app://other-app' }, body: JSON.stringify(status.body),
    }));
    assert.equal(spoofed.status, 403);
    assert.equal(await spoofed.text(), 'App origin refused');
    const oversized = await apps.serve(new Request('pero-app://paper-agent/host/capability', {
      method: 'POST', headers: { Origin: 'pero-app://paper-agent' }, body: ' '.repeat(256001),
    }));
    assert.equal(oversized.status, 413);
    assert.equal(commands.length, before);
  } finally { apps.close(); }
});

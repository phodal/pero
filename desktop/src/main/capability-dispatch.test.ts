import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import test from 'node:test';
import { capabilityErrorBody, directOperation, dispatchEnvelope } from './capability-dispatch.mjs';

interface CorpusCase {
  id: string;
  kind: 'direct' | 'envelope';
  body: unknown;
  path?: string;
  route?: string;
  owner?: string;
  injectOperation?: boolean;
  forward?: unknown;
  error?: string;
}

interface HostCommand {
  id: string;
  action: string;
  request?: Record<string, unknown>;
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(label);
  return value;
}

function optionalText(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  return text(value, 'case field');
}

function readCases(value: unknown): CorpusCase[] {
  if (!Array.isArray(value)) throw new Error('capability dispatch corpus');
  return value.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('capability dispatch case');
    const record = item as Record<string, unknown>;
    const kind = record.kind;
    if (typeof record.id !== 'string' || (kind !== 'direct' && kind !== 'envelope')) throw new Error('capability dispatch case');
    return {
      id: record.id,
      kind,
      body: record.body,
      path: optionalText(record.path),
      route: optionalText(record.route),
      owner: optionalText(record.owner),
      injectOperation: typeof record.injectOperation === 'boolean' ? record.injectOperation : undefined,
      forward: record.forward,
      error: optionalText(record.error),
    };
  });
}

function requireCase(id: string): CorpusCase {
  const item = cases.find(entry => entry.id === id);
  if (!item) throw new Error(id);
  return item;
}

function hostCommand(value: object): HostCommand {
  const record = value as Record<string, unknown>;
  if (typeof record.id !== 'string' || typeof record.action !== 'string') throw new Error('Host command');
  const request = record.request;
  if (request !== undefined && (!request || typeof request !== 'object' || Array.isArray(request))) throw new Error('Host request');
  return { id: record.id, action: record.action, request: request as Record<string, unknown> | undefined };
}

const electron = 'data:text/javascript,export const net = { fetch() { throw new Error("Unexpected Electron HTTP"); } };';
registerHooks({ resolve(specifier, context, nextResolve) {
  return specifier === 'electron' ? { url: electron, shortCircuit: true } : nextResolve(specifier, context);
} });
const { DesktopApps } = await import('./apps.ts');
const cases = readCases(JSON.parse(readFileSync(new URL('../../../protocol/fixtures/capability-dispatch/cases.json', import.meta.url), 'utf8')));

test('the shared corpus is the Electron dispatch', () => {
  for (const item of cases) {
    if (item.kind === 'direct') {
      if (typeof item.path !== 'string') throw new Error(item.id);
      const result = directOperation(item.path, item.body);
      if (item.error) {
        assert.equal(result.ok, false, item.id);
        if (!result.ok) assert.equal(result.error.code, item.error, item.id);
      } else assert.equal(result.ok, true, item.id);
      continue;
    }
    const result = dispatchEnvelope(item.body);
    if (item.error) {
      assert.equal(result.ok, false, item.id);
      if (!result.ok) {
        assert.equal(result.error.code, item.error, item.id);
        assert.equal(capabilityErrorBody(result.error).message, 'Host capability unavailable');
      }
      continue;
    }
    assert.equal(result.ok, true, item.id);
    if (result.ok) {
      assert.equal(result.route, item.route, item.id);
      assert.equal(result.owner, item.owner, item.id);
      assert.equal(result.injectOperation, item.injectOperation, item.id);
      assert.deepEqual(result.body, item.forward, item.id);
    }
  }
});

function hostDouble() {
  const commands: HostCommand[] = [];
  const apps = new DesktopApps(command => {
    commands.push(hostCommand(command));
    apps.accept({ version: 1, kind: 'apps_result', request_id: hostCommand(command).id, text: '', data: { ok: true, value: { state: 'queued' } } });
  }, () => { throw new Error('Private Host result was published'); }, async () => undefined);
  return { apps, commands };
}

function latest(commands: HostCommand[]): HostCommand {
  const command = commands.at(-1);
  if (!command) throw new Error('Host was not called');
  return command;
}

test('Electron serves the corpus and does not call the Host for a denied operation', async () => {
  const { apps, commands } = hostDouble();
  try {
    const status = requireCase('agent-status');
    const response = await apps.serve(new Request('pero-app://paper-agent/host/capability', {
      method: 'POST', headers: { Origin: 'pero-app://paper-agent', 'Content-Type': 'application/json' },
      body: JSON.stringify(status.body),
    }));
    assert.equal(response.status, 200);
    assert.equal(latest(commands).action, 'agentrun');
    assert.deepEqual(latest(commands).request, status.forward);

    const lookup = requireCase('agent-lookup');
    const looked = await apps.serve(new Request('pero-app://paper-agent/host/capability', {
      method: 'POST', headers: { Origin: 'pero-app://paper-agent' }, body: JSON.stringify(lookup.body),
    }));
    assert.equal(looked.status, 200);
    assert.equal(latest(commands).action, 'agentrun');
    assert.deepEqual(latest(commands).request, lookup.forward);

    const queries = requireCase('research-queries');
    const read = await apps.serve(new Request('pero-app://paper-agent/host/capability', {
      method: 'POST', headers: { Origin: 'pero-app://paper-agent' }, body: JSON.stringify(queries.body),
    }));
    assert.equal(read.status, 200);
    assert.equal(latest(commands).action, 'research-assets');
    assert.deepEqual(latest(commands).request, queries.forward);

    const science = requireCase('agent-science');
    const kernel = await apps.serve(new Request('pero-app://paper-agent/host/capability', {
      method: 'POST', headers: { Origin: 'pero-app://paper-agent' }, body: JSON.stringify(science.body),
    }));
    assert.equal(kernel.status, 200);
    assert.equal(latest(commands).action, 'agent');
    assert.deepEqual(latest(commands).request, science.forward);

    const automation = requireCase('automation-envelope');
    const recipe = await apps.serve(new Request('pero-app://paper-agent/host/capability', {
      method: 'POST', headers: { Origin: 'pero-app://paper-agent' }, body: JSON.stringify(automation.body),
    }));
    assert.equal(recipe.status, 200);
    const forwarded = latest(commands);
    assert.equal(forwarded.action, 'automation');
    assert.equal(forwarded.request !== undefined && Object.hasOwn(forwarded.request, 'operation'), false);
    assert.deepEqual(forwarded.request, automation.forward);

    const before = commands.length;
    for (const id of ['unknown-capability', 'unknown-operation', 'operation-casing', 'input-array', 'agent-info-envelope', 'automation-operation-field']) {
      const item = requireCase(id);
      const denied = await apps.serve(new Request('pero-app://paper-agent/host/capability', {
        method: 'POST', headers: { Origin: 'pero-app://paper-agent' }, body: JSON.stringify(item.body),
      }));
      assert.equal(denied.status, 403, id);
      const payload: unknown = await denied.json();
      assert.equal(payload !== null && typeof payload === 'object' && 'code' in payload && payload.code, item.error, id);
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

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const electron = 'data:text/javascript,export const BrowserWindow = class {}; export const ipcMain = {}; export const nativeTheme = { shouldUseDarkColors: false }; export const session = {}; export const net = { fetch() { throw new Error("Unexpected backend proxy"); } }; export const dialog = { showMessageBox(...args) { return globalThis.__reproductionDialog(...args); } };';
registerHooks({ resolve(specifier, context, nextResolve) {
  return specifier === 'electron' ? { url: electron, shortCircuit: true } : nextResolve(specifier, context);
} });
const { DesktopApps } = await import('./apps.ts');
const { confirmNativeReproduction: confirmReproduction } = await import('./reproduction-approval.ts');
const ids = { itemId: 'a'.repeat(64), specId: 'b'.repeat(64), requestId: 'run-1' };
const ticket = 'c'.repeat(64), bindingDigest = 'd'.repeat(64);
const prepared = { state: 'requires-approval', ticket, bindingDigest, summary: 'Fixed fixture; 2 seconds; CPU only. Not a paper reproduction.' };
type HostRequest = { operation: string; [key: string]: unknown };
type Confirm = (summary: string, signal: AbortSignal) => Promise<boolean>;

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function harness(confirm?: Confirm, respond?: (request: HostRequest) => unknown | Promise<unknown>) {
  const commands: HostRequest[] = [];
  let outcome: unknown;
  const apps = new DesktopApps(command => {
    const raw = command as { id: string; action: string; name: string; request: HostRequest };
    assert.equal(raw.action, 'reproduction'); assert.equal(raw.name, 'paper-agent');
    commands.push(raw.request);
    Promise.resolve().then(() => respond ? respond(raw.request) : (() => {
      if (raw.request.operation === 'prepare') return outcome ?? prepared;
      outcome = { state: raw.request.operation === 'decide' && raw.request.decision === 'allow' ? 'starting' : 'cancelled',
        ...ids, paperVerdict: 'INCONCLUSIVE', ticket, bindingDigest, privateCapability: 'must-not-escape' };
      return outcome;
    })()).then(value => apps.accept({ version: 1, kind: 'apps_result', request_id: raw.id,
      text: '', data: { ok: true, value } }), error => apps.accept({ version: 1, kind: 'apps_result', request_id: raw.id,
      text: '', data: { ok: false, error: String(error) } }));
  }, () => assert.fail('Private Host event reached renderer'), async () => undefined, undefined, undefined, confirm);
  const post = (operation = 'request', extra: Record<string, unknown> = {}) => apps.serve(new Request('pero-app://paper-agent/host/reproduction', {
    method: 'POST', headers: { Origin: 'pero-app://paper-agent' }, body: JSON.stringify({ operation, ...ids, ...extra }),
  }));
  return { apps, commands, post };
}

test('direct numerical approval needs no Agent and preserves private ticket and frozen decision', async () => {
  let prompts = 0;
  const h = harness(async (summary, signal) => { prompts++; assert.equal(summary, prepared.summary); assert.equal(signal.aborted, false); return true; });
  try {
    const response = await h.post();
    assert.equal(response.status, 200); assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual(await response.json(), { state: 'starting', ...ids, paperVerdict: 'INCONCLUSIVE' });
    assert.deepEqual(h.commands, [{ operation: 'prepare', ...ids },
      { operation: 'decide', ...ids, ticket, bindingDigest, decision: 'allow' }]);
    assert.equal((await (await h.post()).json()).state, 'starting');
    assert.equal(prompts, 1); // Host terminal/repeated request status does not ask again.
  } finally { h.apps.close(); }
});

test('same concurrent request shares one native prompt; conflicting identity cannot replace it', async () => {
  const shown = deferred<void>(), answer = deferred<boolean>();
  let prompts = 0;
  const h = harness(async () => { prompts++; shown.resolve(undefined); return answer.promise; });
  try {
    const first = h.post(); await shown.promise;
    const second = h.post();
    const wrong = await h.post('request', { specId: 'f'.repeat(64) });
    assert.equal(wrong.status, 503);
    answer.resolve(true);
    assert.equal((await (await first).json()).state, 'starting');
    assert.equal((await (await second).json()).state, 'starting');
    assert.equal(prompts, 1); assert.equal(h.commands.filter(c => c.operation === 'decide').length, 1);
  } finally { h.apps.close(); }
});

test('deny, cancelled modal and late allow after close never dispatch allow', async () => {
  for (const mode of ['deny', 'cancel', 'close', 'failed-dialog']) {
    const shown = deferred<void>(), answer = deferred<boolean>();
    let signal: AbortSignal | undefined;
    const h = harness(async (_summary, value) => {
      signal = value; shown.resolve(undefined);
      if (mode === 'deny') return false;
      if (mode === 'failed-dialog') throw new Error('dialog failed');
      return answer.promise;
    });
    try {
      const response = h.post(); await shown.promise;
      if (mode === 'cancel') assert.equal((await (await h.post('cancel')).json()).state, 'cancelled');
      if (mode === 'close') h.apps.close();
      if (mode === 'cancel' || mode === 'close') assert.equal(signal?.aborted, true);
      answer.resolve(true);
      const returned = await response;
      assert.equal(returned.status, 200);
      assert.equal((await returned.json()).state, 'cancelled');
      assert.equal(h.commands.filter(c => c.operation === 'decide').length, 1);
      assert.equal(h.commands.find(c => c.operation === 'decide')?.decision, 'deny');
    } finally { h.apps.close(); }
  }
});

test('cancel before prepare returns still denies a late private ticket without opening modal', async () => {
  const waiting = deferred<void>(), preparedReply = deferred<unknown>();
  const h = harness(async () => assert.fail('Cancelled request opened native confirmation'), request => {
    if (request.operation === 'prepare') { waiting.resolve(undefined); return preparedReply.promise; }
    return { state: 'cancelled', ...ids };
  });
  try {
    const first = h.post(); await waiting.promise;
    assert.equal((await (await h.post('cancel')).json()).state, 'cancelled');
    preparedReply.resolve(prepared);
    assert.equal((await (await first).json()).state, 'cancelled');
    assert.deepEqual(h.commands.map(c => [c.operation, c.decision]), [['prepare', undefined], ['cancel', undefined], ['decide', 'deny']]);
  } finally { h.apps.close(); }
});

test('cancel after allow dispatch reaches the execution owner instead of replaying the allow result', async () => {
  const dispatched = deferred<void>(), startReply = deferred<unknown>();
  const h = harness(async () => true, request => {
    if (request.operation === 'prepare') return prepared;
    if (request.operation === 'decide') { dispatched.resolve(undefined); return startReply.promise; }
    return { state: 'cancelled', ...ids };
  });
  try {
    const first = h.post(); await dispatched.promise;
    assert.equal((await (await h.post('cancel')).json()).state, 'cancelled');
    assert.equal(h.commands.at(-1)?.operation, 'cancel');
    startReply.resolve({ state: 'starting', ...ids });
    await first;
    assert.equal(h.commands.filter(c => c.operation === 'decide').length, 1);
  } finally { h.apps.close(); }
});

test('unknown remains a status and caller approval or execution fields cannot cross the boundary', async () => {
  const h = harness(async () => assert.fail('Unknown attempt must not ask to replay'), () => ({ state: 'unknown', ...ids, ticket }));
  try {
    assert.deepEqual(await (await h.post()).json(), { state: 'unknown', ...ids });
    const before = h.commands.length;
    for (const extra of [{ approved: true }, { ticket }, { bindingDigest }, { decision: 'allow' },
      { operation: 'decide' }, { operation: 'prepare' }, { path: '/tmp/python' }, { budget: 500 }, { requestId: '' }]) {
      assert.equal((await h.post('request', extra)).status, 400);
    }
    for (const path of ['/api/reproduction/start', '/api/reproduction/host', '/api/reproduction/%68ost', '/api/reproduction/a/../start']) {
      assert.equal((await h.apps.serve(new Request(`pero-app://paper-agent${path}`, { method: 'POST', body: '{}' }))).status, 403);
    }
    assert.equal((await h.apps.serve(new Request('pero-app://other/host/reproduction', { method: 'POST', body: '{}' }))).status, 403);
    assert.equal((await h.apps.serve(new Request('pero-app://paper-agent/host/reproduction'))).status, 405);
    assert.equal((await h.apps.serve(new Request('pero-app://paper-agent/host/reproduction', {
      method: 'POST', headers: { Origin: 'pero-app://other' }, body: '{}',
    }))).status, 403);
    assert.equal(h.commands.length, before);
  } finally { h.apps.close(); }
});

test('unavailable native confirmation or malformed Host prompt fails closed without reflecting secrets', async () => {
  const absent = harness();
  assert.equal((await absent.post()).status, 503); assert.equal(absent.commands.length, 0); absent.apps.close();
  for (const reply of [{ ...prepared, ticket: 'invalid-private-secret' }, { ...prepared, summary: '' }]) {
    const h = harness(async () => assert.fail('Invalid prompt was displayed'), () => reply);
    try {
      const response = await h.post(); assert.equal(response.status, 503);
      assert.doesNotMatch(await response.text(), /private-secret|cccccccc|dddddddd/);
      assert.equal(h.commands.filter(c => c.operation === 'decide').length, 0);
    } finally { h.apps.close(); }
  }
});

test('native main-process dialog defaults to deny and aborts on window close', async () => {
  const global = globalThis as typeof globalThis & { __reproductionDialog?: (window: unknown, options: Record<string, unknown>) => Promise<{ response: number }> };
  const window = new EventEmitter() as EventEmitter & { isDestroyed(): boolean };
  let destroyed = false; window.isDestroyed = () => destroyed;
  const answer = deferred<{ response: number }>();
  let options: Record<string, unknown> | undefined;
  global.__reproductionDialog = async (_window, value) => { options = value; return answer.promise; };
  try {
    const result = confirmReproduction(window as never, prepared.summary, new AbortController().signal);
    assert.equal(options?.detail, prepared.summary); assert.equal(options?.defaultId, 0); assert.equal(options?.cancelId, 0);
    assert.deepEqual(options?.buttons, ['Cancel', 'Run once']);
    window.emit('close', { preventDefault() {} });
    assert.equal(destroyed, false); // Revoke even if another close handler keeps the owner alive.
    assert.equal((options?.signal as AbortSignal).aborted, true);
    answer.resolve({ response: 1 }); assert.equal(await result, false);
    destroyed = true; window.emit('closed');
    assert.equal(window.listenerCount('close'), 0);
    assert.equal(window.listenerCount('closed'), 0);
  } finally { delete global.__reproductionDialog; }
});

// Exercise the actual IPC handler bodies without starting Electron or a Host.
// This is a contract test, not evidence of a real native-dialog journey.
test('both renderer session IPC handlers cannot select the private Apps reproduction action', async () => {
  for (const [file, channel] of [['index.ts', 'pero:session'], ['product.ts', 'product:session']]) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    const start = source.indexOf(`ipcMain.handle('${channel}', `);
    assert.ok(start >= 0);
    const bodyStart = start + `ipcMain.handle('${channel}', `.length;
    const end = source.indexOf('\n  });', bodyStart);
    const callback = stripTypeScriptTypes(`(${source.slice(bodyStart, end)}\n  })`);
    const writes: Record<string, unknown>[] = [];
    const handler = new Function('trusted', 'waitUntilReady', 'ready', 'product', 'appUse', 'host', `return ${callback}`)(
      () => {}, async () => true, true, { chat: true }, undefined,
      { stdin: { write(line: string) { writes.push(JSON.parse(line)); } } });
    for (const operation of ['prepare', 'decide', 'cancel']) {
      await assert.rejects(handler({}, { method: 'apps', action: 'reproduction', name: 'paper-agent',
        request: { operation, ...ids, ticket, bindingDigest, decision: 'allow' } }), /Invalid session command/);
    }
    assert.equal(writes.length, 0);
    // Existing OR allowlist admits these mixed envelopes, but does not rewrite
    // their dispatch selector. The actual Host Apps enum rejects list_agents;
    // settings.workbench retains its selector; Rust separately tests enum rejection.
    await handler({}, { method: 'apps', action: 'list_agents' });
    await handler({}, { method: 'settings.workbench', action: 'reproduction', operation: 'decide' });
    assert.deepEqual(writes, [{ method: 'apps', action: 'list_agents' },
      { method: 'settings.workbench', action: 'reproduction', operation: 'decide' }]);
    assert.match(source, /if \(apps.accept\(message\)\) return;/);
  }
});

test('public Apps IPC refuses private actions and swallows unmatched private replies', async () => {
  const writes: object[] = [], events: unknown[] = [];
  const apps = new DesktopApps(value => writes.push(value), value => events.push(value), async () => undefined);
  for (const action of ['reproduction', 'apps_reproduction', 'prepare', 'decide']) {
    await apps.command({ action, method: 'apps', name: 'paper-agent', request: { operation: 'prepare', ...ids } });
  }
  assert.equal(writes.length, 0);
  assert.equal(events.length, 4);
  assert.ok(events.every(value => (value as {kind: string}).kind === 'apps_error'));
  assert.equal(apps.accept({ version: 1, kind: 'apps_result', request_id: 'renderer-forged', text: '',
    data: { ok: true, value: prepared } }), true);
  assert.equal(events.length, 4);
  apps.close();
});


test('unexpected owner destruction retains the closed-event cancellation fallback contract', async () => {
  const global = globalThis as typeof globalThis & { __reproductionDialog?: (window: unknown, options: Record<string, unknown>) => Promise<{ response: number }> };
  const window = new EventEmitter() as EventEmitter & { isDestroyed(): boolean };
  let destroyed = false; window.isDestroyed = () => destroyed;
  const answer = deferred<{ response: number }>();
  let signal: AbortSignal | undefined;
  global.__reproductionDialog = async (_window, options) => { signal = options.signal as AbortSignal; return answer.promise; };
  try {
    const result = confirmReproduction(window as never, prepared.summary, new AbortController().signal);
    destroyed = true; window.emit('closed');
    assert.equal(signal?.aborted, true);
    answer.resolve({ response: 1 }); assert.equal(await result, false);
    assert.equal(window.listenerCount('close'), 0); assert.equal(window.listenerCount('closed'), 0);
  } finally { delete global.__reproductionDialog; }
});

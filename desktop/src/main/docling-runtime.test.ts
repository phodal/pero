import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { registerHooks } from 'node:module';
import test from 'node:test';
const electron = 'data:text/javascript,export const net = {}; export const dialog = { showMessageBox(...args) { return globalThis.__doclingDialog(...args); } };';
registerHooks({ resolve(specifier, context, next) { return specifier === 'electron' ? { url: electron, shortCircuit: true } : next(specifier, context); } });
const { DoclingSetup, doclingInput, doclingStatus } = await import('./docling-runtime.ts');
const { confirmDoclingSetup } = await import('./docling-runtime-dialog.ts');
const { DesktopApps } = await import('./apps.ts');
const prompt = { state: 'requires-approval', component: 'software', ticket: 'secret-ticket', summary: 'Software: fixed version, source, SHA-256 and disk estimate.' };
const status = { state: 'installing', software: 'missing', model: 'missing', component: 'software', message: 'Installing', installerSupported: true, softwareApproved: false, modelApproved: false };
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };

test('App can request fixed components, never approval, arbitrary URLs or tickets', () => {
  for (const value of [{ operation: 'install', ticket: 'fake' }, { operation: 'prepare', component: 'model' }, { operation: 'request', component: 'other' }, { operation: 'request', component: 'software', approved: true }, { operation: 'status', ticket: 'secret' }, null]) assert.throws(() => doclingInput(value));
  for (const value of [{ operation: 'status' }, { operation: 'cancel' }, { operation: 'revoke' }, { operation: 'request', component: 'software' }, { operation: 'request', component: 'model' }]) assert.deepEqual(doclingInput(value), value);
  assert.deepEqual(doclingStatus({ ...status, ticket: 'secret', summary: 'private', root: '/private' }), status);
  for (const profile of ['linux-x86_64-cp312', 'macos-arm64-cp312', null]) {
    assert.deepEqual(doclingStatus({ ...status, profile, ticket: 'secret' }), { ...status, profile });
  }
});

test('only native confirmation can exchange Host ticket for installation', async () => {
  for (const allow of [false, true]) {
    const operations: object[] = [];
    const setup = new DoclingSetup(async request => { operations.push(request); return (request as any).operation === 'prepare' ? prompt : status; }, async summary => { assert.equal(summary, prompt.summary); return allow; });
    assert.deepEqual(await setup.apply({ operation: 'request', component: 'software' }), status);
    assert.deepEqual(operations, [{ operation: 'prepare', component: 'software' }, allow ? { operation: 'install', ticket: prompt.ticket } : { operation: 'cancel' }]);
  }
});

test('repeated requests share one prompt; cancel and owner close discard late approval', async () => {
  for (const stop of ['cancel', 'close'] as const) {
    const shown = deferred<void>(), answer = deferred<boolean>();
    const operations: string[] = []; let prompts = 0;
    const setup = new DoclingSetup(async request => { const operation = (request as any).operation; operations.push(operation); return operation === 'prepare' ? prompt : status; }, async (_summary, signal) => { prompts++; shown.resolve(); await answer.promise; assert.equal(signal.aborted, true); return true; });
    const first = setup.apply({ operation: 'request', component: 'software' });
    const second = setup.apply({ operation: 'request', component: 'software' });
    await shown.promise;
    await assert.rejects(setup.apply({ operation: 'request', component: 'model' }), /current component/);
    if (stop === 'close') setup.close(); else await setup.apply({ operation: stop });
    await Promise.all([first, second]); answer.resolve(true);
    assert.equal(prompts, 1); assert.ok(!operations.includes('install'));
  }
});

test('Paper route rejects wrong origins and private protocol fields before touching Host', async () => {
  const apps = new DesktopApps(() => assert.fail('Host must not receive invalid requests'), () => {}, async () => undefined);
  for (const [origin, body, expected] of [['pero-app://other', { operation: 'status' }, 403], ['', { operation: 'status' }, 403], ['pero-app://paper-agent', { operation: 'install', ticket: 'forged' }, 400], ['pero-app://paper-agent', { operation: 'request', component: 'software', approve: true }, 400]] as const) {
    const response = await apps.serve(new Request('pero-app://paper-agent/host/docling-runtime', { method: 'POST', headers: { Origin: origin }, body: JSON.stringify(body) }));
    assert.equal(response.status, expected);
  }
  apps.close();
});

test('native confirmation defaults to Cancel and denies owner close and abort', async () => {
  for (const mode of ['allow', 'cancel', 'close', 'abort'] as const) {
    const owner = Object.assign(new EventEmitter(), { isDestroyed: () => false });
    const controller = new AbortController();
    (globalThis as any).__doclingDialog = async (_window: unknown, options: any) => {
      assert.equal(options.defaultId, 0); assert.equal(options.cancelId, 0);
      assert.ok(options.detail.includes(prompt.summary));
      if (mode === 'close') owner.emit('close');
      if (mode === 'abort') controller.abort();
      return { response: mode === 'cancel' ? 0 : 1 };
    };
    assert.equal(await confirmDoclingSetup(owner as any, prompt.summary, controller.signal), mode === 'allow');
    assert.equal(owner.listenerCount('close'), 0);
  }
});

test('disabling OCR requires its own native confirmation and preserves files in the notice', async () => {
  for (const allow of [false, true]) {
    const operations: string[] = [];
    const setup = new DoclingSetup(async request => { operations.push((request as any).operation); return status; }, async (summary, _signal, operation) => {
      assert.equal(operation, 'revoke'); assert.match(summary, /Downloaded files are retained/); return allow;
    });
    await setup.apply({ operation: 'revoke' });
    assert.deepEqual(operations, ['cancel', allow ? 'revoke' : 'status']);
  }
});

test('Paper route exposes status only after private confirmation, not capability material', async () => {
  const operations: string[] = [];
  const apps = new DesktopApps(command => {
    const raw = command as { id: string; action: string; name: string; request: { operation: string } };
    assert.equal(raw.action, 'doclingruntime'); assert.equal(raw.name, 'paper-agent');
    operations.push(raw.request.operation);
    apps.accept({ version: 1, kind: 'apps_result', request_id: raw.id, text: '', data: { ok: true, value: raw.request.operation === 'prepare' ? prompt : { ...status, ticket: 'secret' } } });
  }, () => assert.fail('Private response leaked'), async () => undefined, undefined, undefined, undefined, async () => true);
  const response = await apps.serve(new Request('pero-app://paper-agent/host/docling-runtime', { method: 'POST', headers: { Origin: 'pero-app://paper-agent' }, body: JSON.stringify({ operation: 'request', component: 'software' }) }));
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), status); assert.deepEqual(operations, ['prepare', 'install']);
  apps.close();
});

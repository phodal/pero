import test from 'node:test';
import assert from 'node:assert/strict';
import { listInstalledAppViews } from '../src/installed-app-views.ts';

const declaration = { app: 'control-lab', title: 'Control Lab', version: '1.0', revision: 'a'.repeat(64), enabled: true,
  panels: [{ id: 'main', title: 'Experiments' }], actions: [{ name: 'read', description: 'Read an experiment' }] };

test('installed view discovery uses only current Host declarations and never exposes routing or secrets', async t => {
  let context = { appViews: [{ ...declaration, root: '/private/app', backend: { token: 'not-public' },
    panels: [{ ...declaration.panels[0], entry: 'dist/index.html' }], actions: [{ ...declaration.actions[0], path: '/api/read' }] }] };
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (path, options) => { calls.push([path, options]); return Response.json(context); });
  const controller = new AbortController();
  assert.deepEqual(await listInstalledAppViews(controller.signal), [declaration]);
  assert.deepEqual(calls, [['/host/sdk', { signal: controller.signal, cache: 'no-store' }]]);
  context = { appViews: [] };
  assert.deepEqual(await listInstalledAppViews(), [], 'Removed Apps disappear only in a new Host snapshot');
  context = { appViews: [{ ...declaration, enabled: false }] };
  assert.equal((await listInstalledAppViews())[0].enabled, false);
});

test('older, failed and malformed Host catalogs never become an empty availability claim', async t => {
  let context, ok = true;
  t.mock.method(globalThis, 'fetch', async () => ok ? Response.json(context) : new Response('Unavailable', { status: 503 }));
  for (const value of [{ name: 'notebook' }, null, { appViews: null }]) {
    context = value; await assert.rejects(listInstalledAppViews(), /does not expose/);
  }
  for (const value of [
    { ...declaration, app: 'https://example.org' }, { ...declaration, enabled: 'true' },
    { ...declaration, revision: 'not-a-revision' }, { ...declaration, panels: [{ id: '../main', title: 'Unsafe' }] },
    { ...declaration, actions: [{ name: 'execute()', description: 'Unsafe' }] }, null,
  ]) { context = { appViews: [value] }; await assert.rejects(listInstalledAppViews(), /invalid installed/); }
  context = { appViews: [declaration, declaration] };
  await assert.rejects(listInstalledAppViews(), /invalid installed/);
  ok = false;
  await assert.rejects(listInstalledAppViews(), /unavailable/);
});

test('catalog cancellation aborts the read rather than returning a successful empty catalog', async t => {
  const controller = new AbortController();
  t.mock.method(globalThis, 'fetch', async (_path, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  }));
  const request = listInstalledAppViews(controller.signal);
  controller.abort();
  await assert.rejects(request, { name: 'AbortError' });
});

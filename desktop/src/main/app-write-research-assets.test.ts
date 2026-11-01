import assert from 'node:assert/strict';
import test from 'node:test';
import { AppWriteRoutes } from './app-write-routes.ts';
import { PreparedAppWrite, type AppWriteDefinition } from './app-write.ts';

const definition: AppWriteDefinition = {
  app: 'paper-agent', panel: 'main', version: '1', name: 'research-assets',
  path: '/api/research/assets', description: 'Approved research assets',
  schema: { type: 'object', properties: {
    operation: { type: 'string', enum: ['start', 'status', 'cancel'] },
    bundleId: { type: 'string' }, assetId: { type: 'string' },
  }, required: ['operation', 'bundleId'], additionalProperties: false },
};

test('both Agent shell adapters delegate the declared research write to the same Host authority', async () => {
  const effects: Array<{ action: string; fields?: Record<string, unknown> }> = [];
  const events: unknown[] = [];
  let enabled = true;
  let denied = false;
  const { app, panel, version, ...write } = definition;
  const routes = new AppWriteRoutes(async <T>(action: string, fields?: Record<string, unknown>) => {
    if (action === 'list') return [{ name: app, version, enabled, panels: [{ id: panel }], writes: [write] }] as T;
    effects.push({ action, fields });
    if (denied) throw new Error('This App cannot call that Host command');
    return { state: 'queued' } as T;
  }, event => { events.push(event); }, async () => { throw new Error('Research effects must stay in Rust Host'); });
  for (const operation of ['start', 'status', 'cancel']) {
    const document = { operation, bundleId: 'a'.repeat(64), assetId: 'b'.repeat(64) };
    const prepared = new PreparedAppWrite(definition, document);
    assert.deepEqual(await routes.apply(prepared, new AbortController().signal), { state: 'queued' });
    assert.deepEqual(effects.at(-1), { action: 'research-assets', fields: { name: 'paper-agent', request: document } });
    assert.deepEqual(events.at(-1), { version: 1, kind: 'app_written', request_id: null, text: '',
      data: { app: 'paper-agent', tool: 'research-assets', digest: prepared.digest } });
  }
  const prepared = new PreparedAppWrite(definition, { operation: 'status', bundleId: 'a'.repeat(64) });
  const cancelled = new AbortController(); cancelled.abort();
  await assert.rejects(routes.apply(prepared, cancelled.signal), { name: 'AbortError' });
  enabled = false;
  await assert.rejects(routes.apply(prepared, new AbortController().signal), /changed/);
  assert.equal(effects.length, 3);
  enabled = true; denied = true;
  await assert.rejects(routes.apply(prepared, new AbortController().signal), /cannot call/);
  assert.equal(events.length, 3);
});

test('dispatched research writes stop waiting on cancellation without claiming rollback', async () => {
  const controller = new AbortController();
  let finish!: (value: unknown) => void;
  let writes = 0;
  const { app, panel, version, ...write } = definition;
  const routes = new AppWriteRoutes(async <T>(action: string) => {
    if (action === 'list') return [{ name: app, version, enabled: true, panels: [{ id: panel }], writes: [write] }] as T;
    return await new Promise<unknown>(resolve => { finish = resolve; controller.abort(); }) as T;
  }, () => { writes++; }, async () => { throw new Error('Unexpected HTTP'); });
  const prepared = new PreparedAppWrite(definition, { operation: 'start', bundleId: 'a'.repeat(64), assetId: 'b'.repeat(64) });
  await assert.rejects(routes.apply(prepared, controller.signal), /after dispatch.*Check status and cancel/);
  finish({ state: 'queued' });
  await Promise.resolve();
  assert.equal(writes, 0);
});

test('research writes retain the existing AppWrite receipt limit', async () => {
  const { app, panel, version, ...write } = definition;
  const routes = new AppWriteRoutes(async <T>(action: string) => {
    if (action === 'list') return [{ name: app, version, enabled: true, panels: [{ id: panel }], writes: [write] }] as T;
    return { extra: 'x'.repeat(1000000) } as T;
  }, () => { throw new Error('Oversized receipt must not be published'); }, async () => { throw new Error('Unexpected HTTP'); });
  const prepared = new PreparedAppWrite(definition, { operation: 'status', bundleId: 'a'.repeat(64) });
  await assert.rejects(routes.apply(prepared, new AbortController().signal), /response exceeds/);
});


test('research App routes require the matching Host goal and inject its frozen digest', async () => {
  const id = 'a'.repeat(32), hash = 'b'.repeat(64);
  for (const app of ['control-lab', 'lab'] as const) {
    const route = { app, panel: 'main', version: '1', name: 'experiment-step', description: '', path: '/api/agent-step',
      schema: { type: 'object', properties: { action: { type: 'string' }, experimentId: { type: 'string' } }, required: ['action', 'experimentId'], additionalProperties: false } };
    const { panel, version, ...write } = route;
    const sent: unknown[] = [];
    const routes = new AppWriteRoutes(async <T>(action: string) => {
      if (action === 'list') return [{ name: app, version, enabled: true, panels: [{ id: panel }], writes: [write] }] as T;
      return { backend: { url: 'http://unused.invalid', token: 'fixture-only' } } as T;
    }, () => {}, async (_url, init) => { sent.push(JSON.parse(String(init.body))); return new Response('{}'); });
    const document = { action: 'read', experimentId: id }, prepared = new PreparedAppWrite(route, document);
    const goal = { app, experimentId: id, specHash: hash, maxExperiments: 1 as const };
    await assert.rejects(routes.apply(prepared, new AbortController().signal), /goal is required/);
    await assert.rejects(routes.apply(prepared, new AbortController().signal, { ...goal, app: app === 'lab' ? 'control-lab' : 'lab' }), /goal is required/);
    assert.equal(sent.length, 0);
    await routes.apply(prepared, new AbortController().signal, goal);
    assert.deepEqual(sent, [{ ...document, specHash: hash }]);
    assert.deepEqual(prepared.document, document);
    assert.throws(() => new PreparedAppWrite(route, { ...document, specHash: 'agent-supplied' }), /specHash/);
  }
});

test('Only the declared Paper image operation admits a bounded base64 response', async () => {
  const { SOURCE_IMAGE_RESPONSE_BYTES } = await import('./paper-source-image.ts');
  const imageRoute = { app: 'paper-agent', panel: 'main', version: '1', name: 'research-source-read', description: '', path: '/api/research/source-read', schema: {
    type: 'object', properties: { operation: { type: 'string', enum: ['read', 'image'] }, memberId: { type: 'string' } }, required: ['operation', 'memberId'], additionalProperties: false,
  } };
  let body = JSON.stringify({ data: 'x'.repeat(1000000) }), receipts = 0, cancelled = false;
  const { app, panel, version, ...write } = imageRoute;
  const routes = new AppWriteRoutes(async <T>(action: string) => {
    if (action === 'list') return [{ name: app, version, enabled: true, panels: [{ id: panel }], writes: [write] }] as T;
    return { backend: { url: 'http://unused.invalid', token: 'fixture-only' } } as T;
  }, () => { receipts++; }, async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode(body)); }, cancel() { cancelled = true; },
    pull(controller) { if (body.length <= SOURCE_IMAGE_RESPONSE_BYTES) controller.close(); },
  })));
  const image = new PreparedAppWrite(imageRoute, { operation: 'image', memberId: 'a'.repeat(64) });
  assert.equal((await routes.apply(image, new AbortController().signal) as { data: string }).data.length, 1000000);
  assert.equal(receipts, 1);
  await assert.rejects(routes.apply(new PreparedAppWrite(imageRoute, { operation: 'read', memberId: 'a'.repeat(64) }), new AbortController().signal), /response exceeds 1 MiB/);
  body = 'x'.repeat(SOURCE_IMAGE_RESPONSE_BYTES + 1); cancelled = false;
  await assert.rejects(routes.apply(image, new AbortController().signal), /bounded PNG envelope/);
  assert.equal(cancelled, true); assert.equal(receipts, 1, 'oversized responses do not publish successful receipts');
});

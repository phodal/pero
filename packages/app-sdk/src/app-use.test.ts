import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AppSurface, AppUseDom, AppUseError, installAppUseBridge, type AppObject } from './app-use.ts';

const object = (state: unknown, actions: AppObject['actions'] = {}): AppObject => ({ id: 'lab', kind: 'workbench', label: 'Lab', state, actions });
const code = (expected: string) => (error: unknown) => error instanceof AppUseError && error.code === expected;

test('App objects retain revisions for equal values and invoke the latest UI closure', async () => {
  const surface = new AppSurface();
  let applied = '';
  const handle = surface.register(object({ count: 1, nested: { a: true, b: null } }, { choose: { run: () => { applied = 'old'; } } }));
  const first = surface.observe();
  handle.update(object({ nested: { b: null, a: true }, count: 1 }, { choose: { run: () => { applied = 'current'; } } }));
  assert.deepEqual(surface.observe(), first);
  assert.deepEqual(await surface.invoke('lab', 'choose', {}, first.objects[0].revision), { verdict: 'not-run', result: null });
  assert.equal(applied, 'current');
  (first.objects[0].state as Record<string, unknown>).count = 99;
  assert.equal(surface.verify('lab', 'count', 1).verdict, 'pass');
  surface.register({ id: 'other', kind: 'counter', label: 'Other', state: { count: 2 } });
  assert.equal(surface.observe('lab').objects[0].revision, first.objects[0].revision);
  handle.update(object({ count: 3 }, { choose: { run: () => { applied = 'changed'; } } }));
  await assert.rejects(surface.invoke('lab', 'choose', {}, first.objects[0].revision), code('APP_REVISION_STALE'));
  assert.equal(applied, 'current');
  const beforeFrame = surface.observe('lab').objects[0];
  assert.ok(surface.signal('lab') > beforeFrame.revision);
  assert.deepEqual(surface.observe('lab').objects[0].state, beforeFrame.state);
  handle.dispose();
  assert.throws(() => surface.observe('lab'), code('APP_OBJECT_UNKNOWN'));
});

test('Declared schemas govern actions and verification uses only declared own state', async () => {
  const surface = new AppSurface();
  const calls: unknown[] = [];
  const handle = surface.register(object({ status: 'ready', nested: { value: 1 } }, {
    choose: { parameters: { type: 'object', properties: { view: { type: 'string', enum: ['cells', 'volume'] }, count: { type: 'integer', minimum: 1, maximum: 5 } }, required: ['view'], additionalProperties: false }, run: value => { calls.push(value); return { accepted: true }; } },
  }));
  const revision = surface.observe().objects[0].revision;
  for (const params of [{ view: 'hidden' }, { view: 'cells', count: 0 }, { view: 'cells', extra: true }])
    await assert.rejects(surface.invoke('lab', 'choose', params, revision), code('APP_PARAMS_INVALID'));
  assert.equal(calls.length, 0);
  assert.deepEqual(await surface.invoke('lab', 'choose', { view: 'cells', count: 2 }, revision), { verdict: 'not-run', result: { accepted: true } });
  assert.deepEqual(calls, [{ view: 'cells', count: 2 }]);
  for (const [key, expected, verdict, actual] of [
    ['status', 'ready', 'pass', 'ready'], ['status', 'done', 'fail', 'ready'], ['nested', { value: 1 }, 'pass', { value: 1 }], ['constructor', null, 'fail', null],
  ] as const) {
    const result = surface.verify('lab', key, expected);
    assert.equal(result.verdict, verdict);
    assert.deepEqual(result.actual, actual);
  }
  assert.throws(() => handle.update(object({}, { invalid: { parameters: { type: 'object', ignoredConstraint: true }, run: () => {} } })), code('APP_OBJECT_INVALID'));
});

test('App declarations reject ambiguous identities and non-JSON state', () => {
  const surface = new AppSurface();
  surface.register(object({}));
  assert.throws(() => surface.register(object({})), code('APP_OBJECT_DUPLICATE'));
  const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
  for (const state of [{ value: NaN }, cyclic, { value: () => 1 }, { value: 'x'.repeat(32769) }])
    assert.throws(() => new AppSurface().register(object(state)), code('APP_OBJECT_INVALID'));
});

test('Parameter rules enforce the supported JSON Schema subset without generating code', async () => {
  for (const [rule, accepted, rejected] of [
    [{ type: 'array', items: { type: 'integer', minimum: 1, maximum: 3 }, minItems: 1, maxItems: 2 }, [1, 3], [1, 2, 3]],
    [{ type: 'array', items: { type: 'number', minimum: -2, maximum: 2 } }, [1.5], [3]],
    [{ type: 'string', minLength: 1, maxLength: 2 }, '字🙂', 'abc'],
    [{ type: 'boolean' }, true, 'true'],
    [{ type: 'null' }, null, false],
    [{ anyOf: [{ type: 'null' }, { type: 'integer', minimum: 2 }] }, null, 1],
    [{ enum: ['one', 'two'] }, 'two', 'three'],
    [{ type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false }, { ok: true }, { ok: true, other: 1 }],
  ] as const) {
    const surface = new AppSurface();
    surface.register(object({}, { apply: { parameters: { type: 'object', properties: { value: rule }, required: ['value'], additionalProperties: false }, run: params => params.value } }));
    const revision = surface.observe('lab').objects[0].revision;
    assert.deepEqual((await surface.invoke('lab', 'apply', { value: accepted }, revision)).result, accepted);
    await assert.rejects(surface.invoke('lab', 'apply', { value: rejected }, revision), code('APP_PARAMS_INVALID'));
  }
  for (const rule of [
    { type: 'string', pattern: '.*' }, { type: 'string', minLength: 3, maxLength: 1 }, { type: 'array', items: { type: 'integer' }, maxItems: 1001 },
    { type: 'object', required: ['unknown'] }, { type: 'number', exclusiveMinimum: 1 }, { type: 'string', anyOf: [{ type: 'string' }] },
  ]) assert.throws(() => new AppSurface().register(object({}, { apply: { parameters: { type: 'object', properties: { value: rule } }, run: () => {} } })), code('APP_OBJECT_INVALID'));
  for (const parameters of [null, true, []]) assert.throws(() => new AppSurface().register(object({}, { apply: { parameters: parameters as unknown as Record<string, unknown>, run: () => {} } })), code('APP_OBJECT_INVALID'));
});

function documentFixture() {
  class Field {
    tagName = 'INPUT'; type = 'text'; isConnected = true; disabled = false; readOnly = false;
    attributes = new Map<string, string>([['aria-label', 'Title']]);
    ownerDocument!: Document;
    clicks = 0; events: string[] = []; textContent = ''; labels: Element[] = [];
    private storedValue = 'before';
    get value() { return this.storedValue; }
    set value(value: string) { this.storedValue = value; }
    getAttribute(name: string) { return this.attributes.get(name) ?? null; }
    closest() { return null; }
    getClientRects() { return this.isConnected ? [{}] : []; }
    getBoundingClientRect() { return { left: 8, top: 8, right: 308, bottom: 48, width: 300, height: 40 }; }
    click() { ++this.clicks; }
    dispatchEvent(event: Event) { this.events.push(event.type); }
  }
  const field = new Field();
  const document = {
    querySelectorAll: () => [field], getElementById: () => null,
    body: { innerText: 'Lab title', contains: (element: unknown) => element === field, getBoundingClientRect: () => ({ left: 0, top: 0, right: 600, bottom: 400 }) },
    defaultView: { innerWidth: 600, innerHeight: 400, HTMLInputElement: Field, HTMLTextAreaElement: Field, Event },
  } as unknown as Document;
  field.ownerDocument = document;
  return { field, document };
}

test('DOM operations spend observed refs and fill only supported editable text fields', () => {
  const { field, document } = documentFixture();
  const surface = new AppSurface(); surface.register(object({ status: 'ready' }));
  const dom = new AppUseDom(surface, document);
  let observed = dom.observe();
  assert.equal(observed.dom[0].label, 'Title');
  const first = observed;
  observed = dom.observe();
  assert.throws(() => dom.act({ action: 'dom.click', target: first.dom[0].ref, expectedRevisions: first.revisions }), code('APP_REF_STALE'));
  assert.deepEqual(dom.act({ action: 'dom.fill', target: observed.dom[0].ref, params: { value: 'after' }, expectedRevisions: observed.revisions }), { verdict: 'not-run' });
  assert.equal(field.value, 'after');
  assert.deepEqual(field.events, ['input', 'change']);
  assert.throws(() => dom.act({ action: 'dom.click', target: observed.dom[0].ref, expectedRevisions: observed.revisions }), code('APP_REF_STALE'));
  for (const [change, errorCode] of [
    [() => { field.type = 'password'; }, 'APP_TARGET_UNSUPPORTED'],
    [() => { field.type = 'file'; }, 'APP_TARGET_UNSUPPORTED'],
    [() => { field.type = 'text'; field.readOnly = true; }, 'APP_TARGET_READONLY'],
    [() => { field.readOnly = false; field.disabled = true; }, 'APP_TARGET_DISABLED'],
  ] as const) {
    change(); observed = dom.observe();
    assert.throws(() => dom.act({ action: 'dom.fill', target: observed.dom[0].ref, params: { value: 'no' }, expectedRevisions: observed.revisions }), code(errorCode));
    assert.equal(field.value, 'after');
  }
  field.disabled = false; field.type = 'password';
  assert.equal(dom.observe().dom[0].value, '[redacted]');
  field.type = 'text'; observed = dom.observe(); field.attributes.set('aria-label', 'Different');
  assert.throws(() => dom.act({ action: 'dom.click', target: observed.dom[0].ref, expectedRevisions: observed.revisions }), code('APP_REF_STALE'));
});

test('App bridge accepts only its parent and returns structured results and refusals', async () => {
  const { document } = documentFixture();
  const surface = new AppSurface(); surface.register(object({ status: 'ready' }));
  const listeners = new Map<string, (event: any) => Promise<void> | void>();
  const replies: any[] = [];
  const parent = { postMessage: (reply: unknown, origin: string) => { replies.push({ reply, origin }); } };
  const frame = { document, parent, addEventListener: (type: string, callback: any) => listeners.set(type, callback), removeEventListener: (type: string) => listeners.delete(type) } as unknown as Window;
  const stop = installAppUseBridge(surface, frame);
  const send = async (source: unknown, request: unknown) => listeners.get('message')!({ source, origin: 'pero://workbench', data: { type: 'pero:app-use:request', id: 'request-1', request } });
  await send({}, { action: 'observe' });
  assert.equal(replies.length, 0);
  await send(parent, { action: 'verify', target: 'lab', key: 'status', equals: 'ready' });
  assert.deepEqual(replies.at(-1), { reply: { type: 'pero:app-use:result', id: 'request-1', ok: true, value: { verdict: 'pass', actual: 'ready', found: true } }, origin: 'pero://workbench' });
  await send(parent, { action: 'invoke', target: 'lab', name: 'anything' });
  assert.equal(replies.at(-1).reply.error.code, 'APP_USE_INVALID');
  await listeners.get('pointerdown')!({ isTrusted: false });
  assert.equal(replies.length, 2);
  await listeners.get('pointerdown')!({ isTrusted: true });
  assert.equal(replies.at(-1).reply.type, 'pero:app-use:human-input');
  stop(); assert.equal(listeners.size, 0);
});

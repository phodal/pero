import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { createUiRuntime } from '../../../packages/app-sdk/test/ui-test-runtime.mjs';

const initial = { state: 'idle', software: 'missing', model: 'missing', component: null, message: '',
  profile: 'linux-x86_64-cp312', installerSupported: true, softwareApproved: false, modelApproved: false };
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

async function fixture(t, transport) {
  const env = await createUiRuntime(t, {
    resolveDir: resolve(import.meta.dirname, '../ui-src'),
    contents: `export { NumericValues } from './numeric-values';
      export { requestDoclingRuntime } from './docling-runtime';
      export { AppApiProvider, useAppApi } from '@pero/app-sdk';`,
  });
  const { React, ui, render, dom } = env;
  const calls = [], ipcMessages = [];
  let state = { ...initial }, api, failure;
  const receive = body => {
    const intent = JSON.parse(body); calls.push(intent);
    if (failure) return failure();
    if (intent.operation === 'request') state = intent.component === 'software'
      ? { ...state, state: 'installing', component: 'software' }
      : { ...state, state: 'ready', component: null, software: 'ready', model: 'ready', softwareApproved: true, modelApproved: true };
    if (intent.operation === 'cancel') state = { ...state, state: 'cancelled', component: null };
    if (intent.operation === 'revoke') state = { ...state, state: 'revoked', softwareApproved: false, modelApproved: false };
    return json(state);
  };
  t.mock.method(globalThis, 'fetch', async (path, init) => {
    assert.equal(transport, 'electron', 'Native uses only its dedicated body bridge');
    assert.equal(path, '/host/docling-runtime');
    assert.equal(init.method, 'POST');
    assert.equal(new Headers(init.headers).get('content-type'), 'application/json');
    return receive(init.body);
  });
  if (transport === 'native') {
    dom.reconfigure({ url: 'pero-app://paper-agent/dist/index.html' });
    window.ipc = { postMessage: raw => {
      const request = JSON.parse(raw); ipcMessages.push(request);
      assert.equal(request.type, 'pero:docling:request');
      const response = receive(request.body);
      if (response) void response.text().then(body => window.dispatchEvent(new dom.window.MessageEvent('message', {
        source: window, data: { type: 'pero:docling:result', id: request.id, status: response.status, body },
      })));
    } };
    // Execute the shipped bridge, not a duplicate. jsdom has no custom-scheme
    // origin support; trusted frame provenance is covered by the real WK probe.
    runInNewContext(await readFile(resolve(import.meta.dirname, '../../../crates/pero-ui/src/native_docling_bridge.js'), 'utf8'), {
      window, location: { origin: 'pero-app://paper-agent' }, Response, crypto: globalThis.crypto,
      addEventListener: window.addEventListener.bind(window),
    });
  }
  function Reader() {
    api = ui.useAppApi();
    return React.createElement(ui.NumericValues, { api, annotation: { id: 'selected-region' }, onSource() {} });
  }
  const scopedFetch = async path => {
    if (path === '/api/numeric?annotationId=selected-region') return json({ extractions: [], assessments: [], references: [], layouts: [] });
    assert.equal(path, '/api/numeric/layout/status');
    return json({ available: false, reasons: [], provider: 'Docling', version: null, downloadPolicy: 'never' });
  };
  await render(React.createElement(ui.AppApiProvider, {
    appName: 'paper-agent', locale: 'en', allowedApiPaths: ['/api'], allowedEvents: [], fetch: scopedFetch,
    subscribeFn: () => () => {}, navigateFn() {}, notifyFn() {},
  }, React.createElement(Reader)));
  // This is the real useAppApi client provided to NumericValues, not a permissive stub.
  await assert.rejects(api.post('/host/docling-runtime', { operation: 'status' }), /cannot access \/host\/docling-runtime/);
  assert.deepEqual(calls, [], 'The collapsed optional panel makes no Host request');
  await React.act(async () => {
    const details = document.querySelector('.pa-numeric-layout');
    details.open = true; details.dispatchEvent(new dom.window.Event('toggle'));
  });
  const panel = () => document.querySelector('.pa-optional-runtime');
  const button = text => {
    const result = [...panel().querySelectorAll('button')].find(item => item.textContent === text);
    assert.ok(result, `Missing control: ${text}`);
    return result;
  };
  return { ...env, calls, ipcMessages, panel, button, fail: value => { failure = value; } };
}

test('Native Docling bridge rejects pending requests on pagehide and ignores late replies', { timeout: 15_000 }, async t => {
  const { ui, dom, fail, calls, ipcMessages } = await fixture(t, 'native');
  fail(() => null); // An outstanding Host confirmation, with no result yet.
  const pending = ui.requestDoclingRuntime({ operation: 'request', component: 'software' });
  const id = ipcMessages.at(-1).id;
  const rejected = assert.rejects(pending, /Paper document closed/);
  window.dispatchEvent(new dom.window.Event('pagehide'));
  await rejected;
  assert.deepEqual(calls.at(-1), { operation: 'cancel' });
  const before = calls.length;
  window.dispatchEvent(new dom.window.MessageEvent('message', { source: window,
    data: { type: 'pero:docling:result', id, status: 200, body: JSON.stringify({ ...initial, state: 'ready' }) },
  }));
  assert.equal(calls.length, before, 'A late result cannot trigger another Host operation');
  await assert.rejects(pending, /Paper document closed/);
});

for (const transport of ['electron', 'native']) {
  test(`optional Docling UI reaches the fixed ${transport} transport under /api-only App scope`, { timeout: 15_000 }, async t => {
    const { calls, panel, button, click } = await fixture(t, transport);
    assert.deepEqual(calls, [{ operation: 'status' }]);
    assert.match(panel().textContent, /Not installed/);
    await click(button('Install software…'));
    assert.match(panel().textContent, /Installing/);
    await click(button('Cancel current setup'));
    assert.match(panel().textContent, /Cancelled/);
    await click(button('Download model…'));
    assert.match(panel().textContent, /Approved to enable/);
    await click(button('Revoke runtime access…'));
    assert.match(panel().textContent, /Access revoked/);
    assert.deepEqual(calls.filter(intent => intent.operation !== 'status'), [
      { operation: 'request', component: 'software' }, { operation: 'cancel' },
      { operation: 'request', component: 'model' }, { operation: 'revoke' },
    ]);
  });

  test(`optional Docling ${transport} errors stay visible and status refresh recovers`, { timeout: 15_000 }, async t => {
    const { calls, fail, panel, button, click, ui } = await fixture(t, transport);
    for (const [response, message] of [
      [() => json({ detail: 'Host confirmation unavailable' }, 503), /Host confirmation unavailable/],
      [() => json({ error: 'Paper is disabled' }, 403), /Paper is disabled/],
      [() => new Response('upstream unavailable', { status: 502 }), /Docling runtime request failed \(502\)/],
      [() => new Response('not JSON'), /invalid status response/],
      [() => json({}), /invalid status response/],
      [() => { throw new Error('Host connection lost'); }, /Host connection lost/],
    ]) {
      fail(response);
      await click(button('Refresh setup status'));
      assert.match(panel().textContent, message);
      assert.doesNotMatch(panel().textContent, /cannot use the pinned automatic installation profile/, 'A failed status read is not proof of an unsupported platform');
      assert.equal([...panel().querySelectorAll('button')].some(item => item.textContent === 'Install software…'), false);
    }
    fail(null);
    await click(button('Refresh setup status'));
    assert.ok(button('Install software…'));
    assert.doesNotMatch(panel().textContent, /Host connection lost|invalid status response/);
    // Only the named intent fields are sent, even if an untyped caller supplies extras.
    await ui.requestDoclingRuntime({ operation: 'status', approved: true, ticket: 'forged', url: '/host/other' });
    assert.deepEqual(calls.at(-1), { operation: 'status' });
  });
}

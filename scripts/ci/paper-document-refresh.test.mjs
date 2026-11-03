import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deferDocumentRefresh } from '../../tests/e2e/paper-document-refresh-gate.mjs';

test('refresh gate forwards real requests and holds only the actual refresh Response', async () => {
  const previous = globalThis.window;
  const calls = [], response = new Response('{"documentId":"actual"}');
  const original = async (...args) => { calls.push(args); return response; };
  globalThis.window = { fetch: original, location: { href: 'pero-app://paper-agent/dist/index.html' } };
  installPaperFetchObserver();
  try {
    deferDocumentRefresh();
    const options = { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Pero-App-Token': 'actual' }, body: JSON.stringify({ operation: 'prepare', refresh: true, bundleId: 'fixed' }) };
    const pending = window.fetch('/api/paper-document', options);
    await window.paperRefreshGate.ready;
    assert.equal(window.paperRefreshGate.arrived, true);
    assert.equal(window.paperRefreshGate.delivered, false);
    assert.deepEqual(calls, [['/api/paper-document', options]]);
    for (const args of [['/api/library'], ['/api/paper-document'], ['/api/paper-document', { method: 'POST', body: '{"operation":"read"}' }]]) {
      assert.equal(await window.fetch(...args), response);
      assert.deepEqual(calls.at(-1), args);
    }
    window.paperRefreshGate.release();
    assert.equal(await pending, response);
    assert.equal(window.paperRefreshGate.delivered, true);
    assert.deepEqual(await response.json(), { documentId: 'actual' });
    window.paperRefreshGate.restore();
    assert.equal(window.paperFetchObserver, undefined);
    assert.equal(window.paperNativeFetch, original);
  } finally { if (previous === undefined) delete globalThis.window; else globalThis.window = previous; }
});

test('refresh gate reports actual backend errors and restore releases a held response', async () => {
  const previous = globalThis.window;
  try {
    for (const status of [200, 409]) {
      const response = new Response('actual', { status }), original = async () => response;
      globalThis.window = { fetch: original, location: { href: 'pero-app://paper-agent/dist/index.html' } };
      installPaperFetchObserver();
      deferDocumentRefresh();
      const pending = window.fetch('/api/paper-document', { method: 'POST', body: '{"operation":"prepare","refresh":true}' });
      const rejected = status === 409 ? assert.rejects(pending, /409/) : null;
      await window.paperRefreshGate.ready;
      assert.equal(window.paperRefreshGate.arrived, status === 200);
      if (status === 409) assert.match(window.paperRefreshGate.error, /409/);
      window.paperRefreshGate.restore();
      assert.equal(window.paperFetchObserver, undefined);
      assert.equal(window.paperNativeFetch, original);
      if (rejected) await rejected; else assert.equal(await pending, response);
    }
  } finally { if (previous === undefined) delete globalThis.window; else globalThis.window = previous; }
});


test('refresh gate inspects a clone of Request input and honors init overrides', async () => {
  const previous = globalThis.window;
  const bodies = [], response = new Response('actual');
  const original = async (...args) => { bodies.push(await new Request(...args).text()); return response; };
  globalThis.window = { fetch: original, location: { href: 'https://example.org/' } };
  installPaperFetchObserver();
  try {
    deferDocumentRefresh();
    const request = body => new Request('https://example.org/api/paper-document', { method: 'POST', body: JSON.stringify(body) });
    assert.equal(await window.fetch(request({ operation: 'read' })), response);
    const override = { body: '{"operation":"read","start":17}' };
    assert.equal(await window.fetch(request({ operation: 'prepare', refresh: true }), override), response);
    assert.equal(window.paperRefreshGate.arrived, false);
    const pending = window.fetch(request({ operation: 'prepare', refresh: true }));
    await window.paperRefreshGate.ready;
    assert.equal(window.paperRefreshGate.arrived, true);
    assert.equal(window.paperRefreshGate.delivered, false);
    window.paperRefreshGate.restore();
    assert.equal(await pending, response);
    assert.deepEqual(bodies.map(JSON.parse), [{ operation: 'read' }, { operation: 'read', start: 17 }, { operation: 'prepare', refresh: true }]);
  } finally { if (previous === undefined) delete globalThis.window; else globalThis.window = previous; }
});

import { installPaperFetchObserver } from '../../tests/e2e/paper-fetch-observer.mjs';
import { deferPdfLocate } from '../../tests/e2e/paper-search-flow.mjs';
import { createScopedApi } from '../../packages/app-sdk/src/core.mjs';

test('SDK captured before late response observers still holds real refresh and locate delivery', async () => {
  const previousWindow = globalThis.window;
  try {
    for (const [arm, key, path, body] of [
      [deferDocumentRefresh, 'paperRefreshGate', '/api/paper-document', { operation: 'prepare', refresh: true }],
      [deferPdfLocate, 'paperLocateGate', '/api/pdf/locate', { page: 2 }],
    ]) {
      const calls = [];
      const native = async (...args) => { calls.push(args); return new Response(JSON.stringify({ actual: 'backend response' })); };
      globalThis.window = { fetch: native, location: new URL('pero-app://paper-agent/dist/index.html') };
      installPaperFetchObserver();
      const captured = window.fetch;
      installPaperFetchObserver();
      assert.equal(window.fetch, captured, 'bootstrap never stacks dispatchers');
      const api = createScopedApi({ appName: 'paper-agent', allowedApiPaths: ['/api'], fetch: captured,
        hostHeaders: { 'X-Pero-App-Token': 'real-host-token' } });
      arm();
      let delivered = false;
      const pending = api.post(path, body).then(value => { delivered = true; return value; });
      await Promise.race([window[key].ready, pending.then(() => { throw Error('Captured SDK fetch bypassed the late response observer'); })]);
      assert.equal(window[key].arrived, true);
      assert.equal(delivered, false);
      assert.equal(calls[0][0], path);
      assert.deepEqual(JSON.parse(calls[0][1].body), body);
      assert.equal(calls[0][1].headers.get('X-Pero-App-Token'), 'real-host-token');
      window[key].release();
      assert.deepEqual(await pending, { actual: 'backend response' });
      assert.equal(window[key].delivered, true);
      window[key].restore();
      assert.equal(window.paperFetchObserver, undefined);
      assert.equal(window.fetch, captured);
      assert.deepEqual(await api.get('/api/library'), { actual: 'backend response' });
      assert.equal(calls.length, 2);
    }
  } finally {
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
  }
});

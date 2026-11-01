import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deferDocumentRefresh } from '../../tests/e2e/paper-document-refresh-gate.mjs';

test('refresh gate forwards real requests and holds only the actual refresh Response', async () => {
  const previous = globalThis.window;
  const calls = [], response = new Response('{"documentId":"actual"}');
  const original = async (...args) => { calls.push(args); return response; };
  globalThis.window = { fetch: original, location: { href: 'pero-app://paper-agent/dist/index.html' } };
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
    assert.equal(window.fetch, original);
  } finally { if (previous === undefined) delete globalThis.window; else globalThis.window = previous; }
});

test('refresh gate reports actual backend errors and restore releases a held response', async () => {
  const previous = globalThis.window;
  try {
    for (const status of [200, 409]) {
      const response = new Response('actual', { status }), original = async () => response;
      globalThis.window = { fetch: original, location: { href: 'pero-app://paper-agent/dist/index.html' } };
      deferDocumentRefresh();
      const pending = window.fetch('/api/paper-document', { method: 'POST', body: '{"operation":"prepare","refresh":true}' });
      const rejected = status === 409 ? assert.rejects(pending, /409/) : null;
      await window.paperRefreshGate.ready;
      assert.equal(window.paperRefreshGate.arrived, status === 200);
      if (status === 409) assert.match(window.paperRefreshGate.error, /409/);
      window.paperRefreshGate.restore();
      assert.equal(window.fetch, original);
      if (rejected) await rejected; else assert.equal(await pending, response);
    }
  } finally { if (previous === undefined) delete globalThis.window; else globalThis.window = previous; }
});


test('refresh gate inspects a clone of Request input and honors init overrides', async () => {
  const previous = globalThis.window;
  const bodies = [], response = new Response('actual');
  const original = async (...args) => { bodies.push(await new Request(...args).text()); return response; };
  globalThis.window = { fetch: original, location: { href: 'https://example.org/' } };
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

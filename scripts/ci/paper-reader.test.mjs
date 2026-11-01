import { test } from 'node:test';
import assert from 'node:assert/strict';
import { savePaperClipboard } from '../../tests/e2e/paper-pdf-flow.mjs';

test('reader fixture preserves advertised clipboard data but accepts an empty native item', async () => {
  class ClipboardItem {
    constructor(data) {
      assert.ok(Object.keys(data).length, 'native ClipboardItem rejects zero MIME types');
      this.data = data;
    }
  }
  const text = new Blob(['original text'], { type: 'text/plain' });
  const image = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
  const empty = { types: [], getType() { throw Error('empty clipboard has no readable data'); } };
  const populated = { types: ['text/plain', 'image/png'], async getType(type) { return type === 'text/plain' ? text : image; } };
  try {
    for (const [items, expected] of [[[], []], [[empty], []], [[empty, populated], [{ 'text/plain': text, 'image/png': image }]]]) {
      await savePaperClipboard({ clipboard: { async read() { return items; } }, ClipboardItem });
      assert.deepEqual(globalThis.paperClipboard.map(item => item.data), expected);
      if (expected.length) {
        assert.equal(globalThis.paperClipboard[0].data['text/plain'], text);
        assert.equal(globalThis.paperClipboard[0].data['image/png'], image);
      }
    }
  } finally { delete globalThis.paperClipboard; }
});

import { deferPdfLocate } from '../../tests/e2e/paper-search-flow.mjs';

test('App fetch gate holds the real locate response, forwards requests and restores fetch', async () => {
  const previous = globalThis.window;
  const calls = [], response = new Response(JSON.stringify({ id: 'real-anchor', rects: [{ x: 0.1 }] }));
  const other = new Response('library');
  const original = async (...args) => { calls.push(args); return args[0] === '/api/pdf/locate' ? response : other; };
  globalThis.window = { fetch: original, location: { href: 'pero-app://paper-agent/dist/index.html' } };
  try {
    deferPdfLocate();
    const options = { method: 'POST', body: '{"page":2}', headers: { 'X-Pero-App-Token': 'fixture' } };
    const pending = window.fetch('/api/pdf/locate', options);
    await window.paperLocateGate.ready;
    assert.equal(window.paperLocateGate.arrived, true);
    assert.equal(window.paperLocateGate.delivered, false);
    assert.equal(await window.fetch('/api/library'), other);
    assert.deepEqual(calls, [['/api/pdf/locate', options], ['/api/library']]);
    window.paperLocateGate.release();
    assert.equal(await pending, response);
    assert.equal(window.paperLocateGate.delivered, true);
    assert.deepEqual(await response.json(), { id: 'real-anchor', rects: [{ x: 0.1 }] });
    window.paperLocateGate.restore();
    assert.equal(window.fetch, original);
  } finally { if (previous === undefined) delete globalThis.window; else globalThis.window = previous; }
});

test('App fetch gate exposes backend failures instead of waiting indefinitely', async () => {
  const previous = globalThis.window;
  for (const original of [async () => new Response('unavailable', { status: 409 }), async () => { throw Error('transport failed'); }]) {
    globalThis.window = { fetch: original, location: { href: 'pero-app://paper-agent/dist/index.html' } };
    try {
      deferPdfLocate();
      const failure = assert.rejects(window.fetch('/api/pdf/locate'), /409|transport failed/);
      await window.paperLocateGate.ready;
      assert.match(window.paperLocateGate.error, /409|transport failed/);
      assert.equal(window.paperLocateGate.arrived, false);
      await failure;
      window.paperLocateGate.restore();
      assert.equal(window.fetch, original);
    } finally { if (previous === undefined) delete globalThis.window; else globalThis.window = previous; }
  }
});

import { runInNewContext } from 'node:vm';
import { closePaperChat, paintedPaperChatCloseTarget } from '../../tests/e2e/paper-chat-controls.mjs';

test('Paper Chat close requires a stable painted Host hit target, not draft geometry', async () => {
  const bounds = { x: 1400, y: 730, width: 20, height: 24 };
  for (const phase of ['closed', 'missing', 'loading', 'wrong-size', 'covered', 'moving', 'ready']) {
    let frames = 0;
    const canvas = { width: phase === 'wrong-size' ? 1 : 1440, height: 900 };
    const context = { innerWidth: 1440, innerHeight: 900, devicePixelRatio: 1,
      window: { peroDiagnostics: { snapshot: () => JSON.stringify({ appChatOpen: phase !== 'closed', floatingChat: true,
        chatCloseButtonBounds: phase === 'missing' ? null : { ...bounds, y: bounds.y + (phase === 'moving' && frames ? 32 : 0) } }) } },
      document: { querySelector: () => canvas, getElementById: () => phase === 'loading' ? {} : null,
        elementFromPoint: () => phase === 'covered' ? {} : canvas },
      requestAnimationFrame(callback) { frames++; callback(); },
    };
    const observed = await runInNewContext(`(${paintedPaperChatCloseTarget})()`, context);
    if (phase === 'ready') assert.deepEqual(JSON.parse(JSON.stringify(observed)), bounds);
    else assert.equal(observed, false, phase);
  }
});

test('Paper Chat retries initially missing or moving bounds before one real pointer click', async () => {
  const bounds = { x: 1400, y: 730, width: 20, height: 24 }, clicks = [];
  let open = true, samples = 0;
  const page = {
    evaluate: async predicate => {
      if (predicate === paintedPaperChatCloseTarget) { samples++; return samples < 3 ? false : bounds; }
      return { appChatOpen: open, floatingChat: true, chatCloseButtonBounds: open ? bounds : null };
    },
    getByRole: () => ({ isVisible: async () => false }),
    mouse: { click: async (x, y) => { assert.equal(samples, 3); clicks.push([x, y]); open = false; } },
  };
  await closePaperChat(page);
  assert.deepEqual(clicks, [[1410, 742]]);
  await closePaperChat(page);
  assert.equal(clicks.length, 1);
});

test('Paper Chat never clicks when painted bounds remain unavailable', async () => {
  let samples = 0;
  const page = {
    evaluate: async predicate => {
      if (predicate === paintedPaperChatCloseTarget) { samples++; return false; }
      return { appChatOpen: true, floatingChat: true, chatCloseButtonBounds: null };
    },
    getByRole: () => ({ isVisible: async () => false }),
    mouse: { click: async () => assert.fail('No pointer coordinates exist until the paint gate succeeds') },
  };
  await assert.rejects(closePaperChat(page), /Paper Chat close has a stable painted Host hit target/);
  assert.ok(samples > 1, 'an initially false asynchronous sample must be retried');
});

import { askPaperChat, observePaperChatLaunch } from '../../tests/e2e/paper-chat-controls.mjs';

test('Ask observer accepts only its source/origin and retains replies by actual request ID', () => {
  for (const origin of ['https://paper.test', 'pero-app://paper-agent']) for (const parent of [true, false]) {
    let receive, removed;
    const trusted = {}, stranger = {}, frame = { src: `${origin}/reader`, contentWindow: trusted };
    const context = { URL, document: { querySelectorAll: () => [frame] }, window: { parent: trusted,
      addEventListener: (_type, listener) => { receive = listener; }, removeEventListener: (_type, listener) => { removed = listener; } } };
    runInNewContext(`(${observePaperChatLaunch})({parent:${parent},origin:${JSON.stringify(origin)}})`, context);
    const type = parent ? 'pero:app:chat' : 'pero:app:chat-result';
    for (const [source, eventOrigin] of [[stranger, origin], [trusted, 'https://wrong.test']]) {
      receive({ source, origin: eventOrigin, data: { type, id: 'wrong' } });
    }
    const gate = context.window.paperChatLaunch;
    assert.equal(gate.getRequest(), null); assert.deepEqual(Object.keys(gate.results), []);
    receive({ source: trusted, origin, data: { type, id: 'actual', ok: true } });
    if (parent) assert.equal(gate.getRequest(), 'actual');
    else { assert.equal(gate.results.actual.ok, true); assert.equal(gate.results.wrong, undefined); }
    gate.dispose(); assert.equal(removed, receive);
  }
});

test('Ask readiness waits beyond open and ignores another request acknowledgement until its references paint', async () => {
  let open = false, painted = false, queries = 0, resultQueries = 0, parentDisposed = false, childDisposed = false;
  const page = {
    evaluate: async (fn, options) => {
      if (fn === observePaperChatLaunch) { assert.equal(options.origin, 'https://paper.test'); return; }
      const source = String(fn);
      if (source.includes('location.protocol')) return 'https://host.test';
      if (source.includes('getRequest')) return 'actual';
      if (source.includes('dispose')) { parentDisposed = true; return; }
      assert.ok(open); queries++;
      painted = queries >= 3;
      return { appChatOpen: true, contextPreviewBounds: painted ? [{ id: 'frozen-reference', bounds: { x: 1 } }] : [] };
    },
  };
  const frame = { locator: () => ({ evaluate: async (fn, arg) => {
    if (fn === observePaperChatLaunch) { assert.equal(arg.origin, 'https://host.test'); return; }
    const source = String(fn);
    if (source.includes('location.protocol')) return 'https://paper.test';
    if (source.includes('dispose')) { childDisposed = true; return; }
    assert.equal(arg, 'actual'); resultQueries++;
    const results = { unrelated: { ok: true, value: { references: ['wrong'] } } };
    if (resultQueries >= 2) results.actual = { id: 'actual', ok: true, value: { references: ['frozen-reference'] } };
    return results[arg];
  } }) };
  await askPaperChat(frame, page, { click: async () => { open = true; } });
  assert.equal(painted, true); assert.ok(resultQueries >= 2); assert.equal(parentDisposed && childDisposed, true);
});

test('Ask readiness fails boundedly and cleans observers when only another request replies', async () => {
  let disposed = 0, resultQueries = 0;
  const page = { evaluate: async fn => {
    if (fn === observePaperChatLaunch) return;
    const source = String(fn);
    if (source.includes('location.protocol')) return 'https://host.test';
    if (source.includes('getRequest')) return 'actual';
    if (source.includes('dispose')) { disposed++; return; }
    assert.fail('Host paint must not be accepted without the matching acknowledgement');
  } };
  const frame = { locator: () => ({ evaluate: async (fn, id) => {
    if (fn === observePaperChatLaunch) return;
    const source = String(fn);
    if (source.includes('location.protocol')) return 'https://paper.test';
    if (source.includes('dispose')) { disposed++; return; }
    resultQueries++;
    return { other: { ok: true, value: { references: ['wrong'] } } }[id];
  } }) };
  await assert.rejects(askPaperChat(frame, page, { click: async () => {} }), /matching real Host handoff acknowledgement/);
  assert.ok(resultQueries > 1); assert.equal(disposed, 2);
});

import { inspectResearchReview } from '../../tests/e2e/paper-research-ui-controls.mjs';

test('research inspection creates fresh page-bound locators after Desktop restart', async () => {
  const events = [];
  function pageFrame(id) {
    let closed = false;
    const active = () => assert.equal(closed, false, `page ${id} is closed`);
    const review = { async waitFor(options) { active(); assert.deepEqual(options, { state: 'visible', timeout: 65000 }); events.push([id, 'visible']); } };
    return { close() { closed = true; }, review, getByRole(role, options) {
      active();
      if (role === 'region') { assert.equal(options.name, 'Review resources'); return review; }
      assert.equal(role, 'textbox'); assert.equal(options.name, 'Research URL');
      return { async fill(url) { active(); events.push([id, url]); }, async press(key) { active(); assert.equal(key, 'Enter'); events.push([id, 'inspect']); } };
    } };
  }
  const first = pageFrame('first');
  assert.equal(await inspectResearchReview(first, 'authored-first'), first.review);
  first.close();
  const restarted = pageFrame('restarted');
  assert.equal(await inspectResearchReview(restarted, 'authored-second'), restarted.review);
  assert.deepEqual(events, [['first', 'authored-first'], ['first', 'inspect'], ['first', 'visible'],
    ['restarted', 'authored-second'], ['restarted', 'inspect'], ['restarted', 'visible']]);
  await assert.rejects(() => inspectResearchReview(first, 'stale'), /page first is closed/);
});

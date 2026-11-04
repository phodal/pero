import { installPaperFetchObserver } from '../../tests/e2e/paper-fetch-observer.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { savePaperClipboard, backToLibrary, saveLibraryCopies } from '../../tests/e2e/paper-pdf-flow.mjs';

import { imageOnlyStudyRejectionUrl, isImageOnlyStudyRejectionConsole } from '../../tests/e2e/paper-image-only-flow.mjs';

test('only the explicitly marked image-only Study HTTP 400 is expected console output', () => {
  const text = 'Failed to load resource: the server responded with a status of 400 (Bad Request)';
  assert.equal(isImageOnlyStudyRejectionConsole(imageOnlyStudyRejectionUrl, text), true);
  for (const url of ['pero-app://paper-agent/api/studies', imageOnlyStudyRejectionUrl + '&other=1',
    imageOnlyStudyRejectionUrl.replace('image-only-study-rejection', 'another-study'),
    imageOnlyStudyRejectionUrl.replace('paper-agent', 'another-app')]) {
    assert.equal(isImageOnlyStudyRejectionConsole(url, text), false, url);
  }
  for (const other of [text.replace('400', '403'), text.replace('400', '500'), 'Unexpected Study error 400']) {
    assert.equal(isImageOnlyStudyRejectionConsole(imageOnlyStudyRejectionUrl, other), false, other);
  }
});

test('Library Save targets the exact title instead of a substring-related paper', async () => {
  for (const tex of [false, true]) {
    const title = 'image-only', exactTitle = {}, stop = new Error('selected exact paper download');
    let opened = false;
    const frame = {
      getByRole: (role, options) => {
        assert.equal(role, 'region');
        if (options.name === 'Download') return { isVisible: async () => false };
        assert.deepEqual(options, { name: 'Paper details', exact: true });
        assert.equal(opened, true, 'the exact paper must be opened before downloading');
        return { getByRole: (role, options) => {
          assert.equal(role, 'button'); assert.deepEqual(options, { name: tex ? 'Download TeX' : 'Download PDF', exact: true });
          return { click: async () => { throw stop; } };
        } };
      },
      getByText: (value, options) => { assert.equal(value, title); assert.deepEqual(options, { exact: true }); return exactTitle; },
      locator: selector => {
        if (selector === '.pa-library-list') return { isVisible: async () => true };
        assert.equal(selector, '.pa-library-list > li');
        return { filter: options => {
          assert.deepEqual(options, { has: exactTitle });
          return { locator: selector => {
            assert.equal(selector, '.pero-list-open');
            return { click: async () => { opened = true; } };
          } };
        } };
      },
    };
    await assert.rejects(saveLibraryCopies(frame, title, { tex }), error => error === stop);
    assert.equal(opened, true);
  }
});

test('return to Library handles reader and Library sub-screens without skipping the actual list', async () => {
  for (const initial of ['reader', 'bundle', 'import', 'papers']) {
    let screen = initial;
    const clicks = [];
    const frame = {
      locator: selector => {
        if (selector === '.pa-workspace') return { getAttribute: async () => null };
        assert.ok(['.pa-reading-bar', '.pa-library-screen'].includes(selector));
        return { getByRole: (role, { name }) => {
          assert.equal(role, 'button');
          if (name === 'Refresh') return { isVisible: async () => screen === 'papers' };
          assert.equal(name, 'Back to library');
          const isVisible = () => selector === '.pa-reading-bar' ? screen === 'reader' : ['bundle', 'import'].includes(screen);
          return { isVisible: async () => isVisible(), click: async () => { assert.ok(isVisible()); clicks.push(screen); screen = 'papers'; } };
        } };
      },
      getByRole: (role, { name }) => { assert.equal(role, 'button'); assert.equal(name, 'Close research records'); return { isVisible: async () => false }; },
    };
    await backToLibrary(frame);
    assert.equal(screen, 'papers');
    assert.deepEqual(clicks, initial === 'papers' ? [] : [initial]);
  }
});

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
  installPaperFetchObserver();
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
    assert.equal(window.paperFetchObserver, undefined);
    assert.equal(window.paperNativeFetch, original);
  } finally { if (previous === undefined) delete globalThis.window; else globalThis.window = previous; }
});

test('App fetch gate exposes backend failures instead of waiting indefinitely', async () => {
  const previous = globalThis.window;
  for (const original of [async () => new Response('unavailable', { status: 409 }), async () => { throw Error('transport failed'); }]) {
    globalThis.window = { fetch: original, location: { href: 'pero-app://paper-agent/dist/index.html' } };
    installPaperFetchObserver();
    try {
      deferPdfLocate();
      const failure = assert.rejects(window.fetch('/api/pdf/locate'), /409|transport failed/);
      await window.paperLocateGate.ready;
      assert.match(window.paperLocateGate.error, /409|transport failed/);
      assert.equal(window.paperLocateGate.arrived, false);
      await failure;
      window.paperLocateGate.restore();
      assert.equal(window.paperFetchObserver, undefined);
      assert.equal(window.paperNativeFetch, original);
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

test('closing Paper question mode focuses a native App control before one Escape, even with Host closed', async () => {
  for (const [question, records, pdf] of [[false, false, true], [true, false, true], [true, true, false]]) {
    let questioning = question, recordsOpen = records, focused = false, focusChecks = 0;
    const actions = [];
    const nativeButton = { tagName: 'BUTTON', textContent: pdf ? 'PDF' : '‹' };
    nativeButton.ownerDocument = { activeElement: nativeButton, hasFocus: () => ++focusChecks > 1 };
    const target = {
      isVisible: async () => pdf,
      focus: async () => { actions.push(pdf ? 'focus PDF' : 'focus Back'); focused = true; },
      evaluate: async predicate => {
        assert.equal(focused, true);
        // Execute the helper's real predicate: activeElement alone is not enough
        // while the first document.hasFocus observation still belongs to Host.
        return predicate(nativeButton);
      },
      press: async key => {
        assert.equal(key, 'Escape'); assert.equal(recordsOpen, false); assert.equal(focused, true);
        assert.ok(focusChecks > 1); actions.push('App Escape'); questioning = false;
      },
    };
    const frame = {
      locator: selector => {
        if (selector === '.pa-workspace') return { getAttribute: async name => { assert.equal(name, 'data-question'); return questioning ? 'true' : null; } };
        // The helper owns toolbar layout; this seam models native controls by
        // accessible name, so moving a toolbar does not change keyboard behavior.
        return { getByRole: (role, options) => {
          assert.equal(role, 'button');
          assert.ok(['PDF', 'Back to library'].includes(options.name));
          assert.equal(options.exact, true);
          if (options.name === 'Back to library') assert.equal(pdf, false);
          return { ...target, focus: async () => {
            assert.equal(options.name, pdf ? 'PDF' : 'Back to library', 'only a visible native control can own focus');
            await target.focus();
          } };
        } };
      },
      getByRole: (role, options) => {
        assert.equal(role, 'button'); assert.equal(options.name, 'Close research records');
        return { isVisible: async () => recordsOpen, click: async () => { actions.push('close records'); recordsOpen = false; } };
      },
    };
    const page = { evaluate: async () => ({ appChatOpen: false }) };
    await closePaperChat(page, frame);
    assert.deepEqual(actions, question ? [...(records ? ['close records'] : []), pdf ? 'focus PDF' : 'focus Back', 'App Escape'] : []);
    assert.equal(questioning, false);
  }
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


import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { paperBackendFixture, paperDocumentBackendFixture } from '../../tests/e2e/paper-backend-fixture.mjs';

test('disposable backend replaces all network seams in the actual server and preserves compute capability wiring', () => {
  const server = readFileSync(new URL('../../apps/paper-agent/backend/server.py', import.meta.url), 'utf8');
  const transformed = paperBackendFixture(server, '/tmp/fixture "quoted" source.pdf');
  assert.ok(transformed.includes('from discovery_fixture import fetch, thumbnail_fetch'));
  // Parse/compile only: never import or execute the backend, fixture or worker.
  const keywords = JSON.parse(execFileSync(process.env.PERO_APP_PYTHON || 'python3', ['-c', `
import ast, json, sys
source = sys.stdin.read()
compile(source, '<disposable-paper-fixture>', 'exec')
calls = [node for node in ast.walk(ast.parse(source)) if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == 'handler']
assert len(calls) == 1
print(json.dumps({keyword.arg: ast.unparse(keyword.value) for keyword in calls[0].keywords}))
`], { input: transformed, encoding: 'utf8' }));
  assert.equal(keywords.literature, 'LiteratureClient(fetch)');
  // Exercise the real reviewed-download fixture with stdlib only. No server,
  // worker, parser or model is started; an audit hook forbids real networking.
  execFileSync(process.env.PERO_APP_PYTHON || 'python3', ['-S', '-c', `
import os, runpy, sys, tempfile
from pathlib import Path
from types import SimpleNamespace

def offline(event, args):
    if event.startswith('socket.'):
        raise AssertionError('Real networking forbidden: ' + event)
sys.addaudithook(offline)
sys.path.insert(0, 'apps/paper-agent/backend')
fixture = runpy.run_path('tests/fixtures/paper-reader-download.py')
with tempfile.TemporaryDirectory() as directory:
    os.environ['PERO_APP_DATA'] = directory
    path = Path(directory) / 'fixture "quoted" source.pdf'
    authored = b'%PDF-1.7 authored offline reader bytes'
    path.write_bytes(authored)
    store = SimpleNamespace(imports=SimpleNamespace(), _list=lambda collection: [])
    fixture['install'](store, path)
    for url in (fixture['PDF_URL'], fixture['PUBLISHER_URL']):
        response = store.pdf_downloads.transport.fetch_pdf(url)
        assert response.data == authored
        assert response.url == url
    try:
        store.imports.inspector.fetch('https://reader.example.org/metadata')
    except AssertionError as error:
        assert 'Fixed reader fixture must not fetch metadata' in str(error)
    else:
        raise AssertionError('Reader metadata must remain fail-closed')
`], { cwd: new URL('../../', import.meta.url) });
  assert.equal(keywords.thumbnails, 'PaperThumbnails(thumbnail_fetch)');
  assert.equal(keywords.compute_secret, 'compute_secret');
});

test('backend fixture refuses missing, duplicate and previously injected seams', () => {
  const server = readFileSync(new URL('../../apps/paper-agent/backend/server.py', import.meta.url), 'utf8');
  for (const seam of ['from paper_agent.http import handler', 'handler(store, os.environ["PERO_APP_TOKEN"]']) {
    assert.throws(() => paperBackendFixture(server.replace(seam, ''), '/tmp/source.pdf'), /exactly one/);
    assert.throws(() => paperBackendFixture(server + '\n' + seam, '/tmp/source.pdf'), /exactly one/);
  }
  assert.throws(() => paperBackendFixture(paperBackendFixture(server, '/tmp/source.pdf'), '/tmp/source.pdf'), /already injected/);
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


test('structured fixture composes document and private compute dependencies without fallback', () => {
  const server = readFileSync(new URL('../../apps/paper-agent/backend/server.py', import.meta.url), 'utf8');
  const transformed = paperDocumentBackendFixture(server);
  assert.ok(transformed.includes('documents=documents, compute_secret=compute_secret'));
  execFileSync(process.env.PERO_APP_PYTHON || 'python3', ['-c', 'import sys; compile(sys.stdin.read(), "<structured-fixture>", "exec")'], { input: transformed });
  const call = 'handler(store, os.environ["PERO_APP_TOKEN"]';
  const marker = '    store = ResearchStore(os.environ["PERO_APP_DATA"], open_embedder())';
  for (const source of [server.replace(call, ''), server + call, server.replace(marker, ''), server + marker, transformed])
    assert.throws(() => paperDocumentBackendFixture(source), /unique uninjected/);
});

import { scrollPdfAndRead } from '../../tests/e2e/paper-pdf-flow.mjs';

test('PDF wheel checkpoint respects viewport padding while waiting for movement and persistence', async () => {
  let top = 20, storedY = 30, wheelCalls = 0, done = false, notifyWheel;
  const issued = new Promise(resolve => { notifyWheel = resolve; });
  const element = { get scrollTop() { return top; }, scrollHeight: 1000, clientHeight: 500, clientTop: 0,
    ownerDocument: { defaultView: { getComputedStyle() { return { paddingTop: '10px' }; } } },
    getBoundingClientRect() { return { top: 0 }; },
    querySelector(selector) { assert.equal(selector, '[data-page-number="1"]'); return { getBoundingClientRect() { return { top: -50 }; } }; } };
  const viewport = { async hover() {}, async evaluate(fn, input) { return fn(element, input); } };
  let notifyNative; const nativeSeen = new Promise(resolve => { notifyNative = resolve; });
  const read = async () => { if (top === 80 && storedY === 30) notifyNative(); return { page: 1, zoom: 2, position: { y: storedY } }; };
  const page = { mouse: { async wheel(x, y) { assert.equal(x, 0); assert.equal(y, 60); wheelCalls++; notifyWheel(); } } };
  const pending = scrollPdfAndRead(page, viewport, read, 60).then(value => { done = true; return value; });
  await issued; await new Promise(resolve => setImmediate(resolve));
  assert.equal(done, false, 'preexisting positive y must not complete a queued wheel');
  top = 80; // Native movement alone is not the persisted checkpoint either.
  await nativeSeen; assert.equal(done, false);
  storedY = 60;
  assert.equal((await pending).position.y, 60);
  assert.equal(wheelCalls, 1);
});


test('PDF wheel waits for pending zoom DOM alignment and clamps the native boundary', async () => {
  let pageTop = -40, top = 480, storedY = 30, calls = 0, notifySample;
  const sampled = new Promise(resolve => { notifySample = resolve; });
  const element = { get scrollTop() { return top; }, scrollHeight: 1000, clientHeight: 500, clientTop: 0,
    ownerDocument: { defaultView: { getComputedStyle() { return { paddingTop: '0px' }; } } },
    getBoundingClientRect() { return { top: 0 }; }, querySelector() { return { getBoundingClientRect() { notifySample(); return { top: pageTop }; } }; } };
  const viewport = { async hover() {}, async evaluate(fn, input) { return fn(element, input); } };
  const read = async () => ({ page: 1, zoom: 2, position: { y: storedY } });
  const page = { mouse: { async wheel() { calls++; top = 500; storedY = 40; } } };
  const pending = scrollPdfAndRead(page, viewport, read, 60);
  await sampled; await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 0, 'zoom metrics alone must not establish the DOM baseline');
  pageTop = -60; // The deferred zoom scroll now matches persisted y30.
  assert.equal((await pending).position.y, 40); // Only20px fit before the bottom.
  assert.equal(calls, 1);
});

import { createRequire } from 'node:module';
const paperRequire = createRequire(new URL('../../apps/paper-agent/package.json', import.meta.url));

test('cached EmbedPDF restoration emits before a late observer; reader snapshots current scope', async () => {
  const { SelectionPlugin } = await import(paperRequire.resolve('@embedpdf/plugin-selection'));
  const { PdfTaskHelper } = await import(paperRequire.resolve('@embedpdf/models'));
  const range = { start: { page: 0, index: 1 }, end: { page: 0, index: 3 } };
  const state = { selection: null, rects: {}, geometry: { 0: {} } }, listeners = new Set();
  const plugin = Object.create(SelectionPlugin.prototype);
  Object.defineProperty(plugin, 'state', { value: { documents: { doc: state } } });
  Object.assign(plugin, {
    validateRange: () => null, normalizeRange: value => value,
    getOrLoadGeometry: () => PdfTaskHelper.resolve(state.geometry[0]),
    clampRangeToGeometry: (_id, value) => value,
    selecting: new Map(), anchor: new Map(), getDocumentState: () => state,
    dispatch: action => { if (action.payload?.selection) state.selection = action.payload.selection; },
    updateRectsAndSlices() {}, notifyPage() {}, recalculateMenuPlacement() {},
    selChange$: { emit: (_id, value) => { for (const listener of listeners) listener(value); } },
  });
  let lateSeen = false;
  const restored = plugin.applySelection('doc', range);
  listeners.add(() => { lateSeen = true; });
  await restored.toPromise();
  assert.equal(lateSeen, false, 'listeners registered after apply miss the cached emit');
  assert.deepEqual(state.selection, range);
  // Production subscribes then reads getState().selection so a pre-existing
  // restored range still opens the toolbar without depending on that emit.
  const source = readFileSync(new URL('../../apps/paper-agent/ui-src/pdf-reader.tsx', import.meta.url), 'utf8');
  const subscribe = source.indexOf('scope.onSelectionChange(update)');
  const snapshot = source.indexOf('update(scope.getState().selection)', subscribe);
  assert.ok(subscribe >= 0 && snapshot > subscribe, 'observer must snapshot after subscribe');
});

test('PDF selection persistence keeps deactivation clears and honors explicit discard', async () => {
  const { transformSync } = await import('esbuild');
  const { runInNewContext } = await import('node:vm');
  const source = readFileSync(new URL('../../apps/paper-agent/ui-src/reader-state.ts', import.meta.url), 'utf8');
  const store = new Map(), module = { exports: {} };
  runInNewContext(transformSync(source, { loader: 'ts', format: 'cjs' }).code, {
    module, exports: module.exports,
    localStorage: { getItem: key => store.get(key) ?? null, setItem: (key, value) => { store.set(key, value); } },
  }, { filename: 'reader-state.ts' });
  const { persistedSelection, loadReaderState, saveReaderState, readerStateKey } = module.exports;
  const range = { start: { page: 0, index: 12 }, end: { page: 0, index: 35 } };
  const document = { id: 'doc', fileDigest: 'digest', pages: [{}, {}] };
  const same = (left, right) => assert.equal(JSON.stringify(left), JSON.stringify(right));
  same(persistedSelection(range, false, null), range);
  same(persistedSelection(null, false, range), range);
  assert.equal(persistedSelection(null, true, range), null, 'explicit discard forgets the saved range');
  assert.equal(persistedSelection(null, false, null), null);
  const value = { schema: 1, documentId: document.id, fileDigest: document.fileDigest, page: 1, zoom: 1.2,
    mode: 'pdf', position: { x: -100, y: 0 }, selection: range };
  assert.equal(saveReaderState(document, value), true);
  assert.equal(readerStateKey(document), `pero.paper.pdf-view:${document.id}:${document.fileDigest}`);
  same(loadReaderState(document)?.selection, range);
  assert.equal(saveReaderState(document, { ...value, selection: persistedSelection(null, false, loadReaderState(document)?.selection) }), true);
  same(loadReaderState(document)?.selection, range);
  assert.equal(saveReaderState(document, { ...value, selection: persistedSelection(null, true, loadReaderState(document)?.selection) }), true);
  assert.equal(loadReaderState(document)?.selection, null);
});

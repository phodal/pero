import assert from 'node:assert/strict';
import test from 'node:test';
import { resolve } from 'node:path';
import { createUiRuntime } from '../../../packages/app-sdk/test/ui-test-runtime.mjs';

async function fixture(t, fullApp = false) {
  const resolveDir = resolve(import.meta.dirname, '../ui-src');
  const parser = Object.getOwnPropertyDescriptor(globalThis, 'DOMParser');
  if (fullApp) t.after(() => parser ? Object.defineProperty(globalThis, 'DOMParser', parser) : delete globalThis.DOMParser);
  // Bundle the production App with its real reader dependencies. The WASM
  // asset is emitted only by the build; this library test never opens a PDF.
  const appSource = fullApp ? (await (await import('esbuild')).build({
    stdin: { contents: "export { default as PaperAgent } from './index';", resolveDir, loader: 'tsx' },
    bundle: true, write: false, outdir: '/tmp/pero-paper-workspace-ui', platform: 'browser', format: 'esm', jsx: 'automatic',
    external: ['@pero/app-sdk', '@pero/app-sdk/*', 'react', 'react/*', 'react-dom', 'react-dom/*'], loader: { '.wasm': 'file', '.css': 'empty' },
  })).outputFiles.find(file => file.path.endsWith('.js')).text : '';
  const env = await createUiRuntime(t, { resolveDir, contents: `${fullApp ? 'globalThis.DOMParser = window.DOMParser;' : ''}${appSource}
    export { useLibraryData } from './library-data';
    export { LibraryPapers } from './library-papers';
    export { WorkspaceNav } from './workspace-nav';
    export { Discovery } from './discovery';
    export { ResearchRecords } from './research-records';
    export { PdfActions } from './pdf-actions';
    export { messages } from './i18n';
    export { AppApiProvider, appSurface } from '@pero/app-sdk';` });
  const { React, ui, render, dom } = env;
  dom.window.matchMedia = globalThis.matchMedia;
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  dom.window.HTMLElement.prototype.getBoundingClientRect = () => ({ x: 10, y: 10, width: 240, height: 32, top: 10, left: 10, right: 250, bottom: 42, toJSON() { return this; } });
  const translate = key => ui.messages[key]?.en ?? key;
  const provider = child => React.createElement(ui.AppApiProvider, { appName: 'paper-agent', locale: 'en', allowedApiPaths: ['/api'], surface: ui.appSurface, allowedEvents: [], subscribeFn: () => () => {}, navigateFn() {}, notifyFn() {} }, child);
  const mount = child => render(provider(child));
  const button = text => {
    const result = [...document.querySelectorAll('button')].find(node => node.textContent === text);
    assert.ok(result, `Missing button ${text}`); return result;
  };
  const input = async (node, value) => React.act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(node, value);
    node.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
  const key = (node, value, options = {}) => React.act(async () => node.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, ...options })));
  return { ...env, t: translate, mount, button, input, key };
}

const paper = { id: 'p1', title: 'Saved source', source: 'local', sourceId: 'local-1', authors: [], url: 'https://example.test/paper', contentKind: 'abstract', fetchedAt: '2026-11-06', contentDigest: 'digest' };
const library = { papers: [paper], intents: [], reports: [] };

test('reactivating Paper retains the actual search input, selection and sources through refresh failure', async t => {
  const f = await fixture(t);
  let fail, state;
  const api = { get: async () => library, post() {} };
  function Workspace({ active }) {
    state = f.ui.useLibraryData(api, active);
    return f.React.createElement(f.ui.LibraryPapers, { api, papers: state.library.papers, shelf: {}, filter: 'all', loading: state.loading,
      unavailable: !state.loaded && !!state.error, locked: false, showDetails: true, t: f.t,
      ...Object.fromEntries(['onFilter', 'onStatus', 'onRefresh', 'onImport', 'onRead', 'onRecords', 'onDiscover', 'onDownload', 'onSearchHit', 'onFind', 'onCompare'].map(name => [name, () => {}])) });
  }
  const mount = active => f.mount(f.React.createElement(Workspace, { active }));
  await mount(true);
  const search = document.querySelector('input[type=search]');
  await f.input(search, 'retained query');
  await mount(false);
  api.get = () => new Promise((_, reject) => { fail = reject; });
  await mount(true);
  assert.equal(state.refreshing, true);
  assert.equal(document.querySelector('input[type=search]'), search);
  assert.equal(search.value, 'retained query');
  assert.match(document.body.textContent, /Saved source/);
  await f.React.act(async () => fail(new Error('offline')));
  assert.equal(state.error, 'offline');
  assert.equal(search.value, 'retained query');
  assert.equal(state.library.papers[0].id, 'p1');
});

test('changing Paper API scope immediately removes the former library and rejects late former-scope requests', async t => {
  const f = await fixture(t), commits = [];
  let state, releaseOld, rejectNew, oldReads = 0;
  const oldApi = { get: () => ++oldReads === 1 ? Promise.resolve(library) : new Promise(resolve => { releaseOld = resolve; }), post() {} };
  const newApi = { get: () => new Promise((_, reject) => { rejectNew = reject; }), post() {} };
  function Workspace({ api, active }) {
    state = f.ui.useLibraryData(api, active);
    f.React.useLayoutEffect(() => { commits.push({ api, papers: state.library.papers.map(paper => paper.id) }); });
    return f.React.createElement('output', null, state.library.papers.map(paper => paper.title).join(', '));
  }
  const mount = (api, active = true) => f.mount(f.React.createElement(Workspace, { api, active }));
  await mount(oldApi);
  assert.match(document.body.textContent, /Saved source/);
  const oldRefresh = state.refresh;
  await f.React.act(async () => { void oldRefresh(); });
  assert.equal(state.refreshing, true);
  await mount(newApi, false);
  assert.equal(state.loaded, false);
  assert.equal(state.loading, true);
  assert.doesNotMatch(document.body.textContent, /Saved source/);
  assert.ok(commits.filter(commit => commit.api === newApi).every(commit => commit.papers.length === 0));
  await f.React.act(async () => releaseOld(library));
  assert.equal(state.loaded, false);
  assert.deepEqual(state.library.papers, []);
  await f.React.act(async () => oldRefresh());
  assert.equal(oldReads, 2);
  await mount(newApi);
  await f.React.act(async () => rejectNew(Error('new scope unavailable')));
  assert.equal(state.error, 'new scope unavailable');
  assert.equal(state.loaded, false);
  assert.deepEqual(state.library.papers, []);
  await mount(oldApi, false);
  assert.equal(state.loaded, false);
  assert.deepEqual(state.library.papers, []);
});

test('Paper results recover first-load failure, retain records on 503, and remove revoked library access on 401/403', async t => {
  const f = await fixture(t, true);
  const intent = { id: 'question1', question: 'Saved question', papers: [paper], paperIds: [paper.id], createdAt: '2026-11-06' };
  const saved = { ...library, intents: [intent] };
  const pending = [];
  const fetch = async path => path === '/api/library' ? new Promise(resolve => pending.push(resolve))
    : new Response(JSON.stringify(path === '/api/intents/question1' ? intent : { records: [] }));
  const mount = active => f.render(f.React.createElement(f.ui.AppApiProvider, {
    appName: 'paper-agent', locale: 'en', active, allowedApiPaths: ['/api'], allowedEvents: [], fetch,
    surface: f.ui.appSurface, subscribeFn: () => () => {}, navigateFn() {}, notifyFn() {},
  }, f.React.createElement(f.ui.PaperAgent)));
  const respond = async (status, value) => f.React.act(async () => pending.shift()(new Response(typeof value === 'string' ? value : JSON.stringify(value), { status })));
  await mount(true);
  const resultNav = document.querySelector('.pa-workspace-nav [aria-label="Research results"]');
  assert.ok(resultNav, document.body.textContent);
  await f.click(resultNav);
  assert.ok(document.querySelector('.pa-results [role=status]'));
  assert.doesNotMatch(document.querySelector('.pa-results').textContent, /No saved questions yet/);
  await respond(503, 'library offline');
  assert.match(document.querySelector('.pa-library-update [role=alert]').textContent, /library offline/);
  assert.doesNotMatch(document.querySelector('.pa-results').textContent, /No saved questions yet/);
  await f.click(f.button('Retry'));
  await respond(200, saved);
  assert.match(document.querySelector('.pa-result-content').textContent, /Saved question/);
  const record = document.querySelector('.pa-result-content');
  await mount(false);
  await mount(true);
  assert.equal(document.querySelector('.pa-result-content'), record);
  await respond(503, 'refresh offline');
  assert.equal(document.querySelector('.pa-result-content'), record);
  assert.match(record.textContent, /Saved question/);
  assert.match(document.querySelector('.pa-library-update [role=alert]').textContent, /Previously loaded sources remain available/);
  assert.equal(document.querySelectorAll('.pa-library-update [role=alert]').length, 1);
  await f.click(f.button('Retry'));
  await respond(200, saved);
  assert.equal(document.querySelector('.pa-library-update [role=alert]'), null);
  for (const status of [401, 403]) {
    await mount(false);
    await mount(true);
    await respond(status, 'library access revoked');
    assert.equal(document.querySelector('.pa-result-content'), null);
    assert.doesNotMatch(document.querySelector('.pa-results').textContent, /No saved questions yet/);
    assert.match(document.querySelector('.pa-library-update [role=alert]').textContent, /library access revoked/);
    assert.doesNotMatch(document.querySelector('.pa-library-update [role=alert]').textContent, /Previously loaded sources remain available/);
    await f.click(f.button('Retry'));
    await respond(200, saved);
    assert.match(document.querySelector('.pa-result-content').textContent, /Saved question/);
  }
});

test('compact Paper navigation routes to research results, reading shelves and collections', async t => {
  const f = await fixture(t), routes = [];
  await f.mount(f.React.createElement(f.ui.WorkspaceNav, { t: f.t, paperCount: 1, readingCount: 1, toReadCount: 0,
    bundles: [{ id: 'b1', title: 'My collection' }], libraryScreen: 'papers', shelfFilter: 'all', openBundleId: null,
    onLibrary: () => routes.push('library'), onDiscover: () => routes.push('discover'), onResults: () => routes.push('results'), onShelf: value => routes.push(value), onBundle: value => routes.push(value) }));
  for (const [label, route] of [['Research results', 'results'], ['Reading (1)', 'reading'], ['My collection', 'b1'], ['Discover', 'discover']]) {
    await f.click(document.querySelector('.pa-workspace-switch .pero-select-trigger'));
    const option = [...document.querySelectorAll('[role=option]')].find(node => node.textContent === label);
    assert.ok(option, `Missing compact route: ${label}`);
    await f.click(option);
    assert.equal(routes.at(-1), route);
  }
});

test('discovery retains available results when library refresh or the next relation fails', async t => {
  const f = await fixture(t);
  const item = { id: 'w1', title: 'Related result', authors: [], abstract: 'Available evidence', url: 'https://example.test/result', publicationDate: '2026', citations: 2 };
  const batch = { id: 'batch1', seedId: 'p1', seedTitle: paper.title, relation: 'related', work: item, items: [item], page: 1, hasMore: false, fetchedAt: '2026-11-06' };
  let rejectNext, refreshFails = true;
  const api = { post: async () => batch, get() {} };
  await f.mount(f.React.createElement(f.ui.Discovery, { api, opening: { seed: paper }, library, locked: false, selected: [], t: f.t,
    onRefresh: async () => { if (refreshFails) throw Error('library offline'); }, onRead() {}, onCompare() {}, onReturn() {}, onBack() {} }));
  assert.match(document.querySelector('.pa-discovery-results').textContent, /Related result/);
  assert.match(document.body.textContent, /library could not be refreshed/);
  refreshFails = false;
  await f.click(f.button('Retry'));
  assert.doesNotMatch(document.body.textContent, /library offline/);
  api.post = () => new Promise((_, reject) => { rejectNext = reject; });
  await f.click(f.button('References'));
  assert.match(document.querySelector('.pa-discovery-results').textContent, /Related result/);
  await f.React.act(async () => rejectNext(Error('lookup offline')));
  assert.match(document.querySelector('.pa-discovery-results').textContent, /Related result/);
  assert.match(document.body.textContent, /Previously fetched results/);
  assert.equal(f.button('Related papers').getAttribute('data-state'), 'on');
});

test('research results select a stable detail and keep manual editing directly accessible', async t => {
  const f = await fixture(t), reads = [], continued = [];
  const intents = ['first', 'second'].map((id, index) => ({ id, question: `${id} question`, papers: [paper], paperIds: ['p1'], createdAt: `2026-11-0${index + 1}` }));
  const saved = { ...library, intents };
  const api = { get: async path => { reads.push(path); return intents.find(item => path.endsWith(item.id)); }, post: async () => ({ records: [] }) };
  await f.mount(f.React.createElement(f.ui.ResearchRecords, { api, library: saved, paper: null, results: true, matrixOpen: false, t: f.t,
    onMatrixOpen() {}, onFollowUp: value => continued.push(value.id), onContinue() {}, onCite() {}, onRead() {}, onAttempt() {} }));
  assert.match(document.querySelector('.pa-result-content').textContent, /second question/);
  const first = [...document.querySelectorAll('.pa-result-list button')].find(node => node.textContent.includes('first question'));
  await f.click(first);
  assert.match(document.querySelector('.pa-result-content').textContent, /first question/);
  await f.click(f.button('Resume question'));
  assert.deepEqual(continued, ['first']);
  assert.deepEqual(reads, ['/api/intents/second', '/api/intents/first']);
  await f.click(f.button('New record'));
  assert.ok(document.querySelector('.pa-manual-records input'));
  assert.equal(document.querySelector('.pa-manual-records').tagName, 'SECTION');
  assert.equal(document.querySelector('.pa-manual-records form details'), null);
});

test('PDF shared context menu includes the original download in arrow-key order and restores focus', async t => {
  const f = await fixture(t), actions = [], downloads = [];
  const oldRect = Object.getOwnPropertyDescriptor(globalThis, 'DOMRect');
  Object.defineProperty(globalThis, 'DOMRect', { configurable: true, value: f.dom.window.DOMRect });
  t.after(() => oldRect ? Object.defineProperty(globalThis, 'DOMRect', oldRect) : delete globalThis.DOMRect);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const flush = () => f.React.act(async () => t.mock.timers.runAll());
  const key = async (...args) => { await f.key(...args); await flush(); };
  await f.mount(f.React.createElement(f.ui.PdfActions, { disabled: false, documentId: 'pdf1', annotationCount: 2, readLabel: 'Read text', t: f.t,
    onCapture: () => actions.push('capture'), onNotes() {}, onPageText() {}, onSave() {}, onText() {} }, f.React.createElement('section', { tabIndex: 0 }, 'PDF region')));
  const region = document.querySelector('section'); region.focus();
  await key(region, 'F10', { shiftKey: true });
  const items = [...document.querySelectorAll('[role=menuitem]')];
  assert.equal(items.length, 6);
  const first = items[0]; await f.React.act(async () => first.focus());
  for (let i = 0; i < 3; i++) await key(document.activeElement, 'ArrowDown');
  assert.equal(document.activeElement, items[3]);
  assert.match(items[3].textContent, /Original PDF/);
  t.mock.method(f.dom.window.HTMLAnchorElement.prototype, 'click', function () { downloads.push(this.getAttribute('href')); });
  await key(items[3], 'Enter');
  assert.deepEqual(downloads, ['/api/pdf/pdf1/file']);
  await key(region, 'F10', { shiftKey: true });
  await key(document.querySelector('[role=menu]'), 'Escape');
  assert.equal(document.querySelector('[role=menu]'), null);
  assert.equal(document.activeElement, region);
  assert.deepEqual(actions, []);
  await f.render(null); await flush();
});

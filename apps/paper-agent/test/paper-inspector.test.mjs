import assert from 'node:assert/strict';
import test from 'node:test';
import { resolve } from 'node:path';
import { createUiRuntime } from '../../../packages/app-sdk/test/ui-test-runtime.mjs';

async function fixture(t) {
  const resolveDir = resolve(import.meta.dirname, '../ui-src');
  const env = await createUiRuntime(t, { resolveDir, contents: `
    export { PaperInspector } from './paper-inspector';
    export { messages } from './i18n';
    export { AppApiProvider, appSurface } from '@pero/app-sdk';
  ` });
  const translate = key => env.ui.messages[key]?.en ?? key;
  const mount = (paper, api, extra = {}) => env.render(env.React.createElement(env.ui.AppApiProvider, {
    appName: 'paper-agent', locale: 'en', allowedApiPaths: ['/api'], surface: env.ui.appSurface, allowedEvents: [],
    subscribeFn: () => () => {}, navigateFn() {}, notifyFn() {},
  }, env.React.createElement(env.ui.PaperInspector, {
    api, paper, shelf: { [paper.id]: 'reading' }, library: { intents: [], studies: [], discoveries: [], favorites: [] },
    locked: false, t: translate,
    onStatus() {}, onRead() {}, onRecords() {}, onDiscover() {}, onDownload() {},
    ...extra,
  })));
  return { ...env, t: translate, mount };
}

const paper = {
  id: 'p1', title: 'Language Models Need Sleep: Learning to Self-Modify and Consolidate Memories',
  source: 'alphaxiv', sourceId: 'a1', authors: ['Behrouz, Ali', 'Hashemi, Farnoosh', 'Other'], url: 'https://example.test/paper',
  contentKind: 'full-text', fetchedAt: '2026-11-04T00:00:00Z', contentDigest: 'digest', content: 'This paper proposes a sleep-inspired framework for self-modification.',
  arxivUrl: 'https://arxiv.org/abs/1', pdfUrl: 'https://example.test/a.pdf', hasSavedText: true,
};

test('Paper inspector shows overview hierarchy and honest brief unavailable state', async t => {
  const f = await fixture(t);
  const asks = [];
  await f.mount(paper, {
    get: async path => {
      if (path.startsWith('/api/papers/')) return paper;
      if (path.startsWith('/api/pdf')) return { document: null, annotations: [] };
      throw new Error(`unexpected ${path}`);
    },
    post() {},
  }, { onAsk: (selected, message) => asks.push({ id: selected.id, message }) });
  const root = document.querySelector('.pa-paper-inspector');
  assert.ok(root);
  assert.match(root.textContent, /Paper details/i);
  assert.match(root.textContent, /Language Models Need Sleep/);
  assert.match(root.textContent, /Open Reader|Continue reading/);
  assert.match(root.textContent, /Overview/);
  assert.match(root.textContent, /Notes/);
  assert.match(root.textContent, /Related/);
  assert.match(root.textContent, /AI Research Brief/);
  assert.match(root.textContent, /Unavailable/);
  assert.match(root.textContent, /Ask Paper/);
  assert.equal(document.querySelectorAll('dl.pa-paper-inspector').length, 0);
  const ask = document.querySelector('.pa-inspector-ask-form input');
  assert.ok(ask);
  await f.React.act(async () => {
    Object.getOwnPropertyDescriptor(f.dom.window.HTMLInputElement.prototype, 'value').set.call(ask, 'What is the method?');
    ask.dispatchEvent(new f.dom.window.Event('input', { bubbles: true }));
  });
  await f.React.act(async () => document.querySelector('.pa-inspector-ask-form').dispatchEvent(new f.dom.window.Event('submit', { bubbles: true, cancelable: true })));
  assert.deepEqual(asks, [{ id: 'p1', message: 'What is the method?' }]);
});

test('Paper inspector notes tab reports missing PDF honestly', async t => {
  const f = await fixture(t);
  await f.mount(paper, {
    get: async path => {
      if (path.startsWith('/api/papers/')) return paper;
      if (path.startsWith('/api/pdf')) return { document: null, annotations: [] };
      throw new Error(`unexpected ${path}`);
    },
    post() {},
  });
  await f.click([...document.querySelectorAll('button')].find(node => node.textContent === 'Notes'));
  assert.match(document.querySelector('.pa-inspector-notes').textContent, /saved PDF/i);
});

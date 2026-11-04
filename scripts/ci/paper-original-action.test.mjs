import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paperComponents, elements, drain } from './paper-component-harness.mjs';

const find = (host, predicate) => elements(host.tree, predicate)[0];
const scope = { bundleId: 'bundle-A', resourceId: 'resource-A' };
const block = (id, anchors) => ({ id, anchors, kind: 'table', content: [], cells: [], images: [], limitations: [] });
const document = { id: 'immutable-A', source: { digest: 'source-digest', version: 'v1', url: 'https://example.org/source' }, metadata: { identifiers: [] }, blocks: [block('full-table-block-id', ['T1', 'T1.caption']), block('other-block', ['S2']), block('ambiguous-a', ['duplicate']), block('ambiguous-b', ['duplicate'])], warnings: [] };
const overview = scopes => ({ revisions: [{ ...document, parser: 'html', scopes }], sources: [{ ...scope, authorized: true, revision: 'v1' }] });
const selection = (anchors, sourceId = document.id) => ({ sourceId, anchors, text: 'Selected caption' });
const adapter = host => find(host, node => node.type === 'HtmlReading');
const button = node => elements(node, value => value.type === 'Button')[0];
async function mount(scopes = [scope], available = true) {
  const posts = [];
  const api = { get: async path => path.includes('?') ? { ...overview(scopes), revisions: available ? overview(scopes).revisions : [] } : { ...document, id: path.split('/').at(-1) },
    post(path, body) { return new Promise(resolve => posts.push({ path, body, resolve })); } };
  const components = paperComponents(api);
  const host = components.mount(components.StructuredReading, { api, paperId: 'paper', openToken: 1, onReady() {}, onReview() {} });
  await drain(); host.render();
  return { host, posts };
}

test('normal HTML selection resolves exactly one immutable block and preserves scoped original-window receipts', async () => {
  const { host, posts } = await mount();
  assert.equal(adapter(host).props.recorded, false);
  const action = adapter(host).props.renderSelection(selection(['T1', 'T1.caption']));
  assert.equal(action.props['data-block-id'], 'full-table-block-id');
  assert.equal(button(action).props.disabled, false);
  button(action).props.onClick();
  assert.deepEqual(JSON.parse(JSON.stringify(posts[0].body)), { operation: 'source', documentId: document.id, ...scope, blockId: 'full-table-block-id' });
  posts[0].resolve({ documentId: document.id, content: '<table>immutable bytes</table>', sourceDigest: document.source.digest, observationId: 'original-window-receipt', start: 120, end: 149, nextStart: 149, blockLocator: { start_line: 4, end_line: 5 } });
  await drain(); host.render();
  const original = find(host, node => node.props?.['aria-label'] === 'Original HTML source');
  assert.ok(JSON.stringify(original).includes('<table>immutable bytes</table>'));
  const next = elements(original, node => node.type === 'Button' && node.props.children.includes('Next original window'))[0];
  next.props.onClick();
  assert.deepEqual(JSON.parse(JSON.stringify(posts[1].body)), { operation: 'source', documentId: document.id, ...scope, blockId: 'full-table-block-id', start: 149 });
});

test('unmapped, ambiguous, cross-block and previous-document selections do not expose a source action', async () => {
  const { host, posts } = await mount();
  for (const value of [selection([]), selection(['missing']), selection(['duplicate']), selection(['T1', 'S2']), selection(['T1', 'missing']), selection(['T1'], 'old-document')]) {
    assert.equal(adapter(host).props.renderSelection(value), null);
  }
  assert.equal(posts.length, 0);
});

test('missing bundle ownership disables selection action and a scope change invalidates a pending original response', async () => {
  const other = { bundleId: 'bundle-B', resourceId: 'resource-B' };
  const { host, posts } = await mount([scope, other]);
  assert.equal(button(adapter(host).props.renderSelection(selection(['T1']))).props.disabled, true);
  const choose = find(host, node => node.props?.label === 'Evidence bundle');
  choose.props.onChange('bundle-A:resource-A'); host.render();
  button(adapter(host).props.renderSelection(selection(['T1']))).props.onClick();
  find(host, node => node.props?.label === 'Evidence bundle').props.onChange('bundle-B:resource-B'); host.render();
  posts[0].resolve({ documentId: document.id, content: 'stale bundle A bytes', start: 0, end: 20 });
  await drain(); host.render();
  assert.equal(find(host, node => node.props?.['aria-label'] === 'Original HTML source'), undefined);
  button(adapter(host).props.renderSelection(selection(['T1']))).props.onClick();
  assert.equal(posts[1].body.bundleId, 'bundle-B');
  assert.equal(posts[1].body.resourceId, 'resource-B');
});

test('reopening a changed revision invalidates a pending original response', async () => {
  const { host, posts } = await mount();
  button(adapter(host).props.renderSelection(selection(['T1']))).props.onClick();
  const api = { ...host.props.api, get: async path => path.includes('?') ? { ...overview([scope]), revisions: [{ ...document, id: 'immutable-B', scopes: [scope] }] } : { ...document, id: 'immutable-B' } };
  host.render({ ...host.props, api, openToken: 2 });
  await drain(); host.render();
  assert.equal(host.tree.props['data-document-id'], 'immutable-B');
  posts[0].resolve({ documentId: document.id, content: 'stale revision bytes', start: 0, end: 20 });
  await drain(); host.render();
  assert.equal(find(host, node => node.props?.['aria-label'] === 'Original HTML source'), undefined);
});


test('HTML reader selection changes replace and clear the adapter action without rendering the legacy reader', async () => {
  let mountedOptions;
  const components = paperComponents({}, { modules: { '@pero/paper-reader': {
    mountPaperReader(_root, options) { mountedOptions = options; return { ready: Promise.resolve(), outline: [], updateAppearance() {}, dispose() {} }; },
  } }, globals: { AbortController, URL, location: { href: 'https://app.example/reader/' },
    fetch: async () => ({ ok: true, text: async () => '<article>Immutable original</article>' }), requestAnimationFrame() {},
  } });
  const host = components.mount(components.HtmlReading, { id: document.id, sourceUrl: document.source.url, recorded: false, children: 'Legacy full document', renderSelection: value => value.anchors.join(',') });
  await drain(); host.render();
  mountedOptions.onSelection(selection(['T1'])); host.render();
  assert.ok(JSON.stringify(host.tree).includes('T1'));
  assert.ok(!JSON.stringify(host.tree).includes('Legacy full document'));
  mountedOptions.onSelection(selection(['S2'])); host.render();
  assert.ok(JSON.stringify(host.tree).includes('S2'));
  assert.ok(!JSON.stringify(host.tree).includes('T1'));
  mountedOptions.onSelection(null); host.render();
  assert.equal(find(host, node => node.props?.className === 'pa-html-selection'), undefined);
});


test('an ongoing first parse exposes progress without a source action', async () => {
  const { host, posts } = await mount([scope], false);
  const prepare = find(host, node => node.type === 'Button' && node.props.children.includes('Prepare Read · '));
  prepare.props.onClick(); host.render();
  assert.equal(posts[0].body.operation, 'prepare');
  assert.equal(adapter(host), undefined, 'no stale document/source action is exposed while the first parse is pending');
  assert.equal(find(host, node => node.props?.role === 'status').props.children[0], 'preparing');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paperComponents, elements, drain } from './paper-component-harness.mjs';

const paper = { id: 'same-pdf', title: 'Saved paper', content: 'Original full text', contentKind: 'full-text' };
const chrome = () => ({ toolbar: null, preserveView: { current: null }, onNavigate() {}, onSave() {} });
const find = (host, predicate) => elements(host.tree, predicate)[0];
const errors = host => elements(host.tree, node => node.props?.kind === 'error');
const document = id => ({ id, source: { digest: 'same-bytes', version: 'v1', url: 'https://example.org/source' }, metadata: { authors: [], identifiers: [] }, blocks: [], warnings: [] });
const revision = scopes => ({ ...document('immutable-A'), scopes, parser: 'html' });
const scope = id => ({ bundleId: id, resourceId: `resource-${id}` });

function pendingApi() {
  const requests = [];
  return { requests, get(path) { return new Promise((resolve, reject) => requests.push({ path, resolve, reject })); } };
}

test('same-paper reopen refreshes scopes and rejects late previous overview and document responses', async () => {
  const api = pendingApi(), components = paperComponents(api), ready = [];
  components.storage.set('paper-read-revision:same-pdf', 'immutable-A');
  const host = components.mount(components.StructuredReading, { api, paperId: paper.id, openToken: 1, onReady: value => ready.push(value), onReview() {} });
  const overview = scopes => ({ revisions: [revision(scopes)], sources: [] });
  api.requests[0].resolve(overview([scope('A')])); await drain();
  assert.equal(api.requests[1].path, '/api/paper-documents/immutable-A');
  api.requests[1].resolve(document('immutable-A')); await drain(); host.render();
  assert.equal(host.tree.props['data-document-id'], 'immutable-A');
  host.render({ ...host.props, openToken: 2 });
  host.render({ ...host.props, openToken: 3 });
  api.requests[3].resolve(overview([scope('A'), scope('B')])); await drain();
  api.requests[4].resolve(document('immutable-A')); await drain();
  api.requests[2].resolve({ revisions: [{ id: 'obsolete' }], sources: [] }); await drain(); host.render();
  assert.deepEqual(api.requests.map(request => request.path), [
    '/api/paper-documents?paperId=same-pdf', '/api/paper-documents/immutable-A',
    '/api/paper-documents?paperId=same-pdf', '/api/paper-documents?paperId=same-pdf', '/api/paper-documents/immutable-A',
  ]);
  assert.deepEqual(Array.from(find(host, node => node.props?.label === 'Evidence bundle').props.options, option => option.value), ['', 'A:resource-A', 'B:resource-B']);
  assert.equal(errors(host).length, 0);
  host.render({ ...host.props, openToken: 4 });
  api.requests[5].resolve(overview([scope('A')])); await drain();
  host.render({ ...host.props, openToken: 5 });
  api.requests[6].resolve(document('obsolete')); await drain(); host.render();
  assert.equal(host.tree.props['data-document-id'], undefined);
  api.requests[7].reject(new Error('Current lookup failed')); await drain(); host.render();
  assert.ok(JSON.stringify(errors(host)).includes('Current lookup failed'));
  host.render({ ...host.props, openToken: 6 }); host.render();
  assert.equal(errors(host).length, 0, 'a fresh reopen clears the previous failure');
  host.unmount(); api.requests[8].reject(new Error('cancelled lookup')); await drain(); host.render();
  assert.equal(errors(host).length, 0);
  assert.equal(ready.at(-1), false);
});

test('explicit same-paper read forwards a new token while preserving PDF identity and full text', async () => {
  const api = { get: async () => ({ papers: [paper], intents: [], reports: [] }) };
  const components = paperComponents(api);
  components.storage.set('paper-agent.shelf', JSON.stringify({ [paper.id]: 'to-read' }));
  const app = components.mount(components.PaperAgent);
  await drain(); app.render();
  assert.equal(find(app, node => node.type === 'PaperList').props.shelf[paper.id], 'to-read');
  find(app, node => node.type === 'PaperList').props.onRead(paper); await drain(); app.render();
  assert.equal(JSON.parse(components.storage.get('paper-agent.shelf'))[paper.id], 'reading');
  const first = find(app, node => node.type === components.Reader);
  find(app, node => node.type === 'PaperList').props.onRead(paper); await drain(); app.render();
  const second = find(app, node => node.type === components.Reader);
  assert.ok(second.props.openToken > first.props.openToken);
  assert.equal(second.key, first.key);
  const reader = components.mount(components.Reader, first.props);
  const firstPdf = find(reader, node => node.type === components.PdfReader);
  reader.render(second.props);
  const secondPdf = find(reader, node => node.type === components.PdfReader);
  assert.equal(secondPdf.key, firstPdf.key);
  assert.equal(find(reader, node => node.type === components.StructuredReading).props.openToken, second.props.openToken);
  assert.equal(find(reader, node => node.type === 'ScientificContent').props.content, paper.content);
  app.unmount(); reader.unmount();
});

function pdfHost(api, overrides = {}) {
  const components = paperComponents(api);
  return components.mount(components.PdfReader, { api, paper, chrome: chrome(), t: key => key, ...overrides });
}
const viewer = host => find(host, node => node.props?.document && node.props?.annotations);

test('saving refreshes only a missing PDF and ignores a late refresh after navigation', async () => {
  const api = pendingApi(), host = pdfHost(api);
  const acquired = { document: { id: 'attached', fileDigest: 'same-bytes' }, annotations: [{ id: 'original-note' }] };
  api.requests[0].resolve(acquired); await drain(); host.render();
  const initial = viewer(host);
  host.render({ ...host.props, pdfReloadToken: 1 });
  assert.equal(api.requests.length, 1);
  assert.equal(viewer(host).key, initial.key);
  assert.equal(viewer(host).props.annotations, acquired.annotations);
  host.unmount();
  const missingApi = pendingApi(), missing = pdfHost(missingApi);
  missingApi.requests[0].resolve({ document: null, annotations: [] }); await drain(); missing.render();
  missing.render({ ...missing.props, pdfReloadToken: 1 });
  missingApi.requests[1].resolve(acquired); await drain(); missing.render();
  assert.equal(viewer(missing).props.document.id, 'attached');
  missing.unmount();
  const staleApi = pendingApi(), stale = pdfHost(staleApi);
  stale.render({ ...stale.props, pdfReloadToken: 1 });
  staleApi.requests[0].resolve({ document: { id: 'obsolete-initial' }, annotations: [] }); await drain(); stale.render();
  assert.equal(viewer(stale), undefined);
  stale.unmount(); staleApi.requests[1].resolve(acquired); await drain(); stale.render();
  assert.equal(viewer(stale), undefined); assert.equal(errors(stale).length, 0);
});

test('unlocking after export keeps explicit version focus ahead of a pending save refresh', async () => {
  const api = pendingApi(), host = pdfHost(api, { lockText: true, focus: { documentId: 'explicit-old-version' } });
  host.render({ ...host.props, pdfReloadToken: 1 });
  assert.equal(api.requests.length, 0);
  host.render({ ...host.props, lockText: false });
  assert.deepEqual(api.requests.map(request => request.path), ['/api/pdf/explicit-old-version']);
  api.requests[0].resolve({ document: { id: 'explicit-old-version' }, annotations: [] }); await drain(); host.render();
  assert.equal(viewer(host).props.document.id, 'explicit-old-version');
  assert.equal(viewer(host).props.active, true);
  assert.equal(errors(host).length, 0); host.unmount();
});

test('successful export still refreshes the Reader when Library refresh fails', async () => {
  let offline = false;
  const api = { async get() { if (offline) throw Error('Library offline'); return { papers: [paper], intents: [], reports: [] }; } };
  const components = paperComponents(api), app = components.mount(components.PaperAgent);
  await drain(); app.render();
  find(app, node => node.type === 'PaperList').props.onRead(paper); await drain(); app.render();
  const before = find(app, node => node.type === components.Reader).props.pdfReloadToken;
  find(app, node => node.type === 'PaperList').props.onDownload(paper); app.render(); offline = true;
  await find(app, node => node.type === 'LibrarySave').props.onSaved(); app.render();
  assert.equal(find(app, node => node.type === components.Reader).props.pdfReloadToken, before + 1);
  assert.ok(JSON.stringify(errors(app)).includes('Library offline')); app.unmount();
});

test('failed PDF lookup retries the same local GET without an acquisition', async () => {
  const api = pendingApi(), host = pdfHost(api);
  api.requests[0].reject(Error('Local lookup failed')); await drain(); host.render();
  assert.ok(JSON.stringify(errors(host)).includes('Local lookup failed'));
  find(host, node => node.type === 'Button' && node.props.children.includes('retry')).props.onClick(); host.render();
  assert.deepEqual(api.requests.map(request => request.path), ['/api/pdf?paperId=same-pdf', '/api/pdf?paperId=same-pdf']);
  api.requests[1].resolve({ document: null, annotations: [] }); await drain(); host.render();
  assert.equal(errors(host).length, 0); host.unmount();
});

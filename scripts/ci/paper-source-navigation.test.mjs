import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paperComponents, elements, drain } from './paper-component-harness.mjs';

const find = (host, predicate) => elements(host.tree, predicate)[0];

test('element search visits ContentPane header, toolbar, feedback and footer', () => {
  const slot = name => ({ type: 'Button', props: { 'aria-label': name, children: name } });
  const tree = { type: 'ContentPane', props: { header: slot('header'), toolbar: slot('toolbar'), feedback: slot('feedback'), footer: slot('footer'), children: 'body' } };
  for (const name of ['header', 'toolbar', 'feedback', 'footer']) {
    assert.equal(elements(tree, node => node.props?.['aria-label'] === name)[0]?.props['aria-label'], name);
  }
  assert.equal(elements({ type: 'ContentPane', props: { children: 'body' } }, node => node.props?.['aria-label'] === 'toolbar')[0], undefined);
});
const byType = (host, type) => find(host, node => node.type === type);
const bundle = { id: 'bundle', sourceDownloadIds: ['source'], pdfDownloadIds: ['pdf'], resources: [
  { id: 'source', kind: 'source_archive', revision: 'v1' }, { id: 'pdf', kind: 'pdf_candidate' },
] };
const receipt = { revision: 'v1', size: 100, archiveDigest: 'archive-digest' };
const match = { pdf: { documentId: 'immutable-pdf', fileDigest: 'pdf-digest', page: 3 } };
const observation = { anchor: { pdfResourceId: 'pdf' } };

for (const result of [true, false, 'reject']) test(`source dialog navigation ${result} closes only after confirmed success and handles failure`, async () => {
  let resolveRead, rejectRead, reads = 0, checks = 0;
  const api = { post: async path => {
    if (path === '/api/research/source') return { status: 'source_available', localAvailable: true, receipt };
    if (path === '/api/research/source-read') return { members: [], limitations: [] };
    assert.equal(path, '/api/research/pdf'); checks++;
    return { localAvailable: true, receipt: { paperId: 'paper', ...match.pdf } };
  } };
  const components = paperComponents(api);
  const sources = components.mount(components.ResearchSources, { api, bundle, startSourceIds: [], dialog: true,
    onRead(id, focus) { reads++; assert.equal(id, 'paper'); assert.equal(focus.documentId, match.pdf.documentId); assert.equal(focus.page, 3); return new Promise((resolve, reject) => { resolveRead = resolve; rejectRead = reject; }); },
  });
  await drain(); sources.render();
  find(sources, node => node.type === 'Button' && node.props['aria-haspopup'] === 'dialog').props.onClick(); sources.render();
  const browser = components.mount(components.SourceBrowser, byType(sources, 'SourceBrowser').props);
  await drain(); browser.render();
  byType(browser, 'SourceReports').props.openPdf(observation, match);
  await drain(); browser.render(); sources.render();
  assert.ok(byType(sources, 'Dialog'), 'dialog remains open while reader is unresolved');
  assert.equal(byType(browser, 'SourceReports').props.navigating, true);
  byType(browser, 'SourceReports').props.openPdf(observation, match);
  await drain();
  assert.equal(reads, 1); assert.equal(checks, 1, 'repeat navigation is guarded while pending');
  if (result === 'reject') rejectRead(new Error('Saved paper read failed')); else resolveRead(result);
  await drain(); sources.render(); browser.render();
  assert.equal(!!byType(sources, 'Dialog'), result !== true);
  assert.equal(byType(browser, 'SourceReports').props.navigating, false);
  const error = find(browser, node => node.props?.kind === 'error');
  if (result === true) assert.equal(error, undefined);
  else assert.match(JSON.stringify(error), result === false ? /Could not open the saved PDF/ : /Saved paper read failed/);
});

for (const fail of [false, true]) test(`app source navigation returns a successful opening result only for a readable paper (failure=${fail})`, async () => {
  const paper = { id: 'paper', title: 'Saved paper', content: 'Full text', contentKind: 'full-text' };
  const api = { get: async path => {
    if (path === '/api/papers/paper') { if (fail) throw new Error('Paper unavailable'); return paper; }
    return { papers: [paper], intents: [], reports: [] };
  } };
  const components = paperComponents(api), app = components.mount(components.PaperAgent);
  await drain(); app.render();
  byType(app, 'WorkspaceNav').props.onBundle(bundle.id); app.render();
  const opened = await byType(app, 'ResearchBundleView').props.onRead('paper', { documentId: 'immutable-pdf', page: 3 });
  app.render();
  assert.equal(opened, !fail);
  if (fail) assert.match(JSON.stringify(app.tree), /Paper unavailable/);
  else {
    const reader = byType(app, components.Reader);
    assert.equal(reader.props.paper.id, 'paper');
    assert.equal(reader.props.pdfFocus.documentId, 'immutable-pdf');
    assert.equal(reader.props.pdfFocus.page, 3);
  }
});

test('a failed full-paper read returns false, while a later Library refresh failure does not undo successful navigation', async () => {
  for (const failure of ['full-paper', 'refresh']) {
    let paperReads = 0, libraryReads = 0;
    const paper = { id: 'paper', title: 'Saved paper', contentKind: 'full-text' };
    const api = { get: async path => {
      if (path === '/api/papers/paper') {
        paperReads++;
        if (failure === 'full-paper' && paperReads === 2) throw new Error('Full paper unavailable');
        return failure === 'full-paper' ? paper : { ...paper, content: 'Full text' };
      }
      libraryReads++;
      if (failure === 'refresh' && libraryReads > 1) throw new Error('Library refresh unavailable');
      return { papers: [paper], intents: [], reports: [] };
    } };
    const components = paperComponents(api), app = components.mount(components.PaperAgent);
    await drain(); app.render();
    byType(app, 'WorkspaceNav').props.onBundle(bundle.id); app.render();
    assert.equal(await byType(app, 'ResearchBundleView').props.onRead('paper'), failure === 'refresh');
    app.render();
    assert.match(JSON.stringify(app.tree), failure === 'refresh' ? /Library refresh unavailable/ : /Full paper unavailable/);
  }
});

for (const stage of [1, 2]) for (const navigation of ['back', 'bundle']) test(`source navigation ignores late stage ${stage} after ${navigation}`, async () => {
  let resolvePaper, paperReads = 0;
  const paper = { id: 'paper', title: 'Saved paper', contentKind: 'full-text' };
  const api = { get: async path => {
    if (path === '/api/papers/paper') {
      paperReads++;
      if (paperReads === stage) return new Promise(resolve => { resolvePaper = resolve; });
      return paper;
    }
    return { papers: [paper], intents: [], reports: [] };
  } };
  const components = paperComponents(api), app = components.mount(components.PaperAgent);
  await drain(); app.render();
  byType(app, 'WorkspaceNav').props.onBundle('original-bundle'); app.render();
  const pending = byType(app, 'ResearchBundleView').props.onRead('paper', { documentId: 'old-pdf', page: 3 });
  await drain(); app.render();
  if (stage === 1 && navigation === 'bundle') byType(app, 'WorkspaceNav').props.onBundle('new-bundle');
  else {
    if (stage === 1) byType(app, 'AppBar').props.commands.props.onClick();
    else find(app, node => node.type === 'Button' && node.props['aria-label'] === 'backToLibrary').props.onClick();
    app.render();
    if (navigation === 'bundle') byType(app, 'WorkspaceNav').props.onBundle('new-bundle');
  }
  app.render();
  resolvePaper({ ...paper, content: 'Late full text' });
  assert.equal(await pending, false);
  app.render();
  assert.equal(byType(app, components.Reader), undefined, 'late completion does not install a stale reader or PDF focus');
  assert.equal(find(app, node => node.props?.className === 'pa-reading-screen').props.hidden, true);
  if (navigation === 'bundle') assert.equal(byType(app, 'ResearchBundleView').props.id, 'new-bundle');
});

test('a prior source opening cannot close a newly reopened dialog for the same resource', async () => {
  let resolveRead;
  const api = { post: async () => ({ status: 'source_available', localAvailable: true, receipt }) };
  const components = paperComponents(api), sources = components.mount(components.ResearchSources, { api, bundle, startSourceIds: [], dialog: true,
    onRead: () => new Promise(resolve => { resolveRead = resolve; }),
  });
  await drain(); sources.render();
  const toggle = () => { find(sources, node => node.type === 'Button' && node.props['aria-haspopup'] === 'dialog').props.onClick(); sources.render(); };
  toggle();
  const pending = byType(sources, 'SourceBrowser').props.onRead('paper', match.pdf);
  byType(sources, 'Dialog').props.onClose(); sources.render();
  toggle();
  resolveRead(true); await pending; sources.render();
  assert.ok(byType(sources, 'Dialog'), 'the newer same-source dialog remains open');
});

for (const stage of [1, 2]) test(`wrong paper identity at fetch stage ${stage} cannot set PDF focus or report success`, async () => {
  let reads = 0;
  const api = { get: async path => {
    if (path === '/api/papers/paper') { reads++; return { id: reads === stage ? 'wrong-paper' : 'paper', title: 'Paper', content: reads === 2 ? 'Full text' : '' }; }
    return { papers: [], intents: [], reports: [] };
  } };
  const components = paperComponents(api), app = components.mount(components.PaperAgent);
  await drain(); app.render();
  byType(app, 'WorkspaceNav').props.onBundle('bundle'); app.render();
  assert.equal(await byType(app, 'ResearchBundleView').props.onRead('paper', match.pdf), false);
  app.render();
  assert.equal(byType(app, components.Reader), undefined);
  assert.match(JSON.stringify(app.tree), /Saved paper identity does not match/);
});

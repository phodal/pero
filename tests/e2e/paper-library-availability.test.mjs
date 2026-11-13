import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { createUiRuntime } from '../../packages/app-sdk/test/ui-test-runtime.mjs';

const root = resolve(import.meta.dirname, '../..'), app = resolve(root, 'apps/paper-agent');
const output = mkdtempSync(join(tmpdir(), 'pero-library-availability-'));
let render, renderReader, renderDownloads;
try {
  const file = join(output, 'render.cjs');
  buildSync({ stdin: { contents: `import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';
import {AppApiProvider} from '@pero/app-sdk';
// Match the SDK preview host seam; SSR has no API or Host authority.
const unexpected = () => { throw new Error('SSR must not perform Host or network operations'); };
const renderWithHost = children => renderToStaticMarkup(<AppApiProvider appName="paper-agent" locale="en" allowedApiPaths={[]} allowedEvents={[]} fetch={unexpected} subscribeFn={unexpected} navigateFn={unexpected} notifyFn={unexpected}>{children}</AppApiProvider>);
import {loadShelf} from './apps/paper-agent/ui-src/shelf';import {LibraryPapers} from './apps/paper-agent/ui-src/library-papers';import {Reader} from './apps/paper-agent/ui-src/documents';import {messages} from './apps/paper-agent/ui-src/i18n';import {ResearchPdfDownloads} from './apps/paper-agent/ui-src/research-pdf-downloads';import {ResearchSources} from './apps/paper-agent/ui-src/research-sources';export const render=paper=>renderWithHost(<LibraryPapers api={{}} papers={[paper]} locked={false} loading={false} showDetails={true} shelf={loadShelf({getItem:()=>null})} filter="all" onFilter={()=>{}} onStatus={()=>{}} onRefresh={()=>{}} onImport={()=>{}} onRead={()=>{}} onRecords={()=>{}} onDiscover={()=>{}} onDownload={()=>{}} onSearchHit={async()=>{}} onFind={()=>{}} onCompare={()=>{}} t={key=>messages[key].en}/>);export const renderReader=paper=>renderWithHost(<Reader paper={paper} busy={false} openToken={0} api={{}} chrome={{toolbar:null,preserveView:{current:null},onNavigate(){},onSave(){}}} onFull={()=>{}} onDiscuss={()=>{}} onMatrixAdded={async()=>{}} onReview={()=>{}} t={key=>messages[key].en}/>);export const renderDownloads=(bundle,scopedIds)=>renderWithHost(<><ResearchPdfDownloads api={{}} bundle={bundle} startPdfIds={[]} scopedIds={scopedIds} onRead={()=>{}}/><ResearchSources api={{}} bundle={bundle} startSourceIds={[]} scopedIds={scopedIds} onRead={()=>{}}/></>);`, loader: 'tsx', resolveDir: root }, outfile: file, bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', loader: { '.css': 'empty', '.wasm': 'dataurl' },
    alias: { react: resolve(app, 'node_modules/react'), 'react-dom': resolve(app, 'node_modules/react-dom'), '@pero/app-sdk/ui': resolve(root, 'packages/app-sdk/src/ui.tsx'), '@pero/app-sdk': resolve(root, 'packages/app-sdk/src/index.tsx') }, nodePaths: [resolve(app, 'node_modules')], logLevel: 'silent' });
  ({ render, renderReader, renderDownloads } = createRequire(import.meta.url)(file));
} finally { rmSync(output, { recursive: true, force: true }); }

test('Library download menu is available only for a PDF candidate or saved PDF representation', async t => {
  const f = await createUiRuntime(t, { resolveDir: app, contents: `
    export { PaperInspectorHeader } from './ui-src/paper-inspector';
    export { messages } from './ui-src/i18n';
  ` });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const key = async (target, value) => {
    await f.React.act(async () => target.dispatchEvent(new f.dom.window.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true })));
    await f.React.act(async () => t.mock.timers.runAll());
  };
  const base = { id: 'paper', title: 'Fixture', source: 'import', contentKind: 'full-text', resourceKind: 'web_article', authors: [], url: 'https://example.org/article' };
  for (const [label, fields, available, savingId] of [
    ['article without PDF', {}, false],
    ['paper without PDF', { resourceKind: 'paper' }, false],
    ['remote PDF candidate', { pdfUrl: 'https://example.org/paper.pdf' }, true],
    ['unverified PDF candidate', { pdfCandidateUrl: 'https://example.org/candidate.pdf' }, true],
    ['imported local PDF', { source: 'local-pdf', hasCachedPdf: true }, true],
    ['local PDF with missing bytes and no URL', { source: 'local-pdf', hasCachedPdf: false }, false],
    ['metadata with cached PDF and no URL', { hasCachedPdf: true }, true],
    ['PDF save already in progress', { hasCachedPdf: true }, false, 'paper'],
  ]) {
    const paper = { ...base, ...fields };
    const html = render(paper);
    assert.match(html, /data-status="to-read"/, `${label}: new papers retain their default shelf status`);
    const downloads = [];
    await f.render(f.React.createElement(f.ui.PaperInspectorHeader, {
      paper, status: 'to-read', savingId, locked: false, t: key => f.ui.messages[key].en,
      onRead() {}, onStatus() {}, onDownload: (selected, format) => downloads.push([selected.id, format]),
    }));
    // Overflow actions are portalled only after opening the real menu, not in SSR.
    await key(document.querySelector('button[aria-label="More actions"]'), 'ArrowDown');
    const save = [...document.querySelectorAll('[role="menuitem"]')].find(item => item.textContent === 'Download PDF');
    assert.ok(save, `${label}: keep the unavailable action visible in the menu`);
    assert.equal(save.getAttribute('aria-disabled') === 'true', !available, label);
    await f.click(save);
    await f.React.act(async () => t.mock.timers.runAll());
    assert.deepEqual(downloads, available ? [[paper.id, 'pdf']] : [], `${label}: only available downloads run`);
    if (!available) await key(save, 'Escape');
    await f.render(null);
  }
});

test('image-only Reader shows its limitation, not a permanent loading state', () => {
  const base = { id: 'scan', title: 'Scanned PDF', source: 'local-pdf', contentKind: 'full-text', url: 'urn:sha256:fixture', authors: [] };
  const html = renderReader({ ...base, content: '', limitation: 'No selectable text. OCR is unavailable.' });
  assert.match(html, /No selectable text. OCR is unavailable\./);
  assert.doesNotMatch(html, /Loading/);
  assert.match(renderReader(base), /Loading/);
});


test('confirmation-scoped downloads intersect approved IDs without projecting historical resources', () => {
  const bundle = { id: 'reused', resources: [
    { id: 'old-pdf', kind: 'pdf_candidate', title: 'Historical cancelled PDF' },
    { id: 'new-pdf', kind: 'pdf_candidate', title: 'Current fixed PDF' },
    { id: 'old-source', kind: 'source_archive', title: 'Historical cancelled source' },
    { id: 'new-source', kind: 'source_archive', title: 'Current fixed source' },
    { id: 'unapproved', kind: 'pdf_candidate', title: 'Unapproved candidate' },
  ], pdfDownloadIds: ['old-pdf', 'new-pdf'], sourceDownloadIds: ['old-source', 'new-source'] };
  const scoped = renderDownloads(bundle, ['new-pdf', 'new-source', 'unapproved']);
  assert.match(scoped, /Current fixed PDF/); assert.match(scoped, /Current fixed source/);
  assert.doesNotMatch(scoped, /Historical cancelled/); assert.doesNotMatch(scoped, /Unapproved candidate/);
  assert.match(renderDownloads(bundle), /Historical cancelled PDF/);
  assert.match(renderDownloads(bundle), /Historical cancelled source/);
  assert.equal(renderDownloads(bundle, []), '', 'an empty confirmation has no download projection');
});

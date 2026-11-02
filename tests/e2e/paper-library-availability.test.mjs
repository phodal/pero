import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';

const root = resolve(import.meta.dirname, '../..'), app = resolve(root, 'apps/paper-agent');
const output = mkdtempSync(join(tmpdir(), 'pero-library-availability-'));
let render, renderReader;
try {
  const file = join(output, 'render.cjs');
  buildSync({ stdin: { contents: `import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {PaperList} from './apps/paper-agent/ui-src/library';import {Reader} from './apps/paper-agent/ui-src/documents';import {messages} from './apps/paper-agent/ui-src/i18n';export const render=paper=>renderToStaticMarkup(<PaperList papers={[paper]} selecting={false} selected={[]} readingId="" locked={false} onSelect={()=>{}} onRead={()=>{}} onDownload={()=>{}} t={key=>messages[key].en}/>);export const renderReader=paper=>renderToStaticMarkup(<Reader paper={paper} busy={false} openToken={0} api={{}} chrome={{toolbar:null,preserveView:{current:null},onNavigate(){},onSave(){}}} onFull={()=>{}} onDiscuss={()=>{}} onMatrixAdded={async()=>{}} onReview={()=>{}} t={key=>messages[key].en}/>);`, loader: 'tsx', resolveDir: root }, outfile: file, bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', loader: { '.css': 'empty', '.wasm': 'dataurl' },
    alias: { react: resolve(app, 'node_modules/react'), 'react-dom': resolve(app, 'node_modules/react-dom'), '@pero/app-sdk/ui': resolve(root, 'packages/app-sdk/src/ui.tsx'), '@pero/app-sdk': resolve(root, 'packages/app-sdk/src/index.tsx') }, nodePaths: [resolve(app, 'node_modules')], logLevel: 'silent' });
  ({ render, renderReader } = createRequire(import.meta.url)(file));
} finally { rmSync(output, { recursive: true, force: true }); }

test('Library Save is available only for a PDF candidate or saved PDF representation', () => {
  const base = { id: 'paper', title: 'Fixture', source: 'import', contentKind: 'full-text', resourceKind: 'web_article', authors: [], url: 'https://example.org/article' };
  for (const [label, fields, available] of [
    ['article without PDF', {}, false],
    ['paper without PDF', { resourceKind: 'paper' }, false],
    ['remote PDF candidate', { pdfUrl: 'https://example.org/paper.pdf' }, true],
    ['imported local PDF', { source: 'local-pdf', hasCachedPdf: true }, true],
    ['local PDF with missing bytes and no URL', { source: 'local-pdf', hasCachedPdf: false }, false],
    ['metadata with cached PDF and no URL', { hasCachedPdf: true }, true],
  ]) {
    const html = render({ ...base, ...fields });
    const save = html.match(/<button\b([^>]*)>[^<]*Save<\/button>/);
    assert.ok(save, `${label}: keep the unavailable action visible`);
    assert.equal(/\bdisabled(?:=|\s|$)/.test(save[1]), !available, label);
  }
});

test('image-only Reader shows its limitation, not a permanent loading state', () => {
  const base = { id: 'scan', title: 'Scanned PDF', source: 'local-pdf', contentKind: 'full-text', url: 'urn:sha256:fixture', authors: [] };
  const html = renderReader({ ...base, content: '', limitation: 'No selectable text. OCR is unavailable.' });
  assert.match(html, /No selectable text. OCR is unavailable\./);
  assert.doesNotMatch(html, /Loading/);
  assert.match(renderReader(base), /Loading/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { initializeMystCitations } from '../src/myst-citations.ts';
import { compileMystProjectCitations } from '../src/myst-project-citations.ts';
import { compileMystProject } from '../src/myst-project.ts';
import { renderMystProjectHtml } from '../src/myst-project-render.ts';
import { mystProjectExportFormats } from '../src/myst-project-formats.ts';
import { importMystProjectSnapshot } from '../src/myst-project-snapshot.ts';

const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('Citation projection must not fetch'); };
test.after(() => { globalThis.fetch = originalFetch; });
await initializeMystCitations(await readFile(new URL(import.meta.resolve('refkit-js/refkit.wasm'))));
const style = '<?xml version="1.0"?><style xmlns="http://purl.org/net/xbiblio/csl" version="1.0" class="in-text"><info><title>Local Numeric</title><id>https://example.invalid/local</id><updated>2024-01-01T00:00:00Z</updated></info><citation><layout prefix="[" suffix="]" delimiter=", "><text variable="citation-number"/></layout></citation><bibliography><layout><text variable="citation-number" suffix=": "/><text variable="title"/></layout></bibliography></style>';
const refs = JSON.stringify([{ id: 'Alpha', type: 'book', title: 'Alpha book' }, { id: 'Beta', type: 'book', title: 'Beta book' }, { id: 'Hidden', type: 'book', title: 'Hidden bibliography sentinel' }]);
const snapshot = (entry: string, files: { path: string; text: string }[]) => importMystProjectSnapshot(JSON.stringify({ format: 'pero-myst-project', version: 1, entry, files }));

test('typed async projection preserves source/custom XML and shared HTML descriptor matches preview', async () => {
  const project = snapshot('pages/article.md', [
    { path: 'myst.yml', text: 'version: 1\nproject:\n  bibliography: refs.json\n  pero:\n    citation:\n      style: styles/local.csl\n' },
    { path: 'pages/article.md', text: '# Article\n\n[@Beta; @Alpha] then [@Beta].' },
    { path: 'styles/local.csl', text: style }, { path: 'refs.json', text: refs },
  ]);
  const before = JSON.stringify(project), base = compileMystProject(project), baseBefore = JSON.stringify(base);
  const projection = await compileMystProjectCitations(project, base);
  assert.equal(projection.entry.kind, 'myst');
  if (projection.entry.kind !== 'myst') return;
  assert.equal(projection.entry.document.citationRendering?.style.path, 'styles/local.csl');
  assert.equal(projection.entry.document.citationRendering?.citations['pages/article.md:cite-1'].text, '[1, 2]');
  assert.ok(!projection.diagnostics.some(item => item.code === 'resource-unused' && item.path === 'styles/local.csl'));
  const raw = JSON.stringify({ format: 'pero-myst-project', version: 1, ...project });
  const format = mystProjectExportFormats.find(item => item.id === 'html')!;
  assert.equal(await format.serialize({ snapshot: raw, projection }), renderMystProjectHtml(projection));
  assert.equal(await format.serialize({ snapshot: raw }), renderMystProjectHtml(projection));
  assert.equal(JSON.stringify(project), before);
  assert.equal(JSON.stringify(base), baseBefore);
});

test('invalid extension fields, missing/remote styles and unavailable locales diagnose rather than defaulting', async () => {
  for (const settings of ['style: missing.csl', 'style: https://example.invalid/a.csl', 'locale: custom.xml', 'unexpected: true', 'style: 42']) {
    const project = snapshot('article.md', [{ path: 'article.md', text: '[@Alpha]' }, { path: 'refs.json', text: refs }, { path: 'myst.yml', text: `version: 1\nproject:\n  bibliography: refs.json\n  pero:\n    citation:\n      ${settings}\n` }]);
    const result = await compileMystProjectCitations(project, compileMystProject(project));
    assert.equal(result.entry.kind, 'myst');
    if (result.entry.kind !== 'myst') continue;
    assert.equal(result.entry.document.citationRendering, undefined, settings);
    assert.ok(result.diagnostics.some(item => item.code.startsWith('citation-')), settings);
  }
});

test('notebook numeric history spans visible cells, inherits first-cell settings and emits bibliography once', async () => {
  const raw = JSON.stringify({ nbformat: 4, nbformat_minor: 5, metadata: { bibliography: '../refs.json', pero: { citation: { style: 'missing-notebook.csl', locale: 'fr-FR' } } }, cells: [
    { id: 'first', cell_type: 'markdown', metadata: {}, source: '---\npero:\n  citation:\n    style: styles/local.csl\n    locale: de-DE\n---\n[@Beta]' },
    { id: 'hidden', cell_type: 'markdown', metadata: { tags: ['hide-cell'] }, source: 'Hidden cell sentinel [@Hidden]' },
    { id: 'later', cell_type: 'markdown', metadata: {}, source: '[@Alpha] then [@Beta].' },
  ] }, null, 2) + '\n';
  const project = snapshot('books/study.ipynb', [{ path: 'books/study.ipynb', text: raw }, { path: 'refs.json', text: refs }, { path: 'books/styles/local.csl', text: style }, { path: 'myst.yml', text: 'version: 1\nproject:\n  pero:\n    citation:\n      style: missing-project.csl\n      locale: en-US\n' }]);
  const base = compileMystProject(project), result = await compileMystProjectCitations(project, base);
  assert.equal(result.entry.kind, 'ipynb');
  if (result.entry.kind !== 'ipynb') return;
  const rendering = result.entry.citationRendering!;
  assert.ok(rendering, JSON.stringify(result.diagnostics));
  assert.equal(rendering.locale, 'de-DE');
  assert.equal(rendering.style.path, 'books/styles/local.csl');
  assert.deepEqual(Object.keys(rendering.citations), ['books/study.ipynb:cite-1', 'books/study.ipynb:cite-2', 'books/study.ipynb:cite-3']);
  assert.deepEqual(Object.values(rendering.citations).map(item => item.text), ['[1]', '[2]', '[1]']);
  assert.deepEqual(rendering.bibliography.map(item => item.id), ['beta', 'alpha']);
  assert.deepEqual((await compileMystProjectCitations(project, base)).entry, result.entry);
  assert.equal(result.entry.document.source, raw);
  assert.equal(project.files[0].text, raw);
  const html = renderMystProjectHtml(result);
  assert.equal((html.match(/aria-label="References"/g) ?? []).length, 1);
  assert.doesNotMatch(html, /Hidden cell sentinel|Hidden bibliography sentinel/);
  assert.equal(result.entry.markdownCells[1].document.citationRendering, undefined);
});

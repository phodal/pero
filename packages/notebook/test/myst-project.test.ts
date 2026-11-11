import test from 'node:test';
import assert from 'node:assert/strict';
import { compileMystProject } from '../src/myst-project.ts';
import { parseMystProjectSnapshot, exportMystProjectSnapshot, replaceMystProjectResource } from '../src/myst-project-snapshot.ts';
import { mystProjectImportFormats, mystProjectExportFormats } from '../src/myst-project-formats.ts';
import { renderMystHtml } from '../src/myst-render.ts';
import { parseMystDocument, parseMystSource, resolveMystDocument } from '../src/myst.ts';
import { projectNotebook } from '../src/interchange.ts';

const project = (files: Record<string, string>, entry = 'pages/article.md') => parseMystProjectSnapshot({ format: 'pero-myst-project', version: 1, entry, files: Object.entries(files).map(([path, text]) => ({ path, text })) });
const bibtex = String.raw`@string{journal = "Journal of Examples"}
@article{García2024, title={An {Example}}, author={Garc{\'i}a, Jos{\'e} and {Research Group}}, year={2024}, journal=journal, doi={10.1234/example}}
@inproceedings{Child, title={Child paper}, crossref={Parent}}
@proceedings{Parent, title={Proceedings}, year={2020}}`;
const files = {
  'myst.yml': 'version: 1\nproject:\n  title: Project title\n  authors:\n    - name: Alice Smith\n      affiliations: [lab]\n  affiliations:\n    - id: lab\n      name: Example Lab\n  bibliography: refs.bib\n',
  'pages/article.md': '---\ntitle: Page title\n---\nCitations {cite}`García2024` and @Child.\n',
  'refs.bib': bibtex,
};

test('project uses official metadata inheritance and explicit BibTeX records without changing source', () => {
  const snapshot = project(files);
  const result = compileMystProject(snapshot);
  assert.equal(result.entry.document.scholarly.title, 'Page title');
  assert.equal(result.entry.document.scholarly.authors?.[0].name, 'Alice Smith');
  assert.equal(result.entry.document.scholarly.affiliations?.[0].name, 'Example Lab');
  assert.equal(result.entry.document.bibliography['garcía2024'].author, 'José García, Research Group');
  assert.equal(result.entry.document.bibliography.child.year, '2020');
  assert.equal(result.pages[0].bibliography[0].csl['container-title'], 'Journal of Examples');
  assert.equal(result.pages[0].bibliography[0].id, 'García2024');
  assert.equal(result.pages[0].bibliography[0].path, 'refs.bib');
  assert.ok(!result.diagnostics.some(d => d.code === 'citation-unresolved'));
  assert.equal(result.entry.document.source, files['pages/article.md']);
  assert.equal(snapshot.files.find(f => f.path === 'refs.bib')!.text, bibtex);
  const noTitle = compileMystProject(replaceMystProjectResource(snapshot, snapshot.entry, 'No page title.'));
  assert.equal(noTitle.entry.document.scholarly.title, undefined, 'project title is deliberately not inherited');
  const override = compileMystProject(replaceMystProjectResource(snapshot, snapshot.entry, '---\nauthors:\n  - name: Page Author\n---\nText'));
  assert.equal(override.entry.document.scholarly.authors?.[0].name, 'Page Author');
});

test('project and page declarations resolve from their own file, preserve full CSL and diagnose ambiguity', () => {
  const snapshot = project({ ...files, 'pages/article.md': '---\nbibliography: local.json\npero:\n  bibliography:\n    - id: legacy\n      title: Local\n---\n@shared @legacy @csl',
    'refs.bib': '@article{shared,title={One}}\n@article{legacy,title={Conflict}}',
    'pages/local.json': JSON.stringify([{ id: 'shared', type: 'book', title: 'Two' }, { id: 'csl', type: 'article-journal', title: 'CSL title', author: [{ literal: 'Group' }], issued: { 'date-parts': [[2025]] }, DOI: '10.1234/test', custom: { all: ['retained'] } }]),
  });
  const result = compileMystProject(snapshot);
  assert.equal(result.entry.document.bibliography.shared, undefined);
  assert.equal(result.entry.document.bibliography.legacy, undefined);
  assert.equal(result.entry.document.bibliography.csl.author, 'Group');
  assert.equal(result.entry.document.bibliography.csl.year, '2025');
  assert.equal(result.entry.document.bibliography.csl.url, 'https://doi.org/10.1234/test');
  assert.equal(result.diagnostics.filter(d => d.code === 'citation-ambiguous').length, 2);
  assert.equal(result.diagnostics.filter(d => d.code === 'citation-unresolved').length, 2);
  assert.deepEqual(result.pages[0].bibliography.at(-1)?.csl.custom, { all: ['retained'] });
});

test('missing resources, unsafe paths, inert includes/plugins and malformed bibliographies are visible', () => {
  const snapshot = project({
    'myst.yml': 'version: 1\nproject:\n  bibliography: [missing.bib, "https://example.org/x.bib", broken.json]\n  plugins: [plugin.js]',
    'pages/article.md': '```{include} ../provided.txt\n```\n```{literalinclude} ../../escape.txt\n```\n![Image](missing.png)\n@missing',
    'provided.txt': '<script>throw Error("must not run")</script>',
    'broken.json': '{}',
    'unread.txt': 'preserved',
  });
  const result = compileMystProject(snapshot);
  for (const code of ['resource-missing', 'resource-unsupported', 'include-unsupported', 'bibliography-invalid', 'project-feature-inert', 'citation-unresolved', 'resource-unused']) assert.ok(result.diagnostics.some(d => d.code === code), code);
  assert.ok(result.diagnostics.some(d => d.code === 'html-inert' && d.path === 'provided.txt'));
  assert.ok(renderMystHtml(result.entry.document).includes('&lt;script&gt;'));
  assert.ok(!renderMystHtml(result.entry.document).includes('<script>'));
  assert.deepEqual(result, compileMystProject(snapshot));
});

test('direct forced BibTeX input never treats a URL as a remote bibliography and malicious CSL is inert', () => {
  const snapshot = project({ ...files, 'refs.bib': 'https://example.org/never-fetch.bib', 'pages/article.md': '---\nbibliography: refs.json\n---\n@evil', 'pages/refs.json': JSON.stringify([{ id: 'evil', type: 'book', title: '<img src=x onerror=alert(1)>', URL: 'javascript:alert(1)' }]) });
  const result = compileMystProject(snapshot);
  assert.ok(result.diagnostics.some(d => d.code === 'bibliography-empty'));
  const html = renderMystHtml(result.entry.document);
  assert.ok(!html.includes('<img src=x'));
  assert.ok(!html.includes('href="javascript:'));
  assert.match(html, /&lt;img/);
});

test('source parsing and typed resolution are separate without changing standalone behavior', () => {
  const source = '---\npero:\n  bibliography:\n    - id: reference\n      title: Test\n---\n@reference @missing';
  assert.deepEqual(resolveMystDocument(parseMystSource(source)), parseMystDocument(source));
  const parsed = parseMystSource('@known');
  assert.ok(!parsed.diagnostics.some(d => d.code === 'citation-unresolved'));
  const resolved = resolveMystDocument(parsed, { bibliography: { known: { id: 'known', title: 'Resolved once' } }, scholarly: {}, diagnostics: [] });
  assert.ok(!resolved.diagnostics.some(d => d.code === 'citation-unresolved'));
  assert.equal(parsed.ast.children?.[0].children?.[0].resolved, undefined);
});

test('project codecs preserve all resource text and expose exact recovery bytes for future versions', async () => {
  const snapshot = project({ ...files, 'unused.txt': 'α\r\n\t"\\' });
  const wire = exportMystProjectSnapshot(snapshot);
  const attrs = mystProjectImportFormats[0].parse(wire);
  assert.equal(attrs.snapshot, wire);
  assert.equal(mystProjectExportFormats[0].serialize(attrs), wire);
  assert.match(await mystProjectExportFormats[1].serialize(attrs), /Example Lab/);
  const future = '{"format":"pero-myst-project","version":9}';
  assert.equal(mystProjectExportFormats[0].serialize({ snapshot: future }), future);
  assert.throws(() => mystProjectImportFormats[0].parse(future));
});

test('Notebook interchange retains project authority and reports both lossy export projections', () => {
  const content = { type: 'doc', content: [{ type: 'mystProject', attrs: { blockId: 'project-1', schemaVersion: 1, snapshot: exportMystProjectSnapshot(project(files)) } }] };
  const projection = projectNotebook(content);
  assert.deepEqual(projection.canonical, content);
  assert.equal(projection.losses.filter(loss => loss.code === 'myst-project-snapshot').length, 2);
});

test('unsupported config versions and malformed scholarly input remain visible without applying project defaults', () => {
  const future = compileMystProject(project({ ...files, 'myst.yml': 'version: 9\nproject:\n  authors:\n    - name: Future Author' }));
  assert.equal(future.entry.document.scholarly.authors, undefined);
  assert.ok(future.diagnostics.some(d => d.code === 'project-config-version'));
  const invalid = compileMystProject(project({ ...files, 'myst.yml': 'project:\n  authors: [null]\n  date: today' }));
  assert.ok(invalid.diagnostics.some(d => d.code === 'frontmatter-validator-error'));
  assert.ok(invalid.diagnostics.some(d => d.code === 'frontmatter-date'));
  const duplicates = compileMystProject(project({ ...files, 'refs.bib': '@article{Study,title={One}}\n@article{study,title={Two}}', 'pages/article.md': '@Study' }));
  assert.equal(duplicates.entry.document.bibliography.study, undefined);
  assert.ok(duplicates.diagnostics.some(d => d.code === 'citation-ambiguous'));
});

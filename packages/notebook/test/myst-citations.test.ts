import test from 'node:test';
import { renderMystHtml } from '../src/myst-render.ts';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { initializeMystCitations, renderMystCitations } from '../src/myst-citations.ts';
import { parseMystSource, resolveMystDocument } from '../src/myst.ts';
import { resolveMystBibliography } from '../src/myst-bibliography.ts';

const fetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('No network during citation compilation'); };
test.after(() => { globalThis.fetch = fetch; });
await initializeMystCitations(await readFile(new URL(import.meta.resolve('refkit-js/refkit.wasm'))));
const records = [
  { id: 'Alpha', type: 'article-journal', title: 'First study', author: [{ family: 'Smith', given: 'Amy' }], issued: { 'date-parts': [[2024]] } },
  { id: 'Beta', type: 'article-journal', title: 'Second study', author: [{ family: 'Jones', given: 'Bill' }], issued: { 'date-parts': [[2023]] } },
];
const bibliography = resolveMystBibliography([{ path: 'refs.json', text: JSON.stringify(records) }], {}, 'article.md');
const document = (source: string) => resolveMystDocument(parseMystSource(source), { bibliography: bibliography.entries, scholarly: {}, diagnostics: [] });
const style = (citation: string, bib = '<text variable="title"/>') => ({ path: 'style.csl', text: `<?xml version="1.0"?><style xmlns="http://purl.org/net/xbiblio/csl" version="1.0" class="in-text"><info><title>Local Research Style</title><id>https://example.invalid/style</id><updated>2024-01-01T00:00:00+00:00</updated></info>${citation}<bibliography><sort><key variable="title"/></sort><layout suffix=".">${bib}</layout></bibliography></style>` });

test('real APA engine formats groups, locators, narrative cites and style-sorted bibliography offline', () => {
  const source = '[@Alpha, pp. 12–14; @Beta] and @Alpha.';
  const original = document(source), before = JSON.stringify(original);
  const rendered = renderMystCitations(original, bibliography.records, undefined, { namespace: 'article.md' });
  assert.deepEqual(rendered.diagnostics, original.diagnostics);
  assert.equal(rendered.citationRendering?.engine, 'refkit-js@0.4.0');
  assert.equal(rendered.citationRendering?.citations['article.md:cite-1'].text, '(Jones, 2023; Smith, 2024, pp. 12–14)');
  assert.equal(rendered.citationRendering?.citations['article.md:cite-2'].text, 'Smith (2024)');
  assert.deepEqual(rendered.citationRendering?.bibliography.map(item => item.id), ['beta', 'alpha']);
  assert.match(rendered.citationRendering!.bibliography[0].html, /<i>Second study<\/i>/);
  assert.equal(rendered.source, source);
  const html = renderMystHtml(rendered);
  assert.match(html, /refkit-js@0\.4\.0/);
  assert.match(html, /Jones, 2023; Smith, 2024, pp. 12–14/);
  assert.equal((html.match(/aria-label="References"/g) ?? []).length, 1);
  assert.doesNotMatch(renderMystHtml(rendered, { bibliography: false }), /aria-label="References"/);
  assert.equal(JSON.stringify(original), before);
});

test('supplied XML changes genuine numeric output and groups occur once with stable IDs', () => {
  const custom = style('<citation><layout prefix="[" suffix="]" delimiter=", "><text variable="citation-number"/></layout></citation>', '<text variable="citation-number" suffix=": "/><text variable="title" font-style="italic"/>');
  const source = '[@Beta; @Alpha] then [@Beta].';
  const run = () => renderMystCitations(document(source), bibliography.records, custom, { namespace: 'article.md' });
  const rendered = run();
  assert.equal(rendered.citationRendering?.citations['article.md:cite-1'].text, '[2, 1]');
  assert.equal(rendered.citationRendering?.citations['article.md:cite-2'].text, '[2]');
  assert.deepEqual(rendered.citationRendering?.bibliography.map(item => item.text), ['1: First study.', '2: Second study.']);
  assert.equal(rendered.citationRendering?.style.title, 'Local Research Style');
  assert.deepEqual(run(), rendered);
  assert.equal(rendered.source, source);
  assert.ok(custom.text.startsWith('<?xml version="1.0"?>'));
});

test('structured output escapes hostile data and admits only fixed formatting tags', () => {
  const hostile = resolveMystBibliography([{ path: 'refs.json', text: JSON.stringify([{ id: 'x', type: 'book', title: '<img src=x onerror="alert(1)"><script>bad()</script>', URL: 'javascript:alert(1)' }]) }], {}, 'article.md');
  const original = resolveMystDocument(parseMystSource('[@x]'), { bibliography: hostile.entries, scholarly: {}, diagnostics: [] });
  const result = renderMystCitations(original, hostile.records, style('<citation><layout><text variable="title" font-style="italic"/></layout></citation>', '<text variable="title"/><text variable="URL"/>'));
  assert.ok(result.citationRendering, JSON.stringify(result.diagnostics));
  const html = Object.values(result.citationRendering.citations).map(value => value.html).join('') + result.citationRendering.bibliography.map(value => value.html).join('');
  assert.doesNotMatch(html, /<(?:img|script|a)\b/i);
  assert.match(html, /&lt;img/);
  assert.match(html, /<i>/);
});

test('malformed, dependent, recursive, note styles and unknown locales retain source and explicit fallback', () => {
  const invalid = [
    { resource: { path: 'bad.csl', text: '<style>' } },
    { resource: { path: 'dependent.csl', text: '<style xmlns="http://purl.org/net/xbiblio/csl" version="1.0"><info><title>Dependent</title><id>https://example.invalid/child</id><link href="https://example.invalid/parent" rel="independent-parent"/><updated>2024-01-01T00:00:00Z</updated></info></style>' } },
    { resource: style('<macro name="loop"><text macro="loop"/></macro><citation><layout><text macro="loop"/></layout></citation>') },
    ...['note', 'n&#111;te'].map(note => ({ resource: { ...style('<citation><layout><text variable="title"/></layout></citation>'), text: style('<citation><layout><text variable="title"/></layout></citation>').text.replace('class="in-text"', `class="${note}"`) } })),
    { locale: 'locales/custom.xml' },
    { source: '[see @Alpha]' },
    { source: '[@Alpha, arbitrary suffix]' },
  ];
  for (const row of invalid) {
    const original = document(row.source ?? '[@Alpha]');
    const result = renderMystCitations(original, bibliography.records, row.resource, { namespace: 'article.md', locale: row.locale });
    assert.equal(result.citationRendering, undefined);
    assert.match(result.diagnostics.at(-1)!.message, /retained; no styled output/);
    assert.equal(result.source, original.source);
    assert.deepEqual(result.ast, original.ast);
  }
});

test('author/year partials use engine and document work is bounded', () => {
  const result = renderMystCitations(document('{cite:author}`Alpha` {cite:year}`Beta`'), bibliography.records);
  assert.deepEqual(Object.values(result.citationRendering!.citations).map(item => item.text), ['Smith', '2023']);
  const tooMany = renderMystCitations(document('[@Alpha]'), Array(1001).fill(bibliography.records[0]));
  assert.match(tooMany.diagnostics.at(-1)!.message, /1000 bibliography records/);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { renderMystHtml } from '../src/myst-render.ts';
import type { MystDocument, MystNode } from '../src/myst.ts';

function publication(children: MystNode[], overrides: Partial<MystDocument> = {}): MystDocument {
  return { version: 1, source: '# Original source', metadata: {}, scholarly: {}, ast: { type: 'root', children },
    references: {}, bibliography: {}, diagnostics: [], ...overrides };
}
const text = (value: string): MystNode => ({ type: 'text', value });

test('static publication renders scientific structures, math and resolved references', () => {
  const html = renderMystHtml(publication([
    { type: 'heading', depth: 1, children: [text('A result')] },
    { type: 'paragraph', children: [text('Inline '), { type: 'inlineMath', value: 'x^2' }] },
    { type: 'math', identifier: 'eq-a', value: '\\frac{a}{b}' },
    { type: 'crossReference', identifier: 'eq-a' },
    { type: 'container', kind: 'figure', identifier: 'fig-a', children: [{ type: 'image', url: 'https://example.com/a.png', alt: 'A figure' }] },
    { type: 'table', children: [{ type: 'tableRow', children: [{ type: 'tableCell', header: true, children: [text('Result')] }] }] },
    { type: 'admonition', children: [{ type: 'admonitionTitle', children: [text('Note')] }, { type: 'paragraph', children: [text('Reproduce carefully.')] }] },
    { type: 'list', ordered: true, start: 2, children: [{ type: 'listItem', children: [text('Item')] }] },
    { type: 'blockquote', children: [text('Quote')] },
    { type: 'cite', identifier: 'smith' },
  ], {
    references: { 'eq-a': { identifier: 'eq-a', kind: 'equation', number: 1, label: 'Equation 1' }, 'fig-a': { identifier: 'fig-a', kind: 'figure', number: 1, label: 'Figure 1' } },
    bibliography: { smith: { id: 'smith', author: 'Smith', title: 'A study', year: '2025', url: 'https://example.com/study' } },
  }));
  for (const expected of ['<h1>A result</h1>', '<math', '<mfrac>', 'id="myst-eq-a"', 'href="#myst-eq-a"', 'Equation 1', 'Figure 1', '<th scope="col">Result</th>', '<aside>', '<ol start="2">', '<blockquote>Quote</blockquote>', 'href="#myst-citation-smith"', 'Smith. 2025. A study', 'Authored citation metadata; not externally verified.']) assert.ok(html.includes(expected), expected);
  assert.doesNotMatch(html, /<script|<img|<iframe|<link\b/);
  assert.match(html, /image not embedded/);
});

test('authored markup, URLs, metadata, source and unknown nodes remain inert and visible', () => {
  const attack = '</pre><script>alert(1)</script>';
  const html = renderMystHtml(publication([
    { type: 'html', value: attack },
    { type: 'paragraph', children: [text('<img onerror="attack()">')] },
    { type: 'link', url: 'javascript:alert(1)', children: [text('Unsafe link')] },
    { type: 'image', url: 'data:image/svg+xml,<svg onload="attack()">', alt: attack },
    { type: 'link', url: 'file:///etc/passwd', children: [text('Local file')] },
    { type: 'link', url: '//example.com/track', children: [text('Protocol relative')] },
    { type: 'link', url: 'https://example.com/?q=" onclick="attack()', children: [text('Safe link')] },
    { type: 'mystDirective', name: 'include', value: '/etc/passwd' },
    { type: 'crossReference', identifier: 'missing' },
    { type: 'cite', identifier: 'missing' },
  ], { source: attack, metadata: { title: attack }, diagnostics: [{ severity: 'warning', code: 'test', message: attack }] }));
  assert.doesNotMatch(html, /<script|<img|<iframe|href="(?:javascript|data|file):|href="\/\/| onclick=/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /html: preview unavailable/);
  assert.match(html, /mystDirective: preview unavailable/);
  assert.match(html, /Unresolved reference: missing/);
  assert.match(html, /Unresolved citation: missing/);
  assert.match(html, /default-src 'none'/);
  assert.match(html, /Original MyST source/);
});

test('math cannot activate trusted HTML or remote resource extensions', () => {
  const html = renderMystHtml(publication([
    { type: 'math', value: '\\href{javascript:alert(1)}{x}' },
    { type: 'math', value: '\\includegraphics{https://example.com/tracker.png}' },
    { type: 'inlineMath', value: '\\htmlClass{evil}{x}' },
    { type: 'math', value: '\\invalidcommand{' },
  ]));
  assert.doesNotMatch(html, /<a\b|<img\b|class="evil"|<script/);
  assert.match(html, /katex-error|merror|\\invalidcommand/);
});

test('official parser output publishes numbered equations, figures and tables without losing source', async () => {
  const { parseMystDocument } = await import('../src/myst.ts');
  const source = `---
title: Scientific result
pero:
  bibliography:
    - id: smith
      title: Measurement
      author: Smith
      year: '2025'
---
# Result

See {eq}\`eq:mass\`, {ref}\`fig:setup\`, {ref}\`tab:data\` and {cite}\`smith\`.

\`\`\`{math}
:label: eq:mass
E = mc^2
\`\`\`

\`\`\`{figure} setup.png
:name: fig:setup
Setup caption.
\`\`\`

\`\`\`{list-table} Data
:name: tab:data
:header-rows: 1

* - Name
  - Value
* - mass
  - 1
\`\`\`
`;
  const document = parseMystDocument(source);
  const html = renderMystHtml(document);
  for (const target of ['eq~3a~mass', 'fig~3a~setup', 'tab~3a~data']) {
    assert.ok(html.includes(`id="myst-${target}"`), target);
    assert.ok(html.includes(`href="#myst-${target}"`), target);
  }
  assert.match(html, /<math/);
  assert.match(html, /<th scope="col"><p>Name<\/p><\/th>/);
  assert.match(html, /Smith. 2025. Measurement/);
  assert.match(html, /Setup caption/);
  assert.match(html, /Original MyST source/);
  assert.doesNotMatch(html, /preview unavailable|unresolved/);
});

test('authored local fragments and cross references share anchors on labeled block kinds', async () => {
  const { parseMystDocument } = await import('../src/myst.ts');
  const examples = [
    ['heading', '# Heading', '<h1 id="myst-heading">'],
    ['list', '- One\n- Two', '<ul id="myst-list">'],
    ['quote', '> Quote', '<blockquote id="myst-quote">'],
    ['code', '```python\nx = 1\n```', '<pre id="myst-code">'],
    ['paragraph', 'A paragraph.', '<p id="myst-paragraph">'],
    ['table', '| Name | Value |\n| --- | --- |\n| mass | 1 |', '<table id="myst-table">'],
    ['rule', '---', '<hr id="myst-rule">'],
    ['fig:setup', '```{figure} setup.png\nCaption\n```', '<figure id="myst-fig~3a~setup">'],
  ];
  for (const [label, content, expected] of examples) {
    const source = `(${label.toUpperCase()})=\n${content}\n\n[Local](#${encodeURIComponent(label.toUpperCase())}) and {ref}\`${label.toUpperCase()}\`.`;
    const html = renderMystHtml(parseMystDocument(source));
    assert.ok(html.includes(expected), label);
    const body = html.split('<details class="source">')[0];
    const anchors = new Set([...body.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
    const fragments = [...body.matchAll(/href="#([^"]+)"/g)].map(match => match[1]);
    assert.equal(fragments.length, 2, label);
    for (const target of fragments) assert.ok(anchors.has(target), `${label}: ${target}`);
    assert.doesNotMatch(body, /Unresolved local link|\[unresolved\]/);
  }
  const missing = renderMystHtml(parseMystDocument('[Missing](#does-not-exist)'));
  assert.match(missing, /Unresolved local link: #does-not-exist/);
  assert.doesNotMatch(missing, /href="#does-not-exist"/);
});

test('parsed task lists retain completed and incomplete states without interactive controls', async () => {
  const { parseMystDocument } = await import('../src/myst.ts');
  const html = renderMystHtml(parseMystDocument('- [x] Collected\n- [ ] Pending\n- Ordinary'));
  const body = html.split('<details class="source">')[0];
  assert.match(body, /\[Completed\].*<p>Collected<\/p>/);
  assert.match(body, /\[Not completed\].*<p>Pending<\/p>/);
  assert.match(body, /<li><p>Ordinary<\/p><\/li>/);
  assert.doesNotMatch(body, /<input|<button|<script/);
});

test('official scholarly frontmatter publishes authors, linked affiliations, identifiers and funding', async () => {
  const { parseMystDocument } = await import('../src/myst.ts');
  const source = `---
title: Cell growth
subtitle: A reproducible study
author:
  - id: ada
    name: {given: Ada, family: Lovelace}
    affiliation: lab
    orcid: 0000-0002-1825-0097
    corresponding: true
    email: ada@example.org
    roles: [Conceptualization]
affiliations:
  - id: lab
    name: Example Institute
    city: London
    country: UK
date: 2024-02-29
doi: 10.1038/nphys1170
license: CC-BY-4.0
funding:
  statement: Supported by Example Foundation
  awards:
    - id: G1
      sources: [{id: foundation, name: Example Foundation}]
      recipients: [ada]
---
(title)=
# Cell growth

Research content.
`;
  const parsed = parseMystDocument(source);
  const html = renderMystHtml(parsed);
  const body = html.split('<details class="source">')[0];
  assert.equal((body.match(/<h1\b/g) ?? []).length, 1);
  for (const content of ['id="myst-title"', 'Cell growth', 'A reproducible study', 'Ada Lovelace', 'Example Institute, London, UK', 'href="#publication-affiliation-1"', 'id="publication-affiliation-1"', 'href="https://orcid.org/0000-0002-1825-0097"', 'Corresponding author', 'Conceptualization', 'href="https://doi.org/10.1038/nphys1170"', 'Content license:', 'Supported by Example Foundation', 'Funder: Example Foundation', 'Recipients: Ada Lovelace', 'Authored publication metadata; not externally verified.']) assert.ok(body.includes(content), content);
  assert.match(body, /<time>2024-02-29<\/time>/);
  assert.equal(parsed.source, source);
  assert.doesNotMatch(body, /<script|<img|<iframe/);
});

test('invalid and hostile scholarly metadata stays recoverable without injecting markup', async () => {
  const { parseMystDocument } = await import('../src/myst.ts');
  const source = `---
title: '<script>alert(1)</script>'
authors:
  - name: '<img src=x onerror=alert(1)>'
    affiliation: missing
license:
  content:
    name: '<iframe src=x>'
    url: 'javascript:alert(1)'
doi: not-a-doi
funding:
  statement: '<script>funding()</script>'
---
# Retained content
`;
  const parsed = parseMystDocument(source);
  const html = renderMystHtml(parsed);
  const body = html.split('<details class="source">')[0];
  assert.match(body, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(body, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(body, /&lt;script&gt;funding\(\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script|<img|<iframe|href="javascript:/);
  assert.match(body, /Publication diagnostics/);
  assert.match(body, /Retained content/);
  assert.equal(parsed.source, source);
  assert.equal(parsed.metadata.doi, 'not-a-doi');
  assert.equal(parsed.scholarly.doi, undefined);
  const malformed = renderMystHtml(parseMystDocument('---\ntitle: Keep me\nauthors: [null]\n---\n# Usable body'));
  assert.match(malformed, /Usable body/);
  assert.match(malformed, /Unable to normalize frontmatter/);
  assert.match(malformed, /Original MyST source/);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMystDocument, exportMystMarkdown, exportMystBundle, importMystBundle, parseMystAttributes, MYST_SOURCE_MAX_BYTES, type MystNode } from '../src/myst.ts';

function nodes(node: MystNode): MystNode[] { return [node, ...(node.children ?? []).flatMap(nodes)]; }
const scientific = `---
title: Cell growth
pero:
  bibliography:
    - id: smith2024
      title: Growth study
      author:
        - given: Ada
          family: Smith
      issued:
        date-parts: [[2024]]
---

(intro)=
# Results

Inline $x^2 + y^2$ and **bold**, *emphasis*, [method](https://example.org).

1. First
2. Second
   - Nested

> Observe carefully.

::: {note}
Keep the control.
:::

\`\`\`{math}
:label: eq-growth
N(t) = N_0 e^{rt}
\`\`\`

\`\`\`{figure} growth.png
:name: fig-growth
:alt: Growth curve

Measured growth.
\`\`\`

\`\`\`{list-table} Samples
:name: tab-samples
:header-rows: 1

* - Sample
  - Count
* - A
  - 42
\`\`\`

| Day | Count |
| --- | --- |
| 1 | 42 |

See {ref}\`fig-growth\`, {numref}\`tab-samples\`, {eq}\`eq-growth\`, {ref}\`intro\`, and {cite}\`smith2024\`.
`;

test('official MyST syntax produces formulas, directives, rich content and local references', () => {
  const document = parseMystDocument(scientific);
  const all = nodes(document.ast);
  for (const type of ['heading', 'inlineMath', 'math', 'strong', 'emphasis', 'link', 'list', 'blockquote', 'admonition', 'image', 'table', 'cite', 'crossReference']) {
    assert.ok(all.some(node => node.type === type), type);
  }
  assert.equal(all.find(node => node.type === 'math')?.value, 'N(t) = N_0 e^{rt}');
  assert.equal(document.references['fig-growth'].label, 'Figure 1');
  assert.equal(document.references['tab-samples'].kind, 'table');
  assert.equal(document.references['eq-growth'].kind, 'equation');
  assert.equal(document.references.intro.kind, 'section');
  assert.equal(document.bibliography.smith2024.author, 'Ada Smith');
  assert.equal(document.bibliography.smith2024.year, '2024');
  assert.ok(all.filter(node => ['cite', 'crossReference'].includes(node.type)).every(node => node.resolved));
  assert.deepEqual(document.diagnostics, []);
});

test('source including frontmatter and line endings is authoritative for export and bundle import', () => {
  const source = scientific.replaceAll('\n', '\r\n') + '\r\n';
  const document = parseMystDocument(source);
  assert.equal(exportMystMarkdown(document), source);
  assert.equal(importMystBundle(exportMystBundle(document)).source, source);
  assert.equal(exportMystBundle(document), exportMystBundle(parseMystDocument(source)));
  assert.equal(document.metadata.title, 'Cell growth');
  const imported = parseMystDocument(importMystBundle(exportMystBundle(document)).source);
  assert.deepEqual(imported.bibliography, document.bibliography);
  assert.throws(() => importMystBundle('{"version":2,"format":"pero-myst","source":""}'));
});

test('missing and duplicated references and citation keys stay visible', () => {
  const document = parseMystDocument('```{math}\n:label: same\nx\n```\n\n```{math}\n:label: same\ny\n```\n\n{ref}`absent` {cite}`missing`');
  assert.deepEqual(document.diagnostics.map(item => item.code), ['reference-duplicate', 'reference-unresolved', 'citation-unresolved']);
  assert.equal(nodes(document.ast).find(node => node.type === 'cite')?.error, 'not found');
});

test('unsupported directives and roles preserve source with diagnostics', () => {
  const source = '```{future-science} arg\n:custom: retained\n\nunknown **content**\n```\n\n{future-role}`retain me`';
  const document = parseMystDocument(source);
  assert.equal(exportMystMarkdown(document), source);
  assert.ok(document.diagnostics.some(item => item.message.includes('future-science')));
  assert.ok(document.diagnostics.some(item => item.message.includes('future-role')));
  assert.ok(nodes(document.ast).some(node => node.type === 'mystDirective'));
});

test('execution, include, raw HTML and external bibliography remain inert and deterministic', () => {
  const source = '---\nbibliography: https://example.org/refs.bib\nplugins: [https://example.org/plugin.js]\n---\n\n```{include} /etc/passwd\n```\n\n```{code-cell} python\nraise RuntimeError("must not execute")\n```\n\n<script>alert(1)</script>';
  const document = parseMystDocument(source);
  assert.equal(document.diagnostics.filter(item => item.code === 'directive-disabled').length, 2);
  assert.ok(document.diagnostics.some(item => item.code === 'bibliography-external'));
  assert.ok(document.diagnostics.some(item => item.code === 'plugins-disabled'));
  assert.ok(document.diagnostics.some(item => item.code === 'html-inert'));
  assert.equal(JSON.stringify(document), JSON.stringify(parseMystDocument(source)));
  assert.equal(exportMystMarkdown(document), source);
});

test('frontmatter rejects malformed, duplicate and custom-tag YAML but keeps original text', () => {
  for (const yaml of ['title: [', 'title: One\ntitle: Two', 'title: !execute bad', '- array', 'a: &a [*a]']) {
    const source = `---\n${yaml}\n---\n\n# Body`;
    const document = parseMystDocument(source);
    assert.ok(document.diagnostics.some(item => item.code === 'frontmatter-invalid'), yaml);
    assert.equal(exportMystMarkdown(document), source);
  }
  const code = parseMystDocument('```yaml\ntitle: example\n```');
  assert.equal(code.ast.children?.[0].type, 'code');
  assert.deepEqual(code.metadata, {});
});

test('persisted source has a versioned UTF-8 byte limit', () => {
  assert.deepEqual(parseMystAttributes({ schemaVersion: 1, source: '' }), { schemaVersion: 1, source: '' });
  assert.throws(() => parseMystAttributes({ schemaVersion: 2, source: '' }));
  for (const extra of ['execute', 'plugins']) assert.throws(() => parseMystAttributes({ schemaVersion: 1, source: '', [extra]: true }), /Unknown/);
  const oversized = '界'.repeat(Math.floor(MYST_SOURCE_MAX_BYTES / 3) + 1);
  assert.throws(() => parseMystDocument(oversized), /256 KiB/);
  assert.throws(() => parseMystAttributes({ schemaVersion: 1, source: oversized }), /256 KiB/);
});


test('official scientific subscript and superscript roles normalize without unsupported warnings', () => {
  const document = parseMystDocument('H{sub}`2`O and x{sup}`2`');
  const all = nodes(document.ast);
  for (const type of ['subscript', 'superscript']) assert.equal(all.find(node => node.type === type)?.children?.[0].value, '2');
  assert.deepEqual(document.diagnostics, []);
});

test('malformed known and unknown directives retain exact authored content across both exports', () => {
  for (const name of ['image', 'future-science']) {
    const source = '```{' + name + '}\n\nDISTINCT **nested content**\n\n- PRESERVED list item\n```\n';
    const document = parseMystDocument(source);
    const retained = nodes(document.ast).find(node => node.type === (name === 'image' ? 'mystDirectiveError' : 'mystDirective'));
    assert.ok(retained, name);
    assert.match(retained.value ?? '', /DISTINCT \*\*nested content\*\*/);
    assert.match(retained.value ?? '', /PRESERVED list item/);
    assert.ok(document.diagnostics.some(item => item.message.includes(name)), name);
    if (name === 'image') assert.ok(document.diagnostics.some(item => item.severity === 'error' && item.code === 'directive-argument-correct'));
    assert.equal(exportMystMarkdown(document), source);
    assert.equal(importMystBundle(exportMystBundle(document)).source, source);
  }
});

test('an include nested inside a supported admonition remains opaque and inert', () => {
  const source = ':::{note}\nBefore\n\n```{include} /etc/passwd\n```\n\nAfter\n:::';
  const document = parseMystDocument(source);
  const all = nodes(document.ast);
  const admonition = all.find(node => node.type === 'admonition');
  const include = admonition?.children?.find(node => node.type === 'mystDirective');
  assert.equal(include?.name, 'include');
  assert.equal(include?.value, '```{include} /etc/passwd\n```');
  assert.equal(include?.children, undefined);
  assert.ok(!all.some(node => node.type === 'include'));
  assert.ok(document.diagnostics.some(item => item.code === 'directive-disabled' && item.line === 4));
  assert.equal(exportMystMarkdown(document), source);
  assert.equal(importMystBundle(exportMystBundle(document)).source, source);
});

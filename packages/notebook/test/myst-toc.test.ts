import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMystDocument, exportMystMarkdown, type MystNode } from '../src/myst.ts';
import { compileMystProject } from '../src/myst-project.ts';
import { parseMystProjectSnapshot, exportMystProjectSnapshot } from '../src/myst-project-snapshot.ts';
import { renderMystHtml } from '../src/myst-render.ts';
import { renderMystProjectHtml } from '../src/myst-project-render.ts';
import { mystAnchor } from '../src/myst-project-references.ts';
import { projectMystPublication } from '../src/myst-publication.ts';
const nodes = (node: MystNode): MystNode[] => [node, ...(node.children ?? []).flatMap(nodes)];
const project = (files: Record<string, string>) => parseMystProjectSnapshot({ format: 'pero-myst-project', version: 1, entry: 'index.md', files: Object.entries(files).map(([path, text]) => ({ path, text })) });
const tocNodes = (node: MystNode) => nodes(node).filter(node => node.type === 'block' && typeof node.data === 'object' && node.data && 'part' in node.data && String(node.data.part).startsWith('toc:'));
const links = (node: MystNode) => nodes(node).filter(node => node.type === 'link');

test('explicit TOC orders mixed pages, nests groups and hides navigation without hiding destinations', () => {
  const snapshot = project({
    'myst.yml': `version: 1\nproject:\n  toc:\n    - file: ./index.md\n    - title: Part One\n      children:\n        - file: notes.ipynb\n          title: Notebook navigation\n        - file: chapters/child.md\n          title: Navigation title\n          children:\n            - file: hidden.md\n              hidden: true\n    - file: tail.md\n`,
    'tail.md': '# Last', 'hidden.md': '(hidden)=\n# Hidden body',
    'chapters/child.md': '---\ntitle: Scientific title\nshort_title: Short title\n---\n# Chapter\n\n[Hidden](../hidden.md#hidden)',
    'notes.ipynb': JSON.stringify({ nbformat: 4, nbformat_minor: 5, metadata: { title: 'Notebook body' }, cells: [] }),
    'index.md': '# Home\n\n:::{toc}\n:context: project\n:depth: 2\n:::',
    'unlisted.md': '# Unlisted',
  });
  const before = exportMystProjectSnapshot(snapshot), compiled = compileMystProject(snapshot);
  assert.deepEqual(compiled.pageOrder, ['index.md', 'notes.ipynb', 'chapters/child.md', 'hidden.md', 'tail.md', 'unlisted.md']);
  assert.deepEqual(compiled.numberingOrder, ['index.md', 'notes.ipynb', 'chapters/child.md', 'tail.md']);
  assert.equal(compiled.toc[1].title, 'Part One');
  assert.equal(compiled.toc[1].children[1].title, 'Navigation title');
  assert.equal(compiled.pages.find(page => page.path === 'chapters/child.md')!.document.scholarly.title, 'Scientific title');
  const html = renderMystProjectHtml(compiled), nav = html.match(/<nav[^>]*>(.*?)<\/nav>/s)![1];
  assert.match(nav, /Part One<ul>/);
  assert.ok(!nav.includes('hidden.md') && !nav.includes('Unlisted'));
  assert.ok(html.includes(`id="${mystAnchor('', 'hidden.md')}"`));
  assert.ok(html.includes(`href="#${mystAnchor('hidden', 'hidden.md')}"`));
  assert.ok(html.indexOf(`id="${mystAnchor('', 'notes.ipynb')}"`) < html.indexOf(`id="${mystAnchor('', 'chapters/child.md')}"`));
  assert.equal(exportMystProjectSnapshot(snapshot), before);
  assert.ok(!compiled.diagnostics.some(item => item.code === 'reference-unresolved' || item.code === 'node-unsupported'));
});

test('children TOC and depth use the explicit page subtree, not supplied-file order', () => {
  const compiled = compileMystProject(project({
    'myst.yml': 'project:\n  toc:\n    - file: index.md\n      children:\n        - file: sub/one.md\n          children:\n            - file: sub/two.md\n    - file: other.md',
    'index.md': '# Home\n\n:::{toc} Children\n:context: children\n:depth: 1\n:::',
    'other.md': '# Other', 'sub/two.md': '# Two', 'sub/one.md': '# One',
  }));
  assert.equal(compiled.entry.kind, 'myst');
  if (compiled.entry.kind !== 'myst') return;
  const toc = tocNodes(compiled.entry.document.ast)[0];
  assert.deepEqual(links(toc).map(node => node.projectTarget?.path), ['sub/one.md']);
  assert.equal(compiled.toc[0].children[0].title, 'One');
});

test('page and section TOCs have real local anchors, exclude their title and stop at the parent boundary', () => {
  const source = '# Root\n\n:::{toc} On this page\n:context: page\n:depth: 2\n:::\n\n(parent)=\n## Parent\n\n:::{contents} This section\n:depth: 1\n:::\n\n### First\n#### Nested\n### Second\n## Other\n### Outside';
  const document = parseMystDocument(source), [page, section] = tocNodes(document.ast);
  assert.deepEqual(links(page).map(node => node.url), ['#root', '#parent', '#other']);
  assert.deepEqual(links(section).map(node => node.url), ['#first', '#second']);
  const html = renderMystHtml(document);
  for (const target of ['root', 'parent', 'other', 'first', 'second']) {
    assert.ok(html.includes(`href="#${mystAnchor(target)}"`));
    assert.ok(html.includes(`id="${mystAnchor(target)}"`));
  }
  assert.equal(exportMystMarkdown(document), source);
  const publication = projectMystPublication({ document }, 'docx');
  assert.ok(!publication.losses.some(loss => loss.includes('Unsupported docx node: toc')));
  assert.ok(nodes(publication.ast).some(node => node.type === 'text' && node.value === 'First'));
});

test('project in-page TOCs distinguish repeated heading names and namespace notebook cells', () => {
  const cell = '# Shared\n\n:::{toc}\n:context: page\n:::';
  const compiled = compileMystProject(project({ 'index.md': cell, 'other.md': cell,
    'notes.ipynb': JSON.stringify({ nbformat: 4, nbformat_minor: 5, metadata: {}, cells: [{ id: 'first', cell_type: 'markdown', metadata: {}, source: cell }] }),
  }));
  assert.ok(!compiled.diagnostics.some(item => item.code === 'reference-ambiguous'));
  const notebook = compiled.notebookPages[0];
  if (notebook.kind !== 'ipynb') throw Error('expected notebook');
  assert.equal(links(tocNodes(notebook.markdownCells[0].document.ast)[0])[0].projectTarget?.path, 'notes.ipynb:cell-0');
  assert.match(renderMystProjectHtml(compiled), /href="#myst-notes~2e~ipynb~3a~cell-0:shared"/);
});

test('unsupported or missing TOC resources diagnose without filesystem discovery or source mutation', () => {
  const compiled = compileMystProject(project({ 'index.md': '# Home', 'myst.yml': 'project:\n  toc:\n    - file: missing.md\n    - file: ../escape.md\n    - pattern: "*.md"\n    - url: https://example.org\n    - file: index.md\n    - file: index.md' }));
  for (const code of ['toc-missing', 'toc-unsupported', 'toc-duplicate']) assert.ok(compiled.diagnostics.some(item => item.code === code), code);
  assert.deepEqual(compiled.pageOrder, ['index.md']);
  assert.equal(parseMystDocument(':::{toc}\n:::').diagnostics.filter(item => item.code === 'toc-project-unavailable').length, 1);
});

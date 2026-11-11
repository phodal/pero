import test from 'node:test';
import assert from 'node:assert/strict';
import { compileMystProject } from '../src/myst-project.ts';
import { parseMystProjectSnapshot } from '../src/myst-project-snapshot.ts';
import { parseMystDocument, type MystNode } from '../src/myst.ts';
import { renderMystProjectHtml } from '../src/myst-project-render.ts';
import { renderMystHtml } from '../src/myst-render.ts';
const equation = (id: string) => `\n\n\`\`\`{math}\n:label: ${id}\nx=1\n\`\`\`\n`;
const nodes = (node: MystNode, type: string): MystNode[] => [...(node.type === type ? [node] : []), ...(node.children ?? []).flatMap(n => nodes(n, type))];
// Expectations follow initializeTargetCounts/incrementHeadingCounts in upstream
// myst-transforms/src/enumerate.ts at 50e82202324dc36f10bd04877d00016879da6f6e.
test('explicit TOC order continues mixed pages, excluding hidden pages and notebook cells', () => {
  const notebook = JSON.stringify({ nbformat: 4, nbformat_minor: 5, metadata: {}, cells: [
    { cell_type: 'markdown', id: 'hidden', metadata: { tags: ['remove-cell'] }, source: equation('hidden-cell') },
    { cell_type: 'markdown', id: 'one', metadata: {}, source: equation('b') },
    { cell_type: 'markdown', id: 'two', metadata: {}, source: equation('c') },
  ] });
  const files = [
    { path: 'last.md', text: equation('d') + '\n{eq}`a` {eq}`b`' },
    { path: 'unlisted.md', text: equation('unlisted') },
    { path: 'book.ipynb', text: notebook },
    { path: 'hidden.md', text: equation('hidden') },
    { path: 'first.md', text: equation('a') + '\n{eq}`d`\n\n```{embed} #b\n```' },
    { path: 'myst.yml', text: 'version: 1\nproject:\n  numbering:\n    equation:\n      continue: true\n  toc:\n    - file: first.md\n    - file: hidden.md\n      hidden: true\n    - file: book.ipynb\n    - file: last.md\n' },
  ];
  const result = compileMystProject(parseMystProjectSnapshot({ format: 'pero-myst-project', version: 1, entry: 'first.md', files }));
  assert.deepEqual(result.numberingOrder, ['first.md', 'book.ipynb', 'last.md']);
  const first = result.pages.find(p => p.path === 'first.md')!.document;
  const last = result.pages.find(p => p.path === 'last.md')!.document;
  const book = result.notebookPages[0];
  assert.equal(book.kind, 'ipynb');
  if (book.kind !== 'ipynb') return;
  assert.deepEqual([first.references.a.number, book.markdownCells[1].document.references.b.number, book.markdownCells[2].document.references.c.number, last.references.d.number], ['1', '2', '3', '4']);
  assert.equal(nodes(first.ast, 'crossReference')[0].children?.map(n => n.value ?? '').join(''), '(4)');
  assert.ok(nodes(first.ast, 'math').some(n => n.enumerator === '2'));
  assert.equal(book.document.source, notebook);
  assert.equal(first.source, files[4].text);
});
test('page overrides reset one counter and explicit starts take precedence over continuation', () => {
  const result = compileMystProject(parseMystProjectSnapshot({ format: 'pero-myst-project', version: 1, entry: 'a.md', files: [
    { path: 'myst.yml', text: 'version: 1\nproject:\n  numbering:\n    equation:\n      continue: true\n  toc:\n    - file: a.md\n    - file: b.md\n    - file: c.md\n' },
    { path: 'a.md', text: equation('a') + equation('aa') },
    { path: 'b.md', text: '---\nnumbering:\n  equation:\n    continue: false\n---\n' + equation('b') },
    { path: 'c.md', text: '---\nnumbering:\n  equation:\n    continue: true\n    start: 7\n---\n' + equation('c') },
  ] }));
  assert.deepEqual(result.pages.map(p => Object.values(p.document.references).at(-1)?.number), ['2', '1', '7']);
});
test('title numbering carries ancestors across pages, honors offset and renders metadata title once', () => {
  const result = compileMystProject(parseMystProjectSnapshot({ format: 'pero-myst-project', version: 1, entry: 'a.md', files: [
    { path: 'myst.yml', text: 'version: 1\nproject:\n  numbering:\n    title: true\n    headings: true\n  toc:\n    - file: a.md\n    - file: b.md\n    - file: c.md\n' },
    { path: 'a.md', text: '---\ntitle: First\n---\n## Section' },
    { path: 'b.md', text: '---\nnumbering:\n  title:\n    enabled: true\n    offset: 1\n---\n# Child\n\n## Subsection' },
    { path: 'c.md', text: '# Second\n\n## Section' },
  ] }));
  assert.deepEqual(result.pages.map(p => nodes(p.document.ast, 'heading').map(n => n.enumerator)), [['1', '1.1'], ['1.2', '1.2.1'], ['2', '2.1']]);
  assert.equal((renderMystHtml(result.pages[0].document).split('<details class="source">')[0].match(/1 First<\/h1>/g) ?? []).length, 1);
  const noTitle = parseMystDocument('---\nnumbering:\n  headings: true\n  title:\n    enabled: false\n    offset: 2\n---\n## Section');
  assert.equal(nodes(noTitle.ast, 'heading')[0].enumerator, '1');
});

test('notebook metadata and compiled title share one numbered HTML heading', () => {
  const source = JSON.stringify({ nbformat: 4, nbformat_minor: 5, metadata: { title: 'Notebook title', numbering: { title: true, headings: true } }, cells: [
    { cell_type: 'markdown', id: 'a', metadata: {}, source: '## First section' },
    { cell_type: 'markdown', id: 'b', metadata: {}, source: '## Second section' },
  ] });
  const project = compileMystProject(parseMystProjectSnapshot({ format: 'pero-myst-project', version: 1, entry: 'book.ipynb', files: [{ path: 'book.ipynb', text: source }] }));
  const html = renderMystProjectHtml(project);
  assert.equal((html.match(/<h1[^>]*>/g) ?? []).length, 1);
  assert.match(html, /1 Notebook title<\/h1>/);
});

test('code-first notebooks publish one title while keeping hidden code and author metadata intact', () => {
  for (const tags of [[], ['hide-input'], ['hide-output'], ['hide-input', 'hide-output'], ['remove-cell']]) {
    const source = JSON.stringify({ nbformat: 4, nbformat_minor: 5, metadata: { title: 'Code-first title', authors: [{ name: 'Research Author' }], numbering: { title: true, headings: true } }, cells: [
      { cell_type: 'code', id: 'code', metadata: { label: 'computation', tags }, source: 'PRIVATE_INPUT', execution_count: 1, outputs: [{ output_type: 'stream', name: 'stdout', text: 'RECORDED_OUTPUT' }] },
      { cell_type: 'markdown', id: 'prose', metadata: {}, source: '## Results' },
    ] });
    const project = compileMystProject(parseMystProjectSnapshot({ format: 'pero-myst-project', version: 1, entry: 'book.ipynb', files: [{ path: 'book.ipynb', text: source }] }));
    const html = renderMystProjectHtml(project);
    assert.equal((html.match(/<h1[^>]*>/g) ?? []).length, 1, tags.join(','));
    assert.match(html, /1 Code-first title<\/h1>/);
    assert.equal((html.match(/Research Author/g) ?? []).length, 1);
    assert.equal(html.includes('PRIVATE_INPUT'), !tags.includes('hide-input') && !tags.includes('remove-cell'));
    assert.equal(html.includes('RECORDED_OUTPUT'), !tags.includes('hide-output') && !tags.includes('remove-cell'));
  }
});

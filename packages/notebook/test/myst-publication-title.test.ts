import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMystDocument, type MystNode } from '../src/myst.ts';
import { projectMystPublication } from '../src/myst-publication.ts';
import { exportMystJats } from '../src/myst-jats.ts';

const text = (node: MystNode): string => node.value ?? (node.children ?? []).map(text).join('');
test('labelled publication titles occur once and retain heading numbers', () => {
  const document = parseMystDocument('---\ntitle: Labelled title\nnumbering:\n  title: true\n  heading_1: true\n---\n(title)=\n# Labelled title\n\nBody.\n\n## Section');
  assert.equal(document.ast.children?.find(n => n.type === 'heading')?.enumerator, '1');
  for (const kind of ['docx', 'latex', 'typst'] as const) {
    const projection = projectMystPublication({ document }, kind);
    assert.equal(text(projection.ast).match(/Labelled title/g)?.length, 1);
    assert.match(text(projection.ast), /1 Labelled title/);
  }
  const jats = exportMystJats(document);
  assert.match(jats, /<article-title>1 Labelled title<\/article-title>/);
  assert.doesNotMatch(jats.match(/<body>([\s\S]*)<\/body>/)![1], /Labelled title/);
});

test('notebook title precedes generated cell headings and source recovery is exact', async () => {
  const { compileMystProject } = await import('../src/myst-project.ts');
  const { parseMystProjectSnapshot } = await import('../src/myst-project-snapshot.ts');
  const { compiledMystEntryPublication } = await import('../src/ipynb-publication.ts');
  const { exportMystJatsResult } = await import('../src/myst-jats.ts');
  const { exportMystDocx } = await import('../src/myst-publication-sdk.ts');
  const { default: JSZip } = await import('jszip');
  for (const kind of ['markdown', 'code'] as const) {
    const source = JSON.stringify({ nbformat: 4, nbformat_minor: 5, metadata: { title: 'Notebook title', numbering: { title: true, headings: true } }, cells: [
      { cell_type: 'markdown', id: 'hidden', metadata: { tags: ['remove-cell'] }, source: '# Hidden heading' },
      { cell_type: kind, id: 'first', metadata: {}, source: kind === 'markdown' ? '## First section' : 'print(1)', ...(kind === 'code' ? { execution_count: 1, outputs: [] } : {}) },
      { cell_type: 'markdown', id: 'later', metadata: {}, source: '# Notebook title\n\nA legitimate later heading.' },
    ] });
    const project = compileMystProject(parseMystProjectSnapshot({ format: 'pero-myst-project', version: 1, entry: 'book.ipynb', files: [{ path: 'book.ipynb', text: source }] }));
    const input = compiledMystEntryPublication(project.notebookPages[0]);
    for (const format of ['docx', 'latex', 'typst'] as const) {
      const ast = projectMystPublication(input, format).ast;
      assert.equal(text(ast.children![0]), '1 Notebook title');
      assert.equal(text(ast).match(/Notebook title/g)?.length, 2);
      assert.doesNotMatch(text(ast), /Hidden heading/);
    }
    const jats = exportMystJatsResult(input).xml;
    assert.match(jats, /<article-title>1 Notebook title<\/article-title>/);
    assert.equal(jats.match(/<body>([\s\S]*)<\/body>/)![1].match(/Notebook title/g)?.length, 1);
    assert.equal(input.recovery?.source, source);
    const docx = await JSZip.loadAsync(await exportMystDocx(input));
    assert.equal(await docx.file('pero/notebook.ipynb')!.async('string'), source);
  }
});

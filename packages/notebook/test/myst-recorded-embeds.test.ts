import test from 'node:test';
import assert from 'node:assert/strict';
import { compileMystProject } from '../src/myst-project.ts';
import { parseMystProjectSnapshot, exportMystProjectSnapshot } from '../src/myst-project-snapshot.ts';
import { renderMystProjectHtml } from '../src/myst-project-render.ts';
import { mystAnchor } from '../src/myst-project-references.ts';
import { compiledMystEntryPublication } from '../src/ipynb-publication.ts';
import { projectMystPublication } from '../src/myst-publication.ts';
import type { MystNode } from '../src/myst.ts';
const code = (id: string, metadata: Record<string, unknown> = {}, outputs: unknown[] = [{ output_type: 'stream', name: 'stdout', text: 'Recorded 42' }]) => ({ cell_type: 'code', id, metadata, source: 'raise Exception("NEVER EXECUTE")', execution_count: 7, outputs });
const build = (source: string, cells: unknown[], entry = 'paper.md') => {
  const notebook = JSON.stringify({ nbformat: 4, nbformat_minor: 5, metadata: {}, cells });
  const snapshot = parseMystProjectSnapshot({ format: 'pero-myst-project', version: 1, entry, files: [{ path: 'paper.md', text: source }, { path: 'run.ipynb', text: notebook }] });
  const before = exportMystProjectSnapshot(snapshot), project = compileMystProject(snapshot);
  assert.equal(exportMystProjectSnapshot(snapshot), before);
  return { project, notebook };
};
const nodes = (node: MystNode): MystNode[] => [node, ...(node.children ?? []).flatMap(nodes)];
test('labelled code-cell embeds share source numbering, reference destinations and recorded provenance', () => {
  const { project, notebook } = build('See {numref}`run.ipynb#result`.\n\n```{embed} run.ipynb#result\n```', [code('first', { name: 'setup' }), code('second', { label: 'result', 'pero.outputsStale': true })]);
  const html = renderMystProjectHtml(project);
  assert.ok(html.includes(`href="#${mystAnchor('result', 'run.ipynb:cell-1')}"`));
  assert.equal(html.split(`id="${mystAnchor('result', 'run.ipynb:cell-1')}"`).length - 1, 1);
  assert.ok(html.includes('Recorded 42')); assert.ok(html.includes('Stale recorded outputs'));
  const copied = nodes(project.pages[0].document.ast).find(node => node.recordedCell);
  assert.equal(copied?.enumerator, '2'); assert.equal(copied?.identifier, undefined);
  assert.deepEqual(copied?.recordedCell, { path: 'run.ipynb', index: 1, executionCount: 7, stale: true });
  assert.equal(copied?.provenance?.path, 'run.ipynb');
  assert.equal(project.notebookPages[0].kind === 'ipynb' && project.notebookPages[0].document.source, notebook);
  assert.ok(!project.diagnostics.some(item => item.code.startsWith('reference-') || item.code.startsWith('embed-')));
});
test('embed input/output selectors cannot restore source-hidden content', () => {
  for (const [tags, selector, absent, present] of [
    [[], ':remove-input:', 'NEVER EXECUTE', 'Recorded 42'],
    [[], ':remove-output:', 'Recorded 42', 'NEVER EXECUTE'],
    [['hide-input'], ':remove-input: false', 'NEVER EXECUTE', 'Recorded 42'],
    [['remove-output'], ':remove-output: false', 'Recorded 42', 'NEVER EXECUTE'],
    [['remove-stdout'], '', 'Recorded 42', 'NEVER EXECUTE'],
  ] as [string[], string, string, string][]) {
    const { project } = build(`\`\`\`{embed} run.ipynb#result\n${selector}\n\`\`\``, [code('one', { label: 'result', tags })]);
    const content = JSON.stringify(project.pages[0].document.ast);
    assert.ok(!content.includes(absent), `${tags}/${selector}`); assert.ok(content.includes(present));
  }
  const { project } = build('```{embed} run.ipynb#gone\n```', [code('hidden', { label: 'gone', tags: ['remove-cell'] })]);
  assert.ok(project.diagnostics.some(item => item.code === 'embed-missing'));
});
test('duplicates, conflicting labels and remote targets are diagnosed without discovery', () => {
  const { project } = build('```{embed} run.ipynb#duplicate\n```\n\n```{embed} https://example.org/run.ipynb#remote\n```', [code('a', { label: 'duplicate' }), code('b', { name: 'duplicate' }), code('c', { label: 'x', name: 'y' })]);
  assert.ok(project.diagnostics.some(item => item.code === 'embed-ambiguous'));
  assert.ok(project.diagnostics.some(item => item.code === 'embed-unsupported'));
  assert.ok(project.diagnostics.some(item => item.code === 'notebook-label-invalid'));
});
test('malicious MIME remains inert and excessive output previews remain bounded with exact recovery', () => {
  const attack = '<script>globalThis.compromised = true</script>';
  const outputs = [{ output_type: 'display_data', data: { 'text/html': attack, 'application/javascript': 'throw Error("executed")', 'text/plain': attack } }, ...Array.from({ length: 130 }, (_, i) => ({ output_type: 'stream', name: 'stdout', text: i === 129 ? 'TAIL OMITTED' : 'x'.repeat(i === 0 ? 70000 : 1) }))];
  const { project, notebook } = build('```{embed} run.ipynb#result\n```', [code('one', { label: 'result' }, outputs)], 'run.ipynb');
  const html = renderMystProjectHtml(project);
  assert.ok(!html.includes('<script>')); assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!html.includes('TAIL OMITTED'));
  assert.ok(project.diagnostics.some(item => item.message.includes('text/html')));
  assert.ok(project.diagnostics.some(item => item.message.includes('first 128')));
  const publication = compiledMystEntryPublication(project.entry);
  assert.equal(publication.recovery?.source, notebook);
  for (const kind of ['docx', 'latex', 'typst'] as const) {
    const ast = JSON.stringify(projectMystPublication(publication, kind).ast);
    assert.ok(ast.includes('recorded output')); assert.ok(!ast.includes('TAIL OMITTED'));
  }
});
test('embed count budget also bounds notebook output replication', () => {
  const { project } = build(Array.from({ length: 140 }, () => '```{embed} run.ipynb#result\n```').join('\n\n'), [code('one', { label: 'result' })]);
  assert.ok(project.diagnostics.some(item => item.code === 'embed-budget'));
});

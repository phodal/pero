import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMystDocument, exportMystMarkdown, type MystNode } from '../src/myst.ts';
import { mystReferenceContent } from '../src/myst-numbering.ts';
import { MystProjectionBudget, MYST_PROJECTION_MAX_BYTES } from '../src/myst-projection-budget.ts';
import { compileMystProject } from '../src/myst-project.ts';
import { parseMystProjectSnapshot } from '../src/myst-project-snapshot.ts';
const walk = (node: MystNode): MystNode[] => [node, ...(node.children ?? []).flatMap(walk)];

test('repeated name substitutions and non-text payloads are admitted before expansion', () => {
  for (const name of [
    [{ type: 'text', value: '&'.repeat(8000) }],
    [{ type: 'image', url: 'data:image/png;base64,' + 'a'.repeat(8000), alt: 'image' }],
  ]) {
    const source = [{ type: 'text', value: '{name}'.repeat(1000) }];
    const node: MystNode = { type: 'crossReference', children: source };
    const diagnostics: string[] = [];
    const budget = new MystProjectionBudget();
    for (let i = 0; i < 2; i++) assert.equal(mystReferenceContent(node, { identifier: 'large', kind: 'section', template: '{name}', label: '', name }, code => diagnostics.push(code), budget), source);
    assert.deepEqual(diagnostics, ['projection-limit']);
  }
});

test('many small references share one document allowance and retain exact source', () => {
  const source = '(large)=\n# ' + '界&'.repeat(4000) + '\n\n' + Array(150).fill('{ref}`large`').join(' ');
  const doc = parseMystDocument(source);
  assert.equal(exportMystMarkdown(doc), source);
  assert.equal(doc.diagnostics.filter(item => item.code === 'projection-limit').length, 1);
  const texts = walk(doc.ast).filter(node => node.type === 'crossReference').flatMap(node => node.children ?? []).reduce((sum, node) => sum + (node.value?.length ?? 0), 0);
  assert.ok(texts < MYST_PROJECTION_MAX_BYTES);
});

test('repeated page TOCs stop before multiplying heading lists and leave placeholders', () => {
  const source = Array.from({ length: 200 }, (_, i) => `## Heading ${i} ${'&'.repeat(100)}`).join('\n\n') + '\n\n' + Array(100).fill(':::{toc}\n:context: page\n:::').join('\n\n');
  const doc = parseMystDocument(source);
  assert.equal(doc.diagnostics.filter(item => item.code === 'projection-limit').length, 1);
  assert.ok(walk(doc.ast).some(node => node.type === 'toc'));
  assert.equal(exportMystMarkdown(doc), source);
});

test('duplicate heading destinations remain plain text in local TOCs', () => {
  const doc = parseMystDocument('(same)=\n## First\n\n(same)=\n## Second\n\n:::{toc}\n:context: page\n:::');
  const toc = walk(doc.ast).find(node => node.type === 'block' && (node.data as { part?: string })?.part === 'toc:page')!;
  assert.ok(toc);
  assert.equal(walk(toc).filter(node => node.type === 'link').length, 0);
});

test('project resolution retains the reference allowance used by local resolution', () => {
  const source = '(large)=\n# ' + '界&'.repeat(4000) + '\n\n' + Array(150).fill('{ref}`large`').join(' ');
  const snapshot = parseMystProjectSnapshot({ format: 'pero-myst-project', version: 1, entry: 'index.md', files: [{ path: 'index.md', text: source }] });
  const result = compileMystProject(snapshot);
  assert.equal(result.entry.kind, 'myst');
  if (result.entry.kind !== 'myst') return;
  assert.equal(result.entry.document.diagnostics.filter(item => item.code === 'projection-limit').length, 1);
  assert.equal(result.entry.document.source, source);
});

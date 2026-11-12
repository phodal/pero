import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMystDocument, exportMystMarkdown, exportMystBundle, importMystBundle, type MystNode } from '../src/myst.ts';
import { projectMystTerms, MYST_TERMS_MAX_BYTES, MYST_TERMS_MAX_NODES } from '../src/myst-terms.ts';
import { renderMystHtml } from '../src/myst-render.ts';
import { compileMystProject } from '../src/myst-project.ts';
import { mystAnchor } from '../src/myst-project-references.ts';
import { parseMystProjectSnapshot, exportMystProjectSnapshot } from '../src/myst-project-snapshot.ts';
const nodes = (root: MystNode, type: string): MystNode[] => [ ...(root.type === type ? [root] : []), ...(root.children ?? []).flatMap(child => nodes(child, type)) ];
const project = (files: Record<string, string>, entry = 'main.md') => parseMystProjectSnapshot({ format: 'pero-myst-project', version: 1, entry, files: Object.entries(files).map(([path, text]) => ({ path, text })) });
const glossary = '```{glossary}\n**Apple**\n: A fruit.\n```';

test('parser glossary terms use the shared local index and keep exact recovery', () => {
  const source = `${glossary}\n\n{term}\`Apple\` and {term}\`fruit <Apple>\` and {term}\`Missing\`.`;
  const doc = parseMystDocument(source), html = renderMystHtml(doc);
  assert.equal(doc.references['term-apple'].label, 'Apple');
  assert.match(html, /<dt id="myst-term-apple"><strong>Apple<\/strong><\/dt>/);
  assert.match(html, /href="#myst-term-apple"[^>]*>fruit<\/a>/);
  assert.equal(doc.diagnostics.filter(d => d.code === 'reference-unresolved').length, 1);
  assert.ok(!doc.diagnostics.some(d => d.code === 'node-unsupported'));
  assert.equal(exportMystMarkdown(doc), source);
  assert.equal(importMystBundle(exportMystBundle(doc)).source, source);
  assert.ok(parseMystDocument('```{glossary}\nNot a list\n```').diagnostics.some(d => d.code === 'glossary-definition-list'));
});

test('project term lookups retain the SDK prefix and diagnose duplicates', () => {
  const result = compileMystProject(project({ 'main.md': '{term}`fruit <Apple>`', 'terms.md': glossary }));
  if (result.entry.kind !== 'myst') throw Error('Expected MyST');
  const ref = nodes(result.entry.document.ast, 'crossReference')[0];
  assert.equal(ref.projectTarget?.identifier, 'term-apple');
  assert.match(renderMystHtml(result.entry.document), new RegExp(`href="#${mystAnchor('term-apple', 'terms.md')}"[^>]*>fruit`));
  const duplicate = compileMystProject(project({ 'main.md': '{term}`Apple`', 'a.md': glossary, 'b.md': glossary }));
  assert.ok(duplicate.diagnostics.some(d => d.code === 'reference-ambiguous'));
  assert.ok(parseMystDocument(`${glossary}\n\n${glossary}`).diagnostics.some(d => d.code === 'reference-duplicate'));
});

test('abbreviations match case-sensitively longest first, with null suppression and literal exclusions', () => {
  const source = '---\nabbreviations:\n  ABC: Longest\n  AB: Short\n  ABC DEF: null\n  DEF: Other\n---\nABC AB abc ABC DEF XABCY\n\n`ABC` [ABC](https://example.com) {ref}`ABC` $ABC$\n\n{abbr}`AB` {abbr}`AB (Explicit <title>)`';
  const doc = parseMystDocument(source), abbrs = nodes(doc.ast, 'abbreviation');
  assert.deepEqual(abbrs.map(node => node.title), ['Longest', 'Short', 'Longest', 'Short', 'Explicit <title>']);
  assert.match(renderMystHtml(doc), /ABC DEF/);
  assert.match(renderMystHtml(doc), /title="Explicit &lt;title&gt;"/);
  assert.equal(nodes(nodes(doc.ast, 'link')[0], 'abbreviation').length, 0);
  assert.equal(doc.source, source);
  // Longest-first globally, rather than leftmost-first regex alternation.
  const ast: MystNode = { type: 'root', children: [{ type: 'text', value: 'ABCDE' }] };
  projectMystTerms(ast, { abbreviations: { AB: 'short', BCDE: 'long' } }, () => {});
  assert.deepEqual(nodes(ast, 'abbreviation').map(node => node.title), ['long']);
});

test('project/page/include frontmatter inheritance follows SDK precedence without changing inputs', () => {
  const snapshot = project({
    'myst.yml': 'version: 1\nproject:\n  abbreviations:\n    CPU: Project\n    GPU: Graphics\n    RAM: Memory',
    'main.md': '---\nabbreviations:\n  CPU: Page\n  GPU: null\n---\nCPU GPU RAM\n\n```{include} part.txt\n```',
    'part.txt': '---\nabbreviations:\n  CPU: Included\n---\nCPU GPU RAM',
  });
  const before = exportMystProjectSnapshot(snapshot), result = compileMystProject(snapshot);
  if (result.entry.kind !== 'myst') throw Error('Expected MyST');
  assert.deepEqual(nodes(result.entry.document.ast, 'abbreviation').map(node => node.title), ['Included', 'Memory', 'Included', 'Memory']);
  assert.equal(exportMystProjectSnapshot(snapshot), before);
  assert.ok(!result.diagnostics.some(d => d.code === 'include-frontmatter-unsupported'));
});

test('visible notebook cells share terms and inherited abbreviations with exact ipynb recovery', () => {
  const source = JSON.stringify({ nbformat: 4, nbformat_minor: 5, metadata: { abbreviations: { CPU: 'Processor' } }, cells: [
    { cell_type: 'markdown', id: 'terms', metadata: {}, source: glossary },
    { cell_type: 'markdown', id: 'usage', metadata: {}, source: '{term}`Apple` CPU' },
  ] });
  const result = compileMystProject(project({ 'book.ipynb': source }, 'book.ipynb'));
  assert.equal(result.entry.kind, 'ipynb');
  if (result.entry.kind !== 'ipynb') throw Error('Expected notebook');
  const usage = result.entry.markdownCells[1].document;
  assert.equal(nodes(usage.ast, 'crossReference')[0].projectTarget?.identifier, 'term-apple');
  assert.equal(nodes(usage.ast, 'abbreviation')[0].title, 'Processor');
  assert.equal(result.entry.document.source, source);
});

test('repeated escaped titles are bounded before copying and original text remains exact', () => {
  const title = '"<&'.repeat(10000);
  const source = `---\nabbreviations:\n  AB: ${JSON.stringify(title)}\n---\n${'AB '.repeat(1000)}`;
  const doc = parseMystDocument(source), abbrs = nodes(doc.ast, 'abbreviation');
  assert.equal(doc.diagnostics.filter(d => d.code === 'terms-budget').length, 1);
  assert.ok(abbrs.length > 0 && abbrs.length < 10);
  assert.ok(abbrs.length * 150000 < MYST_TERMS_MAX_BYTES);
  assert.equal(exportMystMarkdown(doc), source);
  const literal = (node: MystNode): string => node.value ?? (node.children ?? []).map(literal).join('');
  assert.equal(literal(doc.ast), 'AB '.repeat(1000).trimEnd());
  assert.match(renderMystHtml(doc), /remaining text is literal/);
});

test('generated node budget is cumulative across text nodes and null suppressions', () => {
  const ast: MystNode = { type: 'root', children: Array.from({ length: 3000 }, () => ({ type: 'paragraph', children: [{ type: 'text', value: 'AB' }] })) };
  const diagnostics: string[] = [];
  projectMystTerms(ast, { abbreviations: { AB: 'expanded' } }, code => diagnostics.push(code));
  assert.deepEqual(diagnostics, ['terms-budget']);
  assert.ok(nodes(ast, 'abbreviation').length * 4 <= MYST_TERMS_MAX_NODES);
  const suppressed: MystNode = { type: 'root', children: [{ type: 'text', value: 'AB '.repeat(3000) }] };
  projectMystTerms(suppressed, { abbreviations: { AB: null } }, code => diagnostics.push(code));
  assert.equal(nodes(suppressed, 'abbreviation').length, 0);
  assert.equal(diagnostics.length, 2);
});

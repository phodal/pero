import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMystDocument, exportMystBundle, importMystBundle, type MystNode } from '../src/myst.ts';
import { renderMystHtml } from '../src/myst-render.ts';
import { createMystNumberingState, enumerateMystTargets, mystNodeText } from '../src/myst-numbering.ts';
import { compileMystProject } from '../src/myst-project.ts';
import { parseMystProjectSnapshot } from '../src/myst-project-snapshot.ts';
const nodes = (node: MystNode, type: string): MystNode[] => [...(node.type === type ? [node] : []), ...(node.children ?? []).flatMap(n => nodes(n, type))];
const figure = (id: string, options = '') => `\n\n\`\`\`{figure} sample.png\n:label: ${id}\n${options}\nA **caption**.\n\`\`\`\n`;
const math = (id: string) => `\n\n\`\`\`{math}\n:label: ${id}\nx=1\n\`\`\`\n`;
test('upstream defaults leave headings unnamed by number, while figures and equations enumerate unlabeled siblings', () => {
  const document = parseMystDocument('(title)=\n# Title\n\n(section)=\n## A **section**\n\n$$x=0$$'+math('e')+figure('f')+'\n[](#section) {eq}`e` {numref}`f` @section');
  assert.equal(document.references.section.number, undefined);
  assert.equal(document.references.section.label, 'A section');
  assert.equal(document.references.title.label, 'Title');
  assert.equal(document.references.e.number, '2');
  assert.equal(document.references.e.label, '(2)');
  assert.equal(document.references.f.label, 'Figure 1');
  assert.deepEqual(nodes(document.ast, 'crossReference').map(mystNodeText), ['(2)', 'Figure 1', 'A section']);
  assert.ok(!document.diagnostics.some(d => d.code === 'citation-unresolved'));
});
test('heading hierarchy, aliases, disabled depths, start and enumerator use normalized metadata', () => {
  const source = '---\nnumbering:\n  headings: true\n  h1:\n    start: 3\n  h2: false\n  enumerator: A.%s\n---\n# Title\n\n(a)=\n## One\n\n(b)=\n### Disabled\n\n(c)=\n#### Deep\n\n(d)=\n## Two\n\n(e)=\n#### Deep Again';
  const document = parseMystDocument(source);
  assert.deepEqual(['a','b','c','d','e'].map(id => document.references[id].number), ['A.3',undefined,'A.3.1','A.4','A.4.1']);
  assert.ok(renderMystHtml(document).includes('A.3 One</h2>'));
  const off = parseMystDocument('---\nnumbering: false\n---\n'+figure('f')+math('e'));
  assert.equal(off.references.f.number, undefined);
  assert.equal(off.references.e.number, undefined);
});
test('explicit figure enumerators do not advance counters and custom kind settings apply', () => {
  const document = parseMystDocument('---\nnumbering:\n  figure:\n    start: 4\n    enumerator: F%s\n    template: fig ({number})\n  box: true\n---\n'+figure('one')+figure('fixed', ':enumerator: 2a\n')+figure('next')+figure('box', ':kind: box\n')+'\n{numref}`next`');
  assert.deepEqual(['one','fixed','next','box'].map(id => document.references[id].number), ['F4','2a','F5','1']);
  assert.equal(document.references.next.label, 'fig (F5)');
  assert.equal(document.references.box.label, 'Box 1');
});
test('authored reference text preserves inline markup, replaces only text and warns for unavailable numbers', () => {
  const source = '(s)=\n## A **section**\n\n[Sec **%s** {number} {name} `%s {number} {name}`](#s)\n\n{numref}`Number %s <s>`\n'+figure('f')+'\n{ref}`f` {numref}`f` {ref}`Authored {name} {number} <f>`';
  const document = parseMystDocument(source), html = renderMystHtml(document).split('<details class="source">')[0];
  assert.match(html, /Sec <strong>\?\?<\/strong> \?\? A <strong>section<\/strong> <code>%s \{number\} \{name\}<\/code>/);
  assert.deepEqual(nodes(document.ast,'crossReference').map(mystNodeText), ['Number ??','A caption.','Figure 1','Authored A caption. 1']);
  assert.equal(document.diagnostics.filter(d => d.code === 'reference-number-unavailable').length, 2);
  assert.equal(importMystBundle(exportMystBundle(document)).source, source);
});
test('a notebook shares counters across visible Markdown cells and cross-cell references use target metadata', () => {
  const source = JSON.stringify({nbformat:4,nbformat_minor:5,metadata:{numbering:{figure:{start:4,template:'Fig %s'},headings:true}},cells:[
    {cell_type:'markdown',id:'a',metadata:{},source:figure('a')+'\n## First\n\n{numref}`b`'},
    {cell_type:'markdown',id:'hidden',metadata:{tags:['remove-cell']},source:figure('hidden')},
    {cell_type:'markdown',id:'b',metadata:{},source:figure('b')+'\n## Second\n\n[Named {number} {name}](#a)'},
  ]});
  const snapshot = parseMystProjectSnapshot({format:'pero-myst-project',version:1,entry:'a.ipynb',files:[{path:'a.ipynb',text:source}]});
  const result = compileMystProject(snapshot);
  if (result.entry.kind !== 'ipynb') throw Error('Expected notebook');
  const [a,,b] = result.entry.markdownCells.map(cell => cell.document);
  assert.equal(a.references.a.number,'4'); assert.equal(b.references.b.number,'5');
  assert.equal(nodes(b.ast,'heading')[0].enumerator,'2');
  assert.equal(nodes(a.ast,'crossReference')[0].children?.map(mystNodeText).join(''),'Fig 5');
  assert.equal(nodes(b.ast,'link')[0].children?.map(mystNodeText).join(''),'Named 4 A caption.');
  assert.equal(result.entry.document.source,source);
});
test('ordered callers inherit only continue counters and explicit starts override prior values', () => {
  const state = createMystNumberingState();
  enumerateMystTargets({type:'root',children:[{type:'math'},{type:'math'}]},state,()=>{});
  const continued = createMystNumberingState({equation:{continue:true}},state);
  const ast: MystNode = {type:'root',children:[{type:'math',identifier:'third'}]};
  assert.equal(enumerateMystTargets(ast,continued,()=>{}).third.number,'3');
  const reset = createMystNumberingState({equation:{continue:true,start:7}},continued);
  assert.equal(enumerateMystTargets({type:'math',identifier:'reset'},reset,()=>{}).reset.number,'7');
});

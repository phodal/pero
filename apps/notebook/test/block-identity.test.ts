import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Fragment, Schema, Slice } from '@tiptap/pm/model';
import { copyNotebookBlocks } from '../ui-src/block-identity.ts';

const schema = new Schema({ nodes: {
  doc: { content: 'block+' },
  text: { group: 'inline' },
  paragraph: { group: 'block', content: 'inline*', attrs: { blockId: { default: null } } },
  blockquote: { group: 'block', content: 'block+', attrs: { blockId: { default: null } } },
  evidence: { group: 'block', atom: true, attrs: { blockId: {}, source: {}, snapshot: {} } },
  finding: { group: 'block', atom: true, attrs: { blockId: {}, evidenceIds: {} } },
  spreadsheet: { group: 'block', atom: true, attrs: { blockId: {}, sheet: {}, annotations: {} } },
  attachment: { group: 'block', atom: true, attrs: { blockId: {}, data: {} } },
  sourceExcerpt: { group: 'block', atom: true, attrs: { blockId: {}, excerpt: {} } },
  chemical: { group: 'block', atom: true, attrs: { blockId: {}, chemical: {} } },
} });

test('copied research blocks remap internal citations and retain frozen source data', () => {
  const source = { app: 'paper-agent', id: 'report', version: 'frozen-version' };
  const snapshot = { quote: 'Measured result', page: 2 };
  const sheet = { rows: 1, columns: 1, cells: { A1: '=2*3' } };
  const document = schema.nodeFromJSON({ type: 'doc', content: [
    { type: 'paragraph', attrs: { blockId: 'prose' }, content: [{ type: 'text', text: 'Research' }] },
    { type: 'blockquote', attrs: { blockId: 'group' }, content: [
      { type: 'evidence', attrs: { blockId: 'paper', source, snapshot } },
      { type: 'finding', attrs: { blockId: 'claim', evidenceIds: ['paper', 'outside-copy'] } },
    ] },
    { type: 'spreadsheet', attrs: { blockId: 'sheet', sheet,
      annotations: { A1: { unit: 'µL', evidenceIds: ['paper'] } } } },
  ] });
  const original = document.toJSON();
  const copied = copyNotebookBlocks(new Slice(document.content, 0, 0));
  const group = copied.content.child(1);
  const evidence = group.child(0), finding = group.child(1), grid = copied.content.child(2);
  const ids: string[] = [];
  copied.content.descendants(node => { if (node.attrs.blockId) ids.push(node.attrs.blockId); });
  assert.equal(new Set(ids).size, 5);
  assert.ok(ids.every(id => !['prose', 'group', 'paper', 'claim', 'sheet'].includes(id)));
  assert.deepEqual(finding.attrs.evidenceIds, [evidence.attrs.blockId, 'outside-copy']);
  assert.deepEqual(grid.attrs.annotations.A1, { unit: 'µL', evidenceIds: [evidence.attrs.blockId] });
  assert.deepEqual(grid.attrs.sheet, sheet);
  assert.deepEqual(evidence.attrs.source, source);
  assert.deepEqual(evidence.attrs.snapshot, snapshot);
  assert.deepEqual(document.toJSON(), original);
  assert.equal(copied.content.child(0).textContent, 'Research');
  const partial = copyNotebookBlocks(new Slice(document.content, 1, 0));
  assert.equal(partial.openStart, 1);
  assert.equal(partial.openEnd, 0);
});

test('copying source excerpts remaps included attachment locators only and keeps frozen and external provenance', () => {
  const excerpt = { source: { blockId: 'source', filename: 'text.txt', mime: 'text/plain', sha256: 'a'.repeat(64) }, version: 'a'.repeat(64), text: '\ufeffA\r\n🧪', start: 1, end: 2, quote: 'A' };
  const chemical = { name: 'Portable', graph: { atoms: [], bonds: [] }, source: { id: 'source', revision: 1, moleculeId: 'source', original: { atoms: [], bonds: [] } } };
  const document = schema.nodeFromJSON({ type: 'doc', content: [
    { type: 'attachment', attrs: { blockId: 'source', data: '77u/Q0FTRQ==' } },
    { type: 'sourceExcerpt', attrs: { blockId: 'excerpt', excerpt } },
    { type: 'chemical', attrs: { blockId: 'chemical', chemical } },
  ] });
  const copied = copyNotebookBlocks(new Slice(document.content, 0, 0));
  assert.deepEqual(copied.content.child(1).attrs.excerpt, { ...excerpt, source: { ...excerpt.source, blockId: copied.content.child(0).attrs.blockId } });
  assert.deepEqual(copied.content.child(2).attrs.chemical, chemical);
  assert.deepEqual(document.child(1).attrs.excerpt, excerpt);
  const alone = copyNotebookBlocks(new Slice(Fragment.from(document.child(1)), 0, 0));
  assert.deepEqual(alone.content.child(0).attrs.excerpt, excerpt);
  const unrelated = schema.nodes.paragraph.create({ blockId: 'source' });
  const withoutAttachment = copyNotebookBlocks(new Slice(Fragment.from([unrelated, document.child(1)]), 0, 0));
  assert.equal(withoutAttachment.content.child(1).attrs.excerpt.source.blockId, 'source');
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { notebookExample, parseNamedReference } from '../src/named-reference.ts';
import { notebookRelevantItems, notebookSearchItems, notebookMarkdown } from '../src/workspace.ts';
import { documentHistory, transitionDocument } from '../src/document-history.ts';
import { createNotebookDocument } from '../src/document.ts';

test('authored entry cards require names and notes and remain distinct from scientific identities', () => {
  const card = { kind: 'entry', name: 'Preparation', notes: 'Record the blank measurement.' };
  assert.deepEqual(parseNamedReference(card), card);
  for (const patch of [{ kind: 'paper' }, { name: ' ' }, { notes: '' }, { name: 'x'.repeat(201) }, { notes: 'x'.repeat(20001) }]) {
    assert.throws(() => parseNamedReference({ ...card, ...patch }));
  }
  let id = 0;
  const document = notebookExample(() => `example-${++id}`);
  const item = notebookRelevantItems(document.content)[0];
  assert.equal(item.kind, 'namedReference'); assert.equal(item.state, 'authored'); assert.equal(item.source, null);
  assert.match(item.notes!, /instrument/);
  assert.ok(notebookSearchItems(document.content).some(item => item.text.includes('instrument')));
  assert.match(notebookMarkdown(document), /Preparation checklist/);
});

test('whole-document replacement is one undoable edit, including metadata and procedures', () => {
  const original = { ...createNotebookDocument('Working draft'), metadata: { project: 'Actual project', author: 'Author', tags: ['retain'] }, procedures: [] };
  let id = 0; const replacement = notebookExample(() => `example-${++id}`);
  const replaced = transitionDocument(documentHistory(original), { type: 'restore', document: replacement });
  assert.equal(replaced.past.length, 1); assert.deepEqual(replaced.present, replacement);
  const undo = transitionDocument(replaced, { type: 'undo' }); assert.deepEqual(undo.present, original);
  assert.deepEqual(transitionDocument(undo, { type: 'redo' }).present, replacement);
  assert.deepEqual(JSON.parse(JSON.stringify(replaced.present)), replacement);
});

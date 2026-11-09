import test from 'node:test';
import assert from 'node:assert/strict';
import { createNotebookDocument } from '../src/document.ts';
import { documentHistory, transitionDocument } from '../src/document-history.ts';

test('one document history groups typing and undoes title, metadata, procedures and Notes together', () => {
  const initial = createNotebookDocument('Start');
  let state = documentHistory(initial);
  state = transitionDocument(state, { type: 'edit', document: { ...initial, title: 'A' }, group: 'title', at: 100 });
  state = transitionDocument(state, { type: 'edit', document: { ...initial, title: 'AB' }, group: 'title', at: 200 });
  assert.equal(state.past.length, 1);
  const titled = state.present;
  state = transitionDocument(state, { type: 'edit', document: { ...titled, procedures: [], metadata: { project: 'Assay', author: 'Researcher', tags: ['draft'] } }, group: 'procedures', at: 300 });
  const procedures = state.present;
  state = transitionDocument(state, { type: 'edit', document: { ...procedures, content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Notes' }] }] } }, group: 'content', at: 400 });
  state = transitionDocument(state, { type: 'undo' });
  assert.deepEqual(state.present, procedures);
  state = transitionDocument(state, { type: 'undo' });
  assert.deepEqual(state.present, titled);
  state = transitionDocument(state, { type: 'undo' });
  assert.deepEqual(state.present, initial);
  state = transitionDocument(state, { type: 'redo' });
  assert.deepEqual(state.present, titled);
  state = transitionDocument(state, { type: 'edit', document: { ...titled, title: 'Fork' }, group: 'title', at: 500 });
  assert.equal(state.future.length, 0);
});

test('history is bounded, time-injected, and restore is an undoable draft edit', () => {
  let state = documentHistory(createNotebookDocument());
  for (let i = 0; i < 70; i++) state = transitionDocument(state, { type: 'edit', document: createNotebookDocument(String(i)), group: 'title', at: i * 1000 });
  assert.equal(state.past.length, 50);
  const latest = state.present;
  state = transitionDocument(state, { type: 'restore', document: createNotebookDocument('Historical') });
  assert.equal(state.present.title, 'Historical');
  assert.deepEqual(transitionDocument(state, { type: 'undo' }).present, latest);
  const same = transitionDocument(state, { type: 'edit', document: state.present, group: 'title', at: 0 });
  assert.equal(same, state);
  assert.throws(() => transitionDocument(state, { type: 'restore', document: { ...latest, templateOrigin: { templateId: 'other' } as never } }), /provenance/);
});

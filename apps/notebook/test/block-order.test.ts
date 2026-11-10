import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Schema } from '@tiptap/pm/model';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import type { Editor } from '@tiptap/core';
import { activeNotebookBlock, moveBlock, rememberWidgetFocus } from '../ui-src/block-order.ts';

const schema = new Schema({ nodes: {
  doc: { content: 'block+' }, text: { group: 'inline' },
  paragraph: { group: 'block', content: 'inline*', attrs: { blockId: { default: null } } },
  section: { group: 'block', content: 'block+', attrs: { blockId: { default: null } } },
} });

test('block movement stays within its section and preserves other sections', () => {
  const paragraph = (id: string) => schema.node('paragraph', { blockId: id }, [schema.text(id)]);
  const doc = schema.node('doc', null, [schema.node('section', { blockId: 'day' }, [paragraph('a'), paragraph('b')]), paragraph('outside')]);
  let state = EditorState.create({ doc, selection: TextSelection.create(doc, 2) });
  const editor = { get state() { return state; }, view: { dispatch: (tr: any) => { state = state.apply(tr); } }, commands: { focus: () => true } } as unknown as Editor;
  rememberWidgetFocus(editor, 'a');
  assert.equal(activeNotebookBlock(editor)?.parent.type.name, 'section');
  moveBlock(editor, 1);
  assert.deepEqual([state.doc.child(0).child(0).textContent, state.doc.child(0).child(1).textContent], ['b', 'a']);
  assert.equal(state.doc.child(1).textContent, 'outside');
  moveBlock(editor, 1);
  assert.equal(state.doc.child(1).textContent, 'outside');
  rememberWidgetFocus(editor, 'day');
  moveBlock(editor, 1);
  assert.equal(state.doc.child(0).textContent, 'outside');
  assert.equal(state.doc.child(1).attrs.blockId, 'day');
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Schema } from '@tiptap/pm/model';
import { notebookEvidence } from '../ui-src/evidence-model.ts';

const reference = { app: 'paper-agent', kind: 'report-citation', id: 'report', version: 'frozen', locator: '' };
const attrs = { blockId: { default: null }, label: { default: '' }, source: { default: null }, snapshot: { default: null } };
const schema = new Schema({ nodes: {
  doc: { content: 'block+' },
  text: { group: 'inline' },
  paragraph: { group: 'block', content: 'inline*', attrs },
  blockquote: { group: 'block', content: 'block+' },
  evidence: { group: 'block', atom: true, attrs },
  experiment: { group: 'block', atom: true, attrs },
} });

test('evidence choices include nested research blocks without including prose or inventing a source version', () => {
  const document = schema.nodeFromJSON({ type: 'doc', content: [
    { type: 'paragraph', attrs: { blockId: 'prose', source: reference } },
    { type: 'evidence', attrs: { source: reference } },
    { type: 'blockquote', content: [
      { type: 'evidence', attrs: { blockId: 'paper', label: 'Paper passage', source: reference } },
      { type: 'experiment', attrs: { blockId: 'run', source: { ...reference, id: 'experiment', version: '' } } },
    ] },
    { type: 'evidence', attrs: { blockId: 'empty' } },
    { type: 'evidence', attrs: { blockId: 'snapshot', source: reference, snapshot: { kind: 'paper-report' } } },
  ] });
  assert.deepEqual(notebookEvidence(document), [
    { id: 'paper', label: 'Paper passage', kind: 'evidence', pinned: true, imported: false },
    { id: 'run', label: 'experiment', kind: 'experiment', pinned: false, imported: false },
    { id: 'empty', label: '', kind: 'evidence', pinned: false, imported: false },
    { id: 'snapshot', label: 'report', kind: 'evidence', pinned: true, imported: true },
  ]);
});

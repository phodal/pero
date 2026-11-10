import test from 'node:test';
import assert from 'node:assert/strict';
import type { NotebookDocument } from '../src/document.ts';
import { compareNotebookRevisions, reviewAnchorBlocks } from '../src/review.ts';

const document = (): NotebookDocument => ({ schemaVersion: 1, title: 'Original', content: { type: 'doc', content: [
  { type: 'paragraph', attrs: { blockId: 'a' }, content: [{ type: 'text', text: 'Text' }] },
  { type: 'spreadsheet', attrs: { blockId: 'b', sheet: { cells: { A1: 0, B1: '' } } } },
] } });

test('revision comparison identifies block moves, additions, metadata and typed cell changes', () => {
  const before = document(), after = structuredClone(before);
  after.title = 'Revised';
  after.content.content.reverse();
  (after.content.content[0].attrs!.sheet as { cells: object }).cells = { A1: null, C1: '0' };
  after.content.content.push({ type: 'paragraph', attrs: { blockId: 'c' } });
  const result = compareNotebookRevisions(before, after);
  assert.ok(result.changes.some(change => change.path === 'entry.content.content.order' && change.kind === 'reordered'));
  assert.ok(result.changes.some(change => change.path.endsWith('[b].attrs.sheet.cells.A1') && change.before === '0' && change.after === 'null'));
  assert.ok(result.changes.some(change => change.path.endsWith('B1') && change.kind === 'removed' && change.before === '""'));
  assert.ok(result.changes.some(change => change.path.endsWith('[c]') && change.kind === 'added'));
  assert.equal(compareNotebookRevisions(before, structuredClone(before)).total, 0);
  assert.equal(reviewAnchorBlocks(before).length, 2);
});

test('comparison counts beyond the visible bound and detects changes past truncated text without emitting file bytes', () => {
  const before = document(), after = structuredClone(before);
  before.content.content[0].content![0].text = 'a'.repeat(8000) + 'left';
  after.content.content[0].content![0].text = 'a'.repeat(8000) + 'right';
  before.content.content[1].attrs!.dataBase64 = 'VERY_SECRET_BASE64'.repeat(1000);
  after.content.content[1].attrs!.dataBase64 = 'OTHER_SECRET_BASE64'.repeat(1000);
  const result = compareNotebookRevisions(before, after);
  assert.equal(result.total, 2);
  assert.ok(result.changes[0].before.length < 330);
  assert.equal(JSON.stringify(result).includes('SECRET_BASE64'), false);
  assert.equal(compareNotebookRevisions(before, after, 1).limited, true);
  assert.equal(compareNotebookRevisions(before, after, 1).total, 2);
});

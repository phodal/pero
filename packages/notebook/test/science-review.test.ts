import assert from 'node:assert/strict';
import test from 'node:test';
import { acceptDataReview, compareReviewRows, editReviewCell, parseCandidateResponse, parseRecordedChecks, recordedChecksSnapshot, selectReviewRun, startDataReview } from '../src/science-review.ts';

const payload = { runResults: [
  { displayName: 'First', modelFamily: 'same', runConfigKey: 'a', hadError: false, newRows: { Results: [['A', '1'], ['B', '2']] } },
  { displayName: 'Second', modelFamily: 'same', runConfigKey: 'b', hadError: false, newRows: { Results: [['A', '9'], ['B', '2'], ['C', '3']] } },
  { displayName: 'Failed', modelFamily: 'other', runConfigKey: 'c', hadError: true, newRows: { Results: [] } },
], pairwiseComparisons: [{ isExactMatch: true }] };

test('external candidate review computes differences and keeps failed and extra runs distinct', () => {
  const response = parseCandidateResponse(JSON.stringify(payload));
  const review = startDataReview(response, 'draft-1'), rows = compareReviewRows(review);
  assert.equal(rows[0].cells[1].different, true); assert.deepEqual(rows[0].cells[1].others, ['9', null]);
  assert.equal(rows[1].cells[0].different, true); // Failed third run is missing, not agreement.
  const secondary = selectReviewRun(review, 1);
  assert.equal(compareReviewRows(secondary).length, 3); assert.deepEqual(compareReviewRows(secondary)[2].cells[0].others, [null, null]);
  assert.throws(() => acceptDataReview(selectReviewRun(review, 2), 'draft-1', true), /failed run/);
  const accepted = acceptDataReview(review, 'draft-1', true);
  assert.deepEqual(accepted.rows, [['A', '1'], ['B', '2']]); assert.match(accepted.limits, /not scientific or owner verification/);
});

test('review edits keep row identity, support empty text and require fresh human acceptance', () => {
  let review = startDataReview(parseCandidateResponse(JSON.stringify(payload)), 'draft-1');
  review = editReviewCell(review, 1, 1, '');
  review = editReviewCell(review, 0, 0, '=SUM(A1)');
  review = { ...review, selected: [1] };
  assert.deepEqual(acceptDataReview(review, 'draft-1', true).rows, [['B', '']]);
  assert.throws(() => acceptDataReview(review, 'draft-2', true), /notebook changed/);
  assert.throws(() => acceptDataReview(review, 'draft-1', false), /Acknowledge/);
  for (const policy of ['protected', 'read-only', 'computed', 'snapshot', 'converted'] as const) assert.throws(() => editReviewCell({ ...review, policy }, 0, 0, 'new'), /does not permit/);
  assert.throws(() => acceptDataReview({ ...review, selected: [] }, 'draft-1', true), /Select/);
  assert.throws(() => editReviewCell(review, 999, 0, 'new'), /Choose a cell/);
});

test('malformed and oversized candidate tables fail at the import boundary', () => {
  const bad = [null, {}, { runResults: [] }, { runResults: [{ ...payload.runResults[0], hadError: 'no' }] },
    { runResults: [{ ...payload.runResults[0], newRows: { Results: [['a'], ['a', 'b']] } }] },
    { runResults: [{ ...payload.runResults[0], newRows: { Results: [[{ text: 2 }]] } }] }];
  for (const value of bad) assert.throws(() => parseCandidateResponse(JSON.stringify(value)));
  assert.throws(() => parseCandidateResponse(' '.repeat(1_000_001)), /exceeds/);
  const originalApi = { runResults: [{ ...payload.runResults[0], newRows: { Results: [[{ text: 'literal' }]] } }] };
  assert.deepEqual(parseCandidateResponse(JSON.stringify(originalApi)).runs[0].tables.Results, [['literal']]);
});

test('recorded checks distinguish complete, partial, failed, empty and invalid source records', () => {
  const base = { traceId: 'trace', checkedAt: '2026-01-01T00:00:00Z', checkedVersion: 0, hadError: false, errorMessage: null, checkResults: [{ text: 'Review source' }] };
  const complete = parseRecordedChecks(JSON.stringify(base)); assert.equal(complete.status, 'complete'); assert.equal(complete.checkedVersion, 0);
  assert.equal(parseRecordedChecks(JSON.stringify({ checkResults: base.checkResults })).status, 'partial');
  assert.equal(parseRecordedChecks(JSON.stringify({ ...base, hadError: true, errorMessage: 'Interrupted' })).status, 'partial');
  assert.equal(parseRecordedChecks(JSON.stringify({ ...base, hadError: true, checkResults: [] })).status, 'error');
  assert.equal(parseRecordedChecks(JSON.stringify({ ...base, checkResults: [] })).status, 'empty');
  for (const extra of [{ checkedVersion: -1 }, { checkedAt: 'yesterday' }, { hadError: 'false' }, { checkResults: [{ text: '' }] }]) assert.throws(() => parseRecordedChecks(JSON.stringify({ ...base, ...extra })));
  assert.throws(() => recordedChecksSnapshot(complete, false), /Acknowledge/);
  const accepted = recordedChecksSnapshot({ ...complete, items: [{ ...complete.items[0], acknowledged: true, usefulness: 'useful' }] }, true);
  assert.equal(accepted.items[0].acknowledged, true); assert.match(accepted.limits, /does not establish completion/);
});

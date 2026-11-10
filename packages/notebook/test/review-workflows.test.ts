import assert from 'node:assert/strict';
import test from 'node:test';
import { latestReviewWorkflows, summarizeReviewBulk, type LocalReviewWorkflow } from '../src/review.ts';

test('workflow choices use newest versions without discarding immutable history or mutating inputs', () => {
  const workflow = (id: string, version: number): LocalReviewWorkflow => ({ id, version, name: id, stages: [], createdAt: 't0', authorDisplay: 'Local label', identityScope: 'unverified_local_label' });
  const history = [workflow('a', 1), workflow('b', 3), workflow('a', 4), workflow('a', 2)];
  assert.deepEqual(latestReviewWorkflows(history).map(item => [item.id, item.version]), [['a', 4], ['b', 3]]);
  assert.equal(history.length, 4); assert.equal(history[0].version, 1);
});

test('partial bulk summaries keep failed rows distinct from a successful HTTP response', () => {
  assert.deepEqual(summarizeReviewBulk([{ index: 0, id: 'a', ok: true }, { index: 1, id: 'b', ok: false, code: 'review-conflict' },
    { index: 2, id: null, ok: false, code: 'not-found' }]), { succeeded: 1, failed: 2, failedIds: ['b'] });
  assert.deepEqual(summarizeReviewBulk([]), { succeeded: 0, failed: 0, failedIds: [] });
});

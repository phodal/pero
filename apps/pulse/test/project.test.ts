import assert from 'node:assert/strict';
import test from 'node:test';
import { latestReport, projectBrief, type Edition } from '../ui-src/project.ts';

const edition = (id: string, cards: Edition['cards'], extra: Partial<Edition> = {}): Edition => ({ id, createdAt: '2026-10-29T01:00:00Z', cards, ...extra });

test('a brief puts needs-you first, orders the rest, and folds filtered cards away', () => {
  const view = projectBrief([edition('day', [
    { id: 'd', kind: 'done', title: 'd', conclusion: 'd', body: '' },
    { id: 'f', kind: 'filtered', title: 'f', conclusion: 'f', body: '' },
    { id: 'n', kind: 'needs_you', title: 'n', conclusion: 'n', body: '' },
    { id: 'c', kind: 'change', title: 'c', conclusion: 'c', body: '' },
    { id: 'x', kind: 'needs_you', title: 'x', conclusion: 'x', body: '', dismissed: true },
    { id: 'r', kind: 'risk', title: 'r', conclusion: 'r', body: '' },
    { id: 's', kind: 'needs_you', title: 's', conclusion: 's', body: '', seen: true },
  ])]);
  assert.deepEqual(view.needsYou.map(card => card.id), ['n', 's']);
  assert.equal(view.attention, 1);
  assert.deepEqual(view.cards.map(card => card.id), ['r', 'c', 'd']);
  assert.deepEqual(view.filtered.map(card => card.id), ['f']);
});

test('the current edition is the selected one, otherwise the latest daily brief', () => {
  const report = edition('report', [{ id: 'a', kind: 'needs_you', title: 'a', conclusion: 'a', body: '' }], { goalId: 'w1', createdAt: '2026-10-29T02:00:00Z' });
  const day = edition('day', []);
  const plain = projectBrief([report, day]);
  assert.equal(plain.current?.id, 'day');
  assert.deepEqual(plain.needsYou, []);
  const selected = projectBrief([report, day], 'report');
  assert.equal(selected.current?.id, 'report');
  assert.equal(selected.attention, 1);
  assert.equal(latestReport([report, day], 'w1')?.id, 'report');
  assert.equal(latestReport([report, day], 'missing'), null);
});

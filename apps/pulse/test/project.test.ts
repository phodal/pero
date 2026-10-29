import assert from 'node:assert/strict';
import test from 'node:test';
import { latestReport, projectBrief, setDismissed, settle, type Edition, type Home } from '../ui-src/project.ts';

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

const home: Home = { proactivity: 'brief', watches: [], editions: [], archive: [{ id: 'old', createdAt: '2026-10-01T00:00:00Z', cards: 1 }] };
const fakeApi = () => {
  const calls: string[] = [];
  const archived = edition('old', [{ id: 'a', kind: 'needs_you', title: 'a', conclusion: 'a', body: '' }]);
  return { calls, archived, api: {
    get: async <T,>(path: string) => { calls.push(`GET ${path}`); return archived as T; },
    post: async <T,>(path: string, body: unknown) => { calls.push(`POST ${path} ${JSON.stringify(body)}`); return home as T; },
  } };
};

test('a write reads the opened archive again, and a hot edition needs no second read', async () => {
  const opened = fakeApi();
  const afterOpened = await settle(opened.api, () => opened.api.post<Home>('/api/seen', { cards: [] }), 'old');
  assert.equal(afterOpened.opened?.id, 'old');
  assert.deepEqual(opened.calls, ['POST /api/seen {"cards":[]}', 'GET /api/editions/old']);
  const hot = fakeApi();
  const afterHot = await settle(hot.api, () => hot.api.post<Home>('/api/seen', { cards: [] }));
  assert.equal(afterHot.opened, null);
  assert.deepEqual(hot.calls, ['POST /api/seen {"cards":[]}']);
});

test('dismissing can be undone through the same call with dismissed false', async () => {
  const { api, calls } = fakeApi();
  const mark = { edition: 'old', card: 'a' };
  await setDismissed(api, mark, true, 'old');
  await setDismissed(api, mark, false, 'old');
  assert.deepEqual(calls, [
    'POST /api/dismissed {"edition":"old","card":"a","dismissed":true}', 'GET /api/editions/old',
    'POST /api/dismissed {"edition":"old","card":"a","dismissed":false}', 'GET /api/editions/old',
  ]);
});

test('a failed write does not read the archive', async () => {
  const { api, calls } = fakeApi();
  await assert.rejects(settle(api, async () => { throw new Error('card_missing'); }, 'old'), /card_missing/);
  assert.deepEqual(calls, []);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { NotebookProjectRequests } from './notebook-projects.ts';
const change = { projectId: 'real-project', entryId: 'a'.repeat(32), revision: 2, expectedRevision: null, linked: true, readOnly: false };

test('Host project changes require trusted exact-choice confirmation; private or readonly inputs never dispatch', async () => {
  const calls: any[] = [];
  let allowed = false;
  const owner = new NotebookProjectRequests(async (input: any) => { calls.push(input); return input.operation === 'review' ? { summary: 'Actual project and entry identities' } : { state: 'completed' }; }, async summary => {
    assert.match(summary, /Actual project/); return allowed;
  });
  assert.deepEqual(await owner.apply({ operation: 'set', change }), { state: 'cancelled' });
  assert.deepEqual(calls.map(call => call.operation), ['review']);
  allowed = true;
  assert.deepEqual(await owner.apply({ operation: 'set', change }), { state: 'completed' });
  assert.deepEqual(calls.at(-1), { operation: 'apply', change });
  const count = calls.length;
  for (const input of [{ operation: 'apply', change }, { operation: 'set', change, allow: true },
    { operation: 'set', change: { ...change, readOnly: true } }, { operation: 'set', change: { ...change, revision: 0 } },
    { operation: 'set', change: { ...change, preferences: {} } }]) await assert.rejects(owner.apply(input));
  assert.equal(calls.length, count);
});

test('pending project cancellation and page closure prevent write, repeated choices cannot dispatch twice', async () => {
  for (const abort of ['cancel', 'close', 'signal']) {
    const calls: any[] = [];
    let shown!: () => void, finish!: (value: boolean) => void;
    const prompted = new Promise<void>(resolve => { shown = resolve; });
    const owner = new NotebookProjectRequests(async (input: any) => { calls.push(input); return { summary: 'Saved project choice' }; }, async () => {
      shown(); return new Promise<boolean>(resolve => { finish = resolve; });
    });
    const controller = new AbortController(), first = owner.apply({ operation: 'set', change }, controller.signal);
    await prompted;
    await assert.rejects(owner.apply({ operation: 'set', change }), /pending/);
    if (abort === 'cancel') await owner.apply({ operation: 'cancel', entryId: change.entryId });
    else if (abort === 'close') owner.close();
    else controller.abort();
    finish(true);
    assert.deepEqual(await first, { state: 'cancelled' });
    assert.deepEqual(calls.map(call => call.operation), ['review']);
  }
});

test('project requests expose a read-only list without consent and never automatically retry unknown writes', async () => {
  const calls: any[] = [];
  const owner = new NotebookProjectRequests(async (input: any) => {
    calls.push(input);
    if (input.operation === 'list') return { projects: [] };
    if (input.operation === 'review') return { summary: 'Confirmed choice' };
    throw new Error('connection interrupted');
  }, async () => true);
  assert.deepEqual(await owner.apply({ operation: 'list' }), { projects: [] });
  await assert.rejects(owner.apply({ operation: 'set', change }), /interrupted/);
  assert.equal(calls.filter(call => call.operation === 'apply').length, 1);
});

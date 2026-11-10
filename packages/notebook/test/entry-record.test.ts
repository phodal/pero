import assert from 'node:assert/strict';
import test from 'node:test';
import { entryCode, entryIdentity, recordMention } from '../src/entry-record.ts';

const entryId = 'a1b2c3d4e5f6789012345678abcdef01';

test('entry code and mentions stay on the entry', () => {
  assert.equal(entryCode(entryId), `EXP${parseInt(entryId.slice(0, 8), 16).toString().padStart(8, '0').slice(-8)}`);
  assert.equal(entryCode('not-an-id'), null);
  assert.deepEqual(entryIdentity(entryId, null), { code: entryCode(entryId), status: 'in_progress' });
  assert.deepEqual(entryIdentity(entryId, { code: 'EXP00000001', status: 'completed' }), { code: 'EXP00000001', status: 'completed' });
  const notices = recordMention([], { id: 'mention-1', name: ' Ada ', at: '2026-11-10T00:00:00.000Z', note: 'check the table' });
  assert.deepEqual(notices, [{ id: 'mention-1', name: 'Ada', at: '2026-11-10T00:00:00.000Z', note: 'check the table' }]);
  assert.equal(recordMention(notices ?? [], { id: 'mention-1', name: 'Ada', at: '2026-11-10T00:00:00.000Z', note: '' }), null);
  assert.equal(recordMention([], { id: 'bad id', name: 'Ada', at: '2026-11-10T00:00:00.000Z', note: '' }), null);
  assert.equal(recordMention([], { id: 'mention-2', name: ' ', at: '2026-11-10T00:00:00.000Z', note: '' }), null);
  assert.equal(recordMention([], { id: 'mention-2', name: 'Ada', at: 'yesterday', note: '' }), null);
});

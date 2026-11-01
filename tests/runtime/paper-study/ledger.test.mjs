import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { CampaignLedger } from './ledger.mjs';

test('unbounded campaign reservations remain serialized and failures stay counted', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'paper-study-ledger-'));
  try {
    const path = join(directory, 'ledger.json');
    await writeFile(path, JSON.stringify({ schema: 'paper-study-provider-ledger.v1', owner: 'validate_go_skill_trajectories',
      maxSessions: null, startedSessions: 21, sessions: Array.from({ length: 21 }, (_, i) => ({ session: i + 1, httpAttempts: 1 })), httpAttempts: 21, status: 'idle' }));
    const ledger = await CampaignLedger.acquire(path, text => text.replaceAll('fixture-secret', '[REDACTED]'));
    await assert.rejects(CampaignLedger.acquire(path), { code: 'EEXIST' });
    await ledger.reserve('synthetic', directory, 'fixed-time');
    assert.equal(JSON.parse(await readFile(path)).startedSessions, 22);
    await assert.rejects(ledger.reserve('duplicate', directory, 'fixed-time'));
    await ledger.finish({ httpAttempts: 3, passed: false, finishedAt: 'fixed-end', usage: ['fixture-secret'] });
    await ledger.close();
    const saved = JSON.parse(await readFile(path));
    assert.equal(saved.startedSessions, 22); assert.equal(saved.httpAttempts, 24);
    assert.equal(saved.sessions.at(-1).status, 'failed-or-aborted');
    assert.deepEqual(saved.sessions.at(-1).usage, ['[REDACTED]']);
    const next = await CampaignLedger.acquire(path);
    await next.reserve('unknown-audit', directory, 'fixed-time');
    await next.finish({ httpAttempts: null, passed: false, finishedAt: 'fixed-end', usage: [] });
    await next.close();
    assert.equal(JSON.parse(await readFile(path)).httpAttempts, null);
    await assert.rejects(CampaignLedger.acquire(path), /Reconcile/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { CampaignLedger } from './ledger.mjs';
const plan = { digest: 'fresh-plan-digest', authorizationReference: 'fresh-reference', limits: { maxSessions: null } };

test('unbounded campaign reservations remain serialized and failures stay counted', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'paper-study-ledger-'));
  try {
    const path = join(directory, 'ledger.json');
    await writeFile(path, JSON.stringify({ schema: 'paper-study-provider-ledger.v1', status: 'idle' }));
    await assert.rejects(CampaignLedger.acquire(path, plan), /Historical/);
    await rm(path);
    const ledger = await CampaignLedger.acquire(path, plan, text => text.replaceAll('fixture-secret', '[REDACTED]'));
    await assert.rejects(CampaignLedger.acquire(path, plan), { code: 'EEXIST' });
    await ledger.reserve('synthetic', directory, 'fixed-time');
    assert.equal(JSON.parse(await readFile(path)).startedSessions, 1);
    await assert.rejects(ledger.reserve('duplicate', directory, 'fixed-time'));
    await ledger.finish({ httpAttempts: 3, passed: false, finishedAt: 'fixed-end', usage: ['fixture-secret'] });
    await ledger.close();
    const saved = JSON.parse(await readFile(path));
    assert.equal(saved.startedSessions, 1); assert.equal(saved.httpAttempts, 3);
    assert.equal(saved.sessions.at(-1).status, 'failed-or-aborted');
    assert.deepEqual(saved.sessions.at(-1).usage, ['[REDACTED]']);
    await assert.rejects(CampaignLedger.acquire(path, { ...plan, digest: 'changed-plan' }), /changed/);
    const next = await CampaignLedger.acquire(path, plan);
    await next.reserve('unknown-audit', directory, 'fixed-time');
    await next.finish({ httpAttempts: null, passed: false, finishedAt: 'fixed-end', usage: [] });
    await next.close();
    assert.equal(JSON.parse(await readFile(path)).httpAttempts, null);
    await assert.rejects(CampaignLedger.acquire(path, plan), /Reconcile/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('explicit finite campaign cannot reserve beyond its approved count', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'paper-study-budget-'));
  try {
    const path = join(directory, 'ledger.json'), finite = { ...plan, limits: { maxSessions: 1 } };
    const first = await CampaignLedger.acquire(path, finite);
    await first.reserve('standard', directory, 'fixed');
    await first.finish({ httpAttempts: 1, passed: false, finishedAt: 'fixed', usage: [] }); await first.close();
    const second = await CampaignLedger.acquire(path, finite);
    try { await assert.rejects(second.reserve('standard', directory, 'fixed'), /limit reached/); }
    finally { await second.close(); }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

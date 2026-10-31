import { strict as assert } from 'node:assert';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { reserveAttempts } from './attempt-ledger.mjs';

test('reservations share the six-attempt budget across invocations and fail closed', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pero-attempt-ledger-'));
  try {
    const path = join(dir, 'ledger.json');
    assert.equal((await reserveAttempts(path, 3)).reserved, 3);
    assert.equal((await reserveAttempts(path, 2)).reserved, 5);
    await assert.rejects(reserveAttempts(path, 2), /budget-exhausted/);
    assert.equal((await reserveAttempts(path, 1)).reserved, 6);
    await assert.rejects(reserveAttempts(path, 1), /budget-exhausted/);
    assert.deepEqual(JSON.parse(await readFile(path, 'utf8')).reservations, [3, 2, 1]);
    await rm(`${path}.attempts`);
    await assert.rejects(reserveAttempts(path, 1), { code: 'ENOENT' });
    await writeFile(path, '{');
    await assert.rejects(reserveAttempts(path, 1));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a concurrent or interrupted ledger owner blocks a new reservation', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pero-attempt-ledger-'));
  try {
    const path = join(dir, 'ledger.json');
    await writeFile(`${path}.lock`, '');
    await assert.rejects(reserveAttempts(path, 1), { code: 'EEXIST' });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('an orphan audit cannot be reset by repeated reservations, even when empty', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pero-attempt-ledger-'));
  try {
    const path = join(dir, 'ledger.json');
    await writeFile(`${path}.attempts`, '');
    await assert.rejects(reserveAttempts(path, 1), { code: 'EEXIST' });
    await assert.rejects(reserveAttempts(path, 1), { code: 'EEXIST' });
    await assert.rejects(readFile(path), { code: 'ENOENT' });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

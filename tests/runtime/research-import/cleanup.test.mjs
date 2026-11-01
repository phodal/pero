import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { descendants, finishDescendants, scrubTree } from './cleanup.mjs';

test('exact-key redaction removes all echoes without retaining originals or altering other bytes', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'research-redaction-'));
  try {
    await mkdir(resolve(directory, 'nested'));
    await writeFile(resolve(directory, 'nested/trajectory.jsonl'), 'before fixture-only-key after fixture-only-key');
    await writeFile(resolve(directory, 'asset'), Buffer.from([0, 1, 254, 255]));
    assert.equal(await scrubTree(directory, 'fixture-only-key'), true);
    assert.equal(await readFile(resolve(directory, 'nested/trajectory.jsonl'), 'utf8'), 'before [REDACTED] after [REDACTED]');
    assert.deepEqual(await readFile(resolve(directory, 'asset')), Buffer.from([0, 1, 254, 255]));
    assert.equal(await scrubTree(directory, 'fixture-only-key'), false);
    await assert.rejects(scrubTree(directory, ''), /Nonempty/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('only captured descendants are stopped, with their original PID identity', { skip: process.platform !== 'linux', timeout: 10000 }, async () => {
  const child = spawn(process.execPath, ['-e', `const {spawn}=require('node:child_process');const nested=spawn(process.execPath,['-e',"process.stdin.resume();process.stdin.on('end',()=>process.exit());setInterval(()=>{},1000)"]);nested.once('spawn',()=>process.stdout.write('ready\\n'));setInterval(()=>{},1000);`], { stdio: ['ignore', 'pipe', 'ignore'] });
  const exited = once(child, 'exit');
  try {
    await once(child.stdout, 'data');
    const owned = await descendants(child.pid);
    assert.equal(owned.length, 1);
    const result = await finishDescendants(owned);
    assert.deepEqual(result, { descendantsExited: true, descendantCount: 1, forcedDescendants: true });
    assert.deepEqual(await finishDescendants(owned), { descendantsExited: true, descendantCount: 1, forcedDescendants: false });
  } finally { child.kill(); await exited; }
});

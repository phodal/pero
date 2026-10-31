import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { InstallRecords } from '../src/connectors/install-records.mjs';

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'point-install-records-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const bin = join(dir, 'ansys-aedt-mcp');
  await writeFile(bin, '#!/bin/sh\n'); await chmod(bin, 0o755);
  return { dir, bin, file: join(dir, 'connector.json') };
}

test('install records persist in the shared connector file and keep its other sections', async t => {
  const { bin, file } = await fixture(t);
  await writeFile(file, JSON.stringify({ version: 1, other: { kept: true } }));
  await new InstallRecords(file).record('ansys-aedt', bin, new Date('2026-10-11T00:00:00Z'));
  assert.deepEqual(await new InstallRecords(file).list(), [{ providerId: 'ansys-aedt', path: bin, installedAt: '2026-10-11T00:00:00.000Z' }]);
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')).other, { kept: true });
});

test('verify keeps a present executable and drops a record whose file is gone', async t => {
  const { dir, bin, file } = await fixture(t);
  const records = new InstallRecords(file);
  await records.record('ansys-aedt', bin);
  await records.record('ansys-mapdl', join(dir, 'missing'));
  assert.equal(await records.verify('ansys-aedt'), 'ready');
  assert.equal(await records.verify('ansys-mapdl'), 'missing');
  assert.deepEqual((await records.list()).map(record => record.providerId), ['ansys-aedt']);
});

test('a missing or unreadable file reads as no records', async t => {
  const { file } = await fixture(t);
  assert.deepEqual(await new InstallRecords(file).list(), []);
  await writeFile(file, '{not json');
  assert.deepEqual(await new InstallRecords(file).list(), []);
});

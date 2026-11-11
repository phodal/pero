import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { stageBuiltinApp } from './builtin-app-payload.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
test('production Notebook stages exact pinned citation Wasm and complete notices without node_modules', async () => {
  const root = resolve(import.meta.dirname, '../..'), app = resolve(root, 'apps/notebook');
  const expected = await readFile(new URL(import.meta.resolve('refkit-js/refkit.wasm')));
  assert.equal(expected.length, 8_380_150);
  const names = (await readdir(resolve(app, 'dist'))).filter(name => name.endsWith('.wasm'));
  let asset;
  for (const name of names) if (digest(await readFile(resolve(app, 'dist', name))) === digest(expected)) asset = name;
  assert.ok(asset, 'Production build must emit the actual pinned citation engine');
  assert.ok((await readFile(resolve(app, 'dist/index.js'), 'utf8')).includes(asset));
  const folder = await mkdtemp(resolve(tmpdir(), 'pero-citation-payload-'));
  try {
    stageBuiltinApp(app, 'notebook', folder);
    assert.equal(digest(await readFile(resolve(folder, 'dist', asset))), digest(expected));
    for (const name of ['myst-csl-dependencies-1.txt', 'myst-csl-dependencies-2.txt', 'myst-csl-data.txt', 'myst-csl-data-license.txt']) assert.deepEqual(await readFile(resolve(folder, 'licenses', name)), await readFile(resolve(app, 'licenses', name)));
    await assert.rejects(stat(resolve(folder, 'node_modules')), { code: 'ENOENT' });
  } finally { await rm(folder, { recursive: true, force: true }); }
});

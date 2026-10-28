import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readAppBundle, stageAppBundle } from './app-bundle.mjs';

test('external bundle stages only declared artifacts and refuses missing entries or escaping files', () => {
  const temp = mkdtempSync(join(tmpdir(), 'pero-bundle-'));
  try {
    const source = join(temp, 'external');
    mkdirSync(join(source, 'dist'), { recursive: true });
    const files = ['app.json', 'dist/index.html'];
    const descriptor = { schemaVersion: 1, name: 'sample', files };
    const manifest = { schemaVersion: 1, name: 'sample', contributes: { panels: [{ id: 'main', entry: 'dist/index.html' }] } };
    writeFileSync(join(source, 'app-bundle.json'), JSON.stringify(descriptor));
    writeFileSync(join(source, 'app.json'), JSON.stringify(manifest));
    writeFileSync(join(source, 'dist/index.html'), 'external panel');
    writeFileSync(join(source, 'private-source.mjs'), 'never stage this');
    const output = join(temp, 'distribution/apps/sample');
    stageAppBundle(readAppBundle(source), output);
    rmSync(source, { recursive: true });
    assert.equal(readFileSync(join(output, 'dist/index.html'), 'utf8'), 'external panel');
    assert.equal(existsSync(join(output, 'private-source.mjs')), false);

    writeFileSync(join(output, 'app-bundle.json'), JSON.stringify({ ...descriptor, files: ['app.json'] }));
    assert.throws(() => readAppBundle(output), /panel and backend entries/);
    writeFileSync(join(output, 'app-bundle.json'), JSON.stringify({ ...descriptor, files: [...files, 'escape'] }));
    writeFileSync(join(temp, 'outside'), 'not an artifact');
    symlinkSync(join(temp, 'outside'), join(output, 'escape'));
    assert.throws(() => readAppBundle(output), /regular file inside/);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

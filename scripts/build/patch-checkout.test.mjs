import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

// Exercise Git's real checkout conversion, independent of the host platform.
test('pinned GPUI patch retains canonical bytes with Windows checkout defaults', t => {
  const canonical = readFileSync(new URL('../../patches/gpui-pre-web-0.3.10-ime.patch', import.meta.url));
  const attributes = readFileSync(new URL('../../.gitattributes', import.meta.url));
  const root = mkdtempSync(join(tmpdir(), 'pero-patch-checkout-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  git('init', '-q');
  git('config', '--local', 'core.autocrlf', 'true');
  git('config', '--local', 'core.safecrlf', 'false');
  const emptyAttributes = join(root, 'empty-attributes');
  writeFileSync(emptyAttributes, '');
  git('config', '--local', 'core.attributesFile', emptyAttributes);
  mkdirSync(join(root, 'patches'));
  const patch = join(root, 'patches/gpui-pre-web-0.3.10-ime.patch');
  writeFileSync(patch, canonical);
  git('add', 'patches');
  rmSync(patch);
  git('checkout', '--', 'patches');
  assert.ok(readFileSync(patch).includes(Buffer.from('\r\n')));
  const corrupt = spawnSync('git', ['apply', '--numstat', patch], { cwd: root, encoding: 'utf8' });
  assert.notEqual(corrupt.status, 0);
  assert.match(corrupt.stderr, /corrupt patch/);

  writeFileSync(join(root, '.gitattributes'), attributes);
  git('add', '.gitattributes');
  rmSync(patch);
  git('checkout', '--', 'patches');
  assert.deepEqual(readFileSync(patch), canonical);
  assert.match(git('apply', '--numstat', patch).toString(), /src\/events\.rs/);
});

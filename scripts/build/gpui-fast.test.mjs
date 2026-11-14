import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

test('pinned Native backend patch preserves the registry and can be reused', t => {
  const cache = join(process.env.CARGO_HOME || join(homedir(), '.cargo'), 'registry/cache');
  const name = 'gpui-fast-0.1.13.crate';
  const archive = existsSync(cache) && readdirSync(cache).map(directory => join(cache, directory, name)).find(existsSync);
  if (!archive) { t.skip('Pinned crate is not cached; this check does not use the network'); return; }
  const fixture = mkdtempSync(join(tmpdir(), 'pero-native-a11y-patch-'));
  t.after(() => rmSync(fixture, { recursive: true, force: true }));
  const write = (path, text) => {
    mkdirSync(dirname(join(fixture, path)), { recursive: true });
    writeFileSync(join(fixture, path), text);
  };
  for (const module of ['gpui-fast', 'paths', 'run']) {
    write(`scripts/lib/${module}.mjs`, readFileSync(new URL(`../lib/${module}.mjs`, import.meta.url)));
  }
  const patch = 'gpui-fast-0.1.13-a11y-prepaint-rollback.patch';
  write(`patches/${patch}`, readFileSync(new URL(`../../patches/${patch}`, import.meta.url)));
  const cargoCache = join(fixture, 'cargo/registry/cache/pinned');
  mkdirSync(cargoCache, { recursive: true });
  copyFileSync(archive, join(cargoCache, name));
  const original = readFileSync(join(cargoCache, name));
  write('prepare.mjs', 'import {fastBackend,prepareFastBackend} from "./scripts/lib/gpui-fast.mjs"; await prepareFastBackend(); console.log(fastBackend);');
  const prepare = () => execFileSync(process.execPath, ['prepare.mjs'], {
    cwd: fixture, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, CARGO_HOME: join(fixture, 'cargo'), CARGO_TARGET_DIR: 'target' },
  }).trim();
  const patched = prepare();
  assert.equal(prepare(), patched);
  assert.deepEqual(readFileSync(join(cargoCache, name)), original);
  assert.match(readFileSync(join(patched, 'src/window.rs'), 'utf8'), /self\.a11y\.rollback_prepaint\(a11y\)/);
  assert.match(readFileSync(join(patched, 'src/window/a11y.rs'), 'utf8'), /prepaint_retry_rolls_back_nodes_focus_and_replay_log/);
  assert.match(readFileSync(join(patched, 'src/fast/a11y.rs'), 'utf8'), /self\.ops\.truncate\(checkpoint\.ops\)/);
});

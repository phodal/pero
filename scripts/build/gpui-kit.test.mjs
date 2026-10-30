import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

// Cargo automatically enrolls path dependencies beneath the consuming workspace,
// even when they have their own workspace root. Exercise the real cache builder.
test('patched Kit retains its own workspace and leaves the source immutable', t => {
  const root = mkdtempSync(join(tmpdir(), 'pero-kit-workspace-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  // Match the consumer checkout's canonical LF policy, not machine-wide Git defaults.
  execFileSync('git', ['init', '-q'], { cwd: root, stdio: 'pipe' });
  execFileSync('git', ['config', '--local', 'core.autocrlf', 'false'], { cwd: root, stdio: 'pipe' });
  const write = (path, contents) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), contents);
  };
  for (const name of ['gpui-kit', 'paths', 'run']) {
    write(`scripts/lib/${name}.mjs`, readFileSync(new URL(`../lib/${name}.mjs`, import.meta.url)));
  }
  write('source/Cargo.toml', '[workspace]\nmembers=["crates/kit", "crates/base", "crates/shared"]\nresolver="2"\n[workspace.dependencies]\nshared={path="crates/shared"}\n');
  write('source/crates/kit/Cargo.toml', '[package]\nname="gpui-kit"\nversion="0.8.1"\n');
  write('source/crates/kit/src/lib.rs', '');
  const base = '[package]\nname="gpui-base"\nversion="0.8.1"\n[dependencies]\nshared.workspace=true\n';
  write('source/crates/base/Cargo.toml', base);
  write('source/crates/base/src/lib.rs', '// original\n');
  write('source/crates/shared/Cargo.toml', '[package]\nname="shared"\nversion="0.1.0"\n');
  write('source/crates/shared/src/lib.rs', '');
  // Keep this fixture cache unique without relying on mtimes.
  write('source/fixture-id', root);
  for (const [name, before, after] of [
    ['source-search', 'original', 'search patched'],
    ['edit-events', 'search patched', 'both patched'],
  ]) {
    write(`patches/gpui-base-0.8.1-${name}.patch`, `diff --git a/crates/base/src/lib.rs b/crates/base/src/lib.rs\n--- a/crates/base/src/lib.rs\n+++ b/crates/base/src/lib.rs\n@@ -1 +1 @@\n-// ${before}\n+// ${after}\n`);
  }
  write('prepare.mjs', 'import {patchedKit, prepareKit} from "./scripts/lib/gpui-kit.mjs"; await prepareKit(); console.log(patchedKit);');
  const prepare = () => execFileSync(process.execPath, ['prepare.mjs'], {
    cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PERO_GPUI_KIT_PATH: join(root, 'source'), CARGO_TARGET_DIR: 'target' },
  }).trim();
  const patched = prepare();
  t.after(() => rmSync(patched, { recursive: true, force: true }));
  assert.equal(prepare(), patched, 'an unchanged source reuses the patched cache');
  assert.equal(readFileSync(join(patched, 'crates/base/src/lib.rs'), 'utf8'), '// both patched\n');
  assert.equal(readFileSync(join(root, 'source/crates/base/src/lib.rs'), 'utf8'), '// original\n');
  assert.equal(readFileSync(join(root, 'source/crates/base/Cargo.toml'), 'utf8'), base);
  const workspace = readFileSync(new URL('../../Cargo.toml', import.meta.url), 'utf8')
    .replace(/^members\s*=\s*\[[\s\S]*?\]/m, 'members = ["app"]');
  write('Cargo.toml', workspace);
  write('app/Cargo.toml', `[package]\nname="app"\nversion="0.1.0"\n[dependencies]\ngpui-base={path=${JSON.stringify(join(patched, 'crates/base'))}}\n`);
  write('app/src/lib.rs', '');
  const metadata = JSON.parse(execFileSync('cargo', ['metadata', '--offline', '--format-version', '1'], {
    cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }));
  assert.deepEqual(metadata.workspace_members, [metadata.packages.find(pkg => pkg.name === 'app').id]);
  assert.ok(metadata.packages.some(pkg => pkg.name === 'shared'));
  // Without the project exclusion Cargo steals Kit's inherited dependencies.
  write('Cargo.toml', workspace.replace(/^exclude\s*=\s*\[[\s\S]*?\]\s*$/m, ''));
  assert.throws(() => execFileSync('cargo', ['metadata', '--offline', '--format-version', '1'], {
    cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }), /error inheriting `shared` from workspace root/);
  write('Cargo.toml', workspace);
  write('source/fixture-id', `${root}-changed`);
  const changed = prepare();
  t.after(() => rmSync(changed, { recursive: true, force: true }));
  assert.notEqual(changed, patched, 'source contents invalidate the cache');
});

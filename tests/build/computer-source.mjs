// A source-only build must work without a Point checkout or ignored target cache.
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const copy = mkdtempSync(join(tmpdir(), 'pero-computer-source-'));
try {
  // Copy the real manifests and sources; retain workspace dependency inheritance.
  for (const path of ['Cargo.toml', 'use/computer', 'crates/pero-contracts', 'locales', 'scripts/build/computer.mjs']) {
    const destination = join(copy, path);
    mkdirSync(resolve(destination, '..'), { recursive: true });
    cpSync(join(root, path), destination, { recursive: true });
  }
  const env = {
    ...process.env,
    PERO_POINT_SOURCE: join(copy, 'no-point-checkout'),
    GIT_TERMINAL_PROMPT: '0',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: join(copy, 'no-git-config'),
    // Even a machine with saved GitHub credentials cannot fetch Point here.
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'url.file:///no-point-build-source/.insteadOf',
    GIT_CONFIG_VALUE_0: 'https://github.com/phodal/point.git',
  };
  for (const args of [['--test'], []]) {
    execFileSync(process.execPath, ['scripts/build/computer.mjs', ...args], { cwd: copy, env, stdio: 'inherit' });
  }
  const binary = join(copy, 'target/debug', process.platform === 'win32' ? 'pero-computer.exe' : 'pero-computer');
  assert.ok(existsSync(binary));
  assert.equal(existsSync(join(copy, 'target/point-computer-source')), false);
  assert.equal(existsSync(join(copy, 'target/point-computer-checkout')), false);
  if (process.argv.includes('--x11')) {
    execFileSync(process.execPath, [join(root, 'tests/e2e/computer-linux.mjs')], {
      cwd: root, env: { ...env, PERO_COMPUTER_BINARY: binary }, stdio: 'inherit',
    });
  }
  console.log('Computer Use source-only test/build passed with Point access denied and no source cache.');
} finally {
  rmSync(copy, { recursive: true, force: true });
}

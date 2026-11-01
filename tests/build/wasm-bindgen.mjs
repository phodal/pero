// Exercise the real build script with only process/toolchain I/O replaced.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const cases = [
  ['pinned cache', { status: 0, stdout: 'wasm-bindgen 0.2.127\n' }, false],
  ['wrong version', { status: 0, stdout: 'wasm-bindgen 0.2.126\n' }, true],
  ['missing binary', { status: null, error: { code: 'ENOENT' } }, true],
  ['unusable cached binary', { status: 1, stdout: 'wasm-bindgen 0.2.127\n' }, true],
  ['unexpected version output', { status: 0, stdout: 'wasm-bindgen 0.2.127 modified\n' }, true],
];
for (const [name, probe, reinstall] of cases) {
  test(name, () => {
    const root = mkdtempSync(join(tmpdir(), 'pero-bindgen-'));
    try {
      mkdirSync(join(root, 'scripts/build'), { recursive: true });
      mkdirSync(join(root, 'scripts/lib'), { recursive: true });
      cpSync(new URL('../../scripts/build/wasm.mjs', import.meta.url), join(root, 'scripts/build/wasm.mjs'));
      writeFileSync(join(root, 'scripts/build/fonts.mjs'), '');
      writeFileSync(join(root, 'scripts/lib/paths.mjs'), `export const root = ${JSON.stringify(root)};`);
      writeFileSync(join(root, 'scripts/lib/cargo.mjs'), 'export const cargoArgs = args => args; export const ensureGpuiLock = async () => {};');
      writeFileSync(join(root, 'scripts/lib/run.mjs'), 'export const calls = []; export const run = async (...args) => { calls.push(args); };');
      const runner = join(root, 'run.mjs');
      writeFileSync(runner, `
        import childProcess from 'node:child_process';
        import { syncBuiltinESMExports } from 'node:module';
        import assert from 'node:assert/strict';
        childProcess.spawnSync = (binary, args) => {
          assert.ok(binary.endsWith(process.platform === 'win32' ? 'wasm-bindgen.exe' : 'wasm-bindgen'));
          assert.deepEqual(args, ['--version']);
          return ${JSON.stringify(probe)};
        };
        syncBuiltinESMExports();
        await import('./scripts/build/wasm.mjs');
        const { calls } = await import('./scripts/lib/run.mjs');
        console.log(JSON.stringify(calls));
      `);
      const calls = JSON.parse(execFileSync(process.execPath, [runner], {
        encoding: 'utf8', env: { ...process.env, PERO_BUILD_RELEASE: '0' }, timeout: 10_000,
      }));
      const installs = calls.filter(([command, args]) => command === 'cargo' && args[0] === 'install');
      assert.deepEqual(installs, reinstall ? [['cargo', [
        'install', 'wasm-bindgen-cli', '--version', '0.2.127', '--locked', '--force', '--root', `${root}/target/tools`,
      ]]] : []);
      assert.ok(calls.some(([command]) => command.endsWith(process.platform === 'win32' ? 'wasm-bindgen.exe' : 'wasm-bindgen')), 'build continues to generate Wasm bindings');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

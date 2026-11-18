// Exercise the real build script with only process/toolchain I/O replaced.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const cases = [
  ['cached tool in the Workbench App build', { status: 0, stdout: 'wasm-bindgen 0.2.127\n' }, false, 'workbench-apps.mjs'],
  ['wrong version', { status: 0, stdout: 'wasm-bindgen 0.2.126\n' }, true],
  ['missing binary', { status: null, error: { code: 'ENOENT' } }, true],
  ['unusable cached binary', { status: 1, stdout: 'wasm-bindgen 0.2.127\n' }, true],
  ['unexpected version output', { status: 0, stdout: 'wasm-bindgen 0.2.127 modified\n' }, true],
  ['standalone Chat and Reader share their Content Worker', { status: 0, stdout: 'wasm-bindgen 0.2.127\n' }, false, 'wasm.mjs', ['--reader-and-chat']],
];
for (const [name, probe, reinstall, entry = 'wasm.mjs', flags = []] of cases) {
  test(name, () => {
    const root = mkdtempSync(join(tmpdir(), 'pero-bindgen-'));
    try {
      mkdirSync(join(root, 'scripts/build'), { recursive: true });
      mkdirSync(join(root, 'scripts/lib'), { recursive: true });
      for (const file of ['wasm.mjs', 'reader.mjs', 'workbench-apps.mjs']) {
        cpSync(new URL(`../../scripts/build/${file}`, import.meta.url), join(root, 'scripts/build', file));
      }
      writeFileSync(join(root, 'scripts/build/fonts.mjs'), '');
      writeFileSync(join(root, 'scripts/lib/paths.mjs'), `export const root = ${JSON.stringify(root)};`);
      writeFileSync(join(root, 'scripts/lib/cargo.mjs'), 'export const cargoArgs = args => args; export const ensureGpuiLock = async () => {};');
      writeFileSync(join(root, 'scripts/lib/run.mjs'), `
        export const calls = [];
        export async function run(command, args) {
          calls.push([command, args]);
          if (args[0] === 'scripts/build/wasm.mjs') await import('../build/wasm.mjs');
        }
      `);
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
        await import('./scripts/build/${entry}');
        const { calls } = await import('./scripts/lib/run.mjs');
        console.log(JSON.stringify(calls));
      `);
      const calls = JSON.parse(execFileSync(process.execPath, [runner, ...flags], {
        encoding: 'utf8', env: { ...process.env, PERO_BUILD_RELEASE: '0' }, timeout: 10_000,
      }));
      const installs = calls.filter(([command, args]) => command === 'cargo' && args[0] === 'install');
      assert.deepEqual(installs, reinstall ? [['cargo', [
        'install', 'wasm-bindgen-cli', '--version', '0.2.127', '--locked', '--force', '--root', `${root}/target/tools`,
      ]]] : []);
      const bindings = calls.filter(([command]) => command.endsWith(process.platform === 'win32' ? 'wasm-bindgen.exe' : 'wasm-bindgen'));
      const cargoOutput = artifact => `${root}/target/wasm32-unknown-unknown/debug/${artifact}.wasm`;
      assert.deepEqual(bindings.map(([, args]) => args[0]), [
        ...(flags.length ? [] : ['pero_ui']), 'pero_chat_web', 'pero_reader_web', 'pero_content_worker',
      ].map(cargoOutput));
      if (entry === 'workbench-apps.mjs') {
        const appReader = join(root, 'web', 'dist-reader');
        assert.deepEqual(calls.slice(-2).map(([, args]) => args), [
          [join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--outDir', appReader],
          ['scripts/build/apps.mjs', '--reader-dist', appReader],
        ]);
      }
      assert.deepEqual(calls.filter(([command]) => command === 'rustup'), [['rustup', ['target', 'add', '--toolchain', 'nightly-2026-10-28', 'wasm32-unknown-unknown']]]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

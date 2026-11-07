import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after } from 'node:test';

const directory = await mkdtemp(join(tmpdir(), 'pero agent background '));
after(() => rm(directory, { recursive: true, force: true }));
const preload = join(directory, 'windows background.cjs');
await copyFile(new URL('../../packages/agent-runtime/windows-background.cjs', import.meta.url), preload);
const launcher = join(directory, 'agent launcher.mjs');
await writeFile(launcher, `
  import { spawn } from 'node:child_process';
  import { fileURLToPath } from 'node:url';
  const depth = Number(process.argv[2]);
  const [command, args] = depth > 0
    ? [process.execPath, [fileURLToPath(import.meta.url), String(depth - 1)]]
    : JSON.parse(process.env.BACKGROUND_PROBE);
  const child = spawn(command, args, { stdio: ['ignore', 'inherit', 'inherit'] });
  child.on('error', error => { console.error(error); process.exitCode = 1; });
  child.on('exit', code => { process.exitCode = code ?? 1; });
`);

function run(command, args, depth = 0) {
  return spawnSync(process.execPath, [launcher, String(depth)], {
    windowsHide: true, detached: true, encoding: 'utf8', timeout: 30_000,
    env: { ...process.env, NODE_OPTIONS: `--require="${preload.replaceAll('\\', '/')}"`, BACKGROUND_PROBE: JSON.stringify([command, args]) },
  });
}

test('background Node descendants preserve arguments, stdout and exit status', () => {
  const args = ['argument with spaces', '--ordinary-flag', 'embedded "quotes"'];
  const result = run(process.execPath, ['-e', 'console.log(JSON.stringify(process.argv.slice(1))); process.exitCode = 17;', '--', ...args], 1);
  assert.ifError(result.error);
  assert.equal(result.status, 17, result.stderr);
  assert.equal(result.stderr, '');
  assert.deepEqual(JSON.parse(result.stdout), args);
});

for (const args of ['undefined', 'null']) {
  test(`background spawn preserves options with ${args} arguments`, () => {
    const result = run(process.execPath, ['-e', `
      const { spawn } = require('node:child_process');
      const child = spawn(process.execPath, ${args}, {
        env: { ...process.env, PERO_OVERLOAD_PROBE: 'present' }, stdio: 'pipe',
      });
      child.stdout.pipe(process.stdout);
      child.stderr.pipe(process.stderr);
      child.on('exit', code => { process.exitCode = code ?? 1; });
      child.stdin.end('console.log(process.env.PERO_OVERLOAD_PROBE)');
    `]);
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    assert.equal(result.stdout.trim(), 'present');
  });
}

test('background Node adapters hide native consoles through inherited NODE_OPTIONS', { skip: process.platform !== 'win32' }, async t => {
  const probe = join(directory, 'console visibility.ps1');
  await writeFile(probe, `
    param([string]$Value)
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ConsoleProbe {
  [DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow();
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
}
'@
    @{ visible = [ConsoleProbe]::IsWindowVisible([ConsoleProbe]::GetConsoleWindow()); argument = $Value } | ConvertTo-Json -Compress
    exit 17
  `);
  for (const depth of [0, 1]) {
    await t.test(`Node depth ${depth}`, () => {
      const result = run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', probe, 'native argument with spaces'], depth);
      assert.ifError(result.error);
      assert.equal(result.status, 17, result.stderr);
      assert.equal(result.stderr, '');
      assert.deepEqual(JSON.parse(result.stdout), { visible: false, argument: 'native argument with spaces' });
    });
  }
});

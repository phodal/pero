// Real, owned AppKit application shared by native and provider acceptance.
import { execFileSync, spawn } from 'node:child_process';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export const computerEvidenceDirectory = root => resolve(process.env.PERO_COMPUTER_RESULTS || resolve(root, 'target/computer-verification'));

export async function waitFor(condition, description = 'native fixture effect', timeout = 10_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await condition();
    if (result) return result;
    await delay(40);
  }
  throw new Error(`Expected ${description} was not observed`);
}

export async function computerFixture(root, run, guard = false) {
  const executable = resolve(run, 'fixture');
  if (!existsSync(executable)) execFileSync('swiftc', [resolve(root, 'tests/fixtures/computer-app.swift'), '-o', executable]);
  const name = guard ? 'PeroComputerGuard' : 'PeroComputerFixture';
  const app = resolve(run, `${name}.app`), contents = resolve(app, 'Contents');
  await mkdir(resolve(contents, 'MacOS'), { recursive: true });
  await copyFile(executable, resolve(contents, 'MacOS/fixture'));
  await writeFile(resolve(contents, 'Info.plist'), `<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleExecutable</key><string>fixture</string><key>CFBundleIdentifier</key><string>dev.pero.${name.toLowerCase()}</string><key>CFBundleName</key><string>${name}</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleVersion</key><string>1</string><key>NSHighResolutionCapable</key><true/><key>NSPrincipalClass</key><string>NSApplication</string></dict></plist>`);
  execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', app]);
  const effects = resolve(run, `${name}-effects.json`);
  const child = spawn('/usr/bin/open', ['-n', '-W', app, '--args', effects, ...(guard ? ['guard'] : [])], { stdio: ['ignore', 'ignore', 'pipe'] });
  child.stderr.on('data', data => process.stderr.write(data));
  const state = async () => JSON.parse(await readFile(effects, 'utf8'));
  const pid = await waitFor(async () => { if (!existsSync(effects)) return false; return (await state()).pid; }, `${name} readiness`);
  return {
    app, pid, state,
    async activate() {
      execFileSync('/usr/bin/open', ['-a', app]);
      await waitFor(async () => (await state()).foregroundPID === pid, `${name} activation`);
    },
    async close() {
      try { process.kill(pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
      child.kill('SIGTERM');
      await rm(app, { recursive: true, force: true });
    },
  };
}

// Opt-in Native GPUI draft acceptance with a test-owned external window.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { computerFixture, waitFor } from '../fixtures/computer-app.mjs';

const app = process.env.PERO_NATIVE_APPSHOT_APP;
const physical = process.env.PERO_NATIVE_APPSHOT_PHYSICAL === '1';
assert(process.platform === 'darwin' && app, 'Set PERO_NATIVE_APPSHOT_APP to a signed Native probe app.');
const installed = await realpath(app);
for (const bundle of [installed, resolve(dirname(installed), 'Pero Computer Use.app')]) {
  execFileSync('/usr/bin/codesign', ['--verify', '--strict', '--deep', bundle]);
}
const root = resolve(import.meta.dirname, '../..');
const run = await mkdtemp(resolve(tmpdir(), 'pero-native-appshot-'));
const profile = resolve(run, 'profile');
const workspace = resolve(run, 'workspace');
const agents = resolve(run, 'agents.json');
const receipt = resolve(run, 'appshot.json');
const acpLog = resolve(run, 'acp.jsonl');
let fixture, child;
try {
  await Promise.all([mkdir(profile), mkdir(workspace)]);
  await writeFile(resolve(profile, 'settings.json'), JSON.stringify({ chat_agent: 'appshot-fixture' }));
  await writeFile(agents, JSON.stringify([{ id: 'appshot-fixture', name: 'Appshot fixture', command: process.execPath,
    args: [resolve(root, 'tests/fixtures/session-preparation.mjs'), 'appshot-fixture', acpLog] }]));
  fixture = await computerFixture(root, run, false, { name: 'PeroNativeAppshot', background: true });
  child = spawn(resolve(installed, 'Contents/MacOS/pero-native'), ['--verify-apps', receipt, 'appshot'], {
    cwd: workspace, stdio: ['ignore', 'ignore', 'inherit'],
    env: {
      ...process.env, PERO_NATIVE_DATA_DIR: profile, PERO_NATIVE_APPSHOT_WORKSPACE: workspace,
      PERO_NATIVE_EPHEMERAL_SECRETS: '1', PERO_ENV_FILE: '/dev/null', PERO_AGENTS_FILE: agents,
      PERO_LOCALE: 'en',
    },
  });
  const exited = once(child, 'exit');
  const deadline = setTimeout(() => child.kill('SIGTERM'), physical ? 310_000 : 40_000);
  try {
    await waitFor(() => {
      if (existsSync(receipt)) return true;
      assert(child.exitCode === null && child.signalCode === null,
        `Native Appshot exited before its draft was ready (${child.exitCode ?? child.signalCode})`);
      return existsSync(resolve(run, 'appshot.ready'));
    }, 'Native image-capable draft', 36_000);
    if (!existsSync(receipt)) {
      await fixture.activate();
      if (physical) {
        console.log('With “Pero Computer Fixture” in front, press Control+Shift+Command+7 once.');
      } else {
        await writeFile(resolve(run, 'appshot.capture'), String(fixture.pid));
      }
    }
    assert.deepEqual(await exited, [0, null]);
  } finally { clearTimeout(deadline); }
  const result = JSON.parse(await readFile(receipt, 'utf8'));
  assert.equal(result.passed, true, result.error);
  assert.equal(result.draft, 'Original Appshot draft');
  assert.equal(result.image?.label, 'Pero Computer Fixture');
  assert.equal(result.image?.mimeType, 'image/jpeg');
  assert.equal(Buffer.from(result.image.data, 'base64').readUInt16BE(), 0xffd8);
  assert.match(result.text, /Increment/);
  const calls = (await readFile(acpLog, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert(calls.some(call => call.method === 'session/new'));
  assert(!calls.some(call => call.method === 'session/prompt'));
  console.log(`${physical ? 'Physical shortcut: ' : ''}Native Appshot attached window pixels and AX text to the original draft without sending it.`);
} finally {
  child?.kill();
  await fixture?.close();
  await rm(run, { recursive: true, force: true });
}

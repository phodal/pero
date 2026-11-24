// Opt-in acceptance in Sublime Text's clean Safe Mode. Use a logged-in macOS desktop.
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, resolve } from 'node:path';
import { build } from 'esbuild';
import { computerEvidenceDirectory, waitFor } from '../fixtures/computer-app.mjs';
import { assertDesktopAccess } from './electron.mjs';

if (process.platform !== 'darwin' || process.env.PERO_COMPUTER_NATIVE !== '1') {
  throw new Error('Run with PERO_COMPUTER_NATIVE=1 on a logged-in macOS desktop');
}
assertDesktopAccess();
assert.equal(spawnSync('/usr/bin/pgrep', ['-x', 'sublime_text']).status, 1,
  'Quit Sublime Text before launching the disposable Safe Mode window');
const app = '/Applications/Sublime Text.app';
const version = execFileSync('/usr/bin/plutil', ['-extract', 'CFBundleShortVersionString', 'raw',
  resolve(app, 'Contents/Info.plist')], { encoding: 'utf8' }).trim();
const root = resolve(import.meta.dirname, '../..');
const work = await mkdtemp(resolve(tmpdir(), 'pero-sublime-gui-'));
const output = resolve(computerEvidenceDirectory(root), 'sublime', basename(work));
await mkdir(output, { recursive: true });
const driverModule = resolve(work, 'computer.mjs');
await build({ entryPoints: [resolve(root, 'desktop/src/main/computer.ts')], outfile: driverModule,
  bundle: true, platform: 'node', format: 'esm' });
const { DesktopComputer } = await import(driverModule);
const desktop = new DesktopComputer(resolve(root, 'target/debug/pero-computer'), resolve(work, 'evidence'), () => {});
const thread = randomUUID();
const signal = new AbortController().signal;
const call = request => desktop.call(thread, request, signal);
const filename = `${basename(work)}.txt`;
const path = resolve(work, filename);
const original = 'Disposable source: ';
const insertion = 'Pero native GUI acceptance - 星图 🌱';
const expected = insertion + original;
const receipts = [];
const findWindow = async () => (await call({ operation: 'targets' })).targets.find(target =>
  target.application_id === 'com.sublimetext.4' && target.title?.includes(filename))?.reference;
let editor, exited, report;

function launchEditor() {
  editor = spawn(resolve(app, 'Contents/MacOS/sublime_text'), ['--safe-mode', '-n', path], { stdio: 'ignore' });
  exited = once(editor, 'exit');
}

async function stopEditor() {
  if (editor?.pid && editor.exitCode === null && editor.signalCode === null) {
    editor.kill();
    await exited;
  }
}

async function observe(target, stage) {
  const value = await call({ operation: 'observe', target });
  assert.ok(value.image && value.observation.screenshot);
  await writeFile(resolve(output, `${stage}.jpg`), Buffer.from(value.image.data, 'base64'));
  return value.observation;
}

async function act(name, target, observation, action) {
  const { id, width, height } = observation.screenshot;
  const anchor = { kind: 'pixel', screenshot_id: id, point: { x: Math.round(width * 0.22), y: Math.round(height * 0.35) } };
  const focus = action.kind === 'focus_window';
  const { receipt } = await call({ operation: 'act', action: { request_id: name, target, observation_id: observation.id,
    delivery: focus ? 'foreground' : 'background', input: focus ? action : { ...action, anchor } } });
  receipts.push(receipt);
  assert.equal(receipt.outcome.status, 'executed', JSON.stringify(receipt));
}

try {
  const { status } = await desktop.status();
  assert.equal(status.accessibility, 'granted', status.message);
  assert.equal(status.screen_recording, 'granted', status.message);
  await desktop.restore(true, ['com.sublimetext.4']);
  await writeFile(path, original);
  launchEditor();
  const window = await waitFor(findWindow, 'owned Sublime document');
  await act('focus', window, await observe(window, 'initial'), { kind: 'focus_window' });
  await act('focus-editor', window, await observe(window, 'focused'), { kind: 'click', button: 'left', count: 1 });
  await act('type', window, await observe(window, 'ready-to-edit'), { kind: 'type_text', text: insertion });
  await act('save', window, await observe(window, 'edited'), { kind: 'press_key', keys: ['Meta', 's'] });
  await waitFor(async () => await readFile(path, 'utf8') !== original, 'Sublime saved the document');
  assert.equal(await readFile(path, 'utf8'), expected);
  await act('close', window, await observe(window, 'saved'), { kind: 'press_key', keys: ['Meta', 'w'] });
  await waitFor(async () => !(await findWindow()), 'document closed');
  await stopEditor();
  launchEditor();
  const reopened = await waitFor(findWindow, 'document reopened in a new editor process');
  assert.notDeepEqual(reopened, window);
  await observe(reopened, 'reopened');
  assert.equal(await readFile(path, 'utf8'), expected);
  report = { passed: true, version, reopened: true, savedSha256: createHash('sha256').update(expected).digest('hex'), receipts };
} catch (error) {
  report = { passed: false, version, error: String(error), receipts };
  throw error;
} finally {
  await desktop.stop();
  await stopEditor();
  await writeFile(resolve(output, 'result.json'), JSON.stringify(report, null, 2));
  await rm(work, { recursive: true, force: true });
}
console.log(`Sublime Text ${version}: exact UTF-8 bytes, five native receipts and reopened document. ${output}`);

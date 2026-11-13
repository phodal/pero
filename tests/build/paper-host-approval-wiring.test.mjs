// No GUI/input: guard the separately authorized new Host UI opt-in boundary.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { observeApprovalStartup, approvalStartupState, captureOwnedApproval, saveApprovalStartup } from '../fixtures/paper-host-approval-diagnostics.mjs';
import test from 'node:test';
const read = path => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const workflow = read('.github/workflows/computer-use.yml');
const fixture = read('tests/e2e/paper-host-approval-native.mjs');
const helper = read('tests/fixtures/paper-host-approval.mjs');
const gate = "runner.os == 'Linux' && (github.event_name == 'workflow_dispatch' && inputs.paper_host_approval_native)";
const step = name => {
  const text = workflow.split(`      - name: ${name}\n`)[1];
  assert.ok(text, `Missing ${name}`);
  return text.split('      - name: ')[0];
};

test('new positive UI entry requires its own explicit Linux opt-in, default off', () => {
  assert.match(workflow, /paper_host_approval_native:\n(?:[^\n]*\n){3}        default: false/);
  assert.match(workflow, /permissions:\n  contents: read\njobs:/);
  for (const name of ['Prepare opt-in Host approval UI', 'Owned Host approval semantic UI only', 'Owned Host approval UI evidence']) {
    const body = step(name);
    assert.ok(body.includes(`if: ${name.endsWith('evidence') ? 'always() && ' : ''}${gate}\n`));
    assert.ok(!body.includes('ci:full'));
    assert.ok(!body.includes('ci:paper-native-diagnostic'));
    assert.ok(!body.includes('paper-reproduction-native.mjs'));
  }
  const prepare = step('Prepare opt-in Host approval UI');
  assert.ok(prepare.includes('npm ci --registry=https://registry.npmjs.org'));
  assert.ok(prepare.includes('node scripts/build/desktop.mjs'));
  const connectorInstall = 'npm ci --prefix packages/connectors --ignore-scripts --registry=https://registry.npmjs.org';
  assert.ok(prepare.includes(connectorInstall), 'Connectors owns a separate lockfile outside root workspaces');
  assert.ok(prepare.indexOf(connectorInstall) < prepare.indexOf('node scripts/build/desktop.mjs'));
  const connectorLock = JSON.parse(read('packages/connectors/package-lock.json'));
  for (const name of ['fflate', 'pdfjs-dist']) assert.ok(connectorLock.packages[`node_modules/${name}`]);
  assert.doesNotMatch(prepare, /--external|npm install|build\/connectors\.mjs/);
  assert.ok(prepare.includes('--test desktop/src/main/reproduction-approval-linux.test.ts'));
  assert.ok(workflow.includes('node scripts/build/computer.mjs\n'));
  for (const script of ['scripts/build/desktop.mjs', 'scripts/build/product.mjs']) {
    assert.ok(read(script).includes("'reproduction-approval-preload':"));
    assert.ok(read(script).includes('desktop/src/preload/reproduction-approval.ts'));
  }
});

test('UI run is bounded, isolated and saves only its exact owned evidence', () => {
  const run = step('Owned Host approval semantic UI only');
  assert.ok(run.includes('timeout-minutes: 3'));
  assert.ok(run.includes("PERO_PAPER_HOST_APPROVAL_NATIVE: '1'"));
  assert.ok(run.includes('--name paper-host-approval-native --timeout-seconds 120 -- xvfb-run -a node tests/e2e/paper-host-approval-native.mjs'));
  assert.match(step('Owned Host approval UI evidence'), /path: \|\n            test-results\/paper-host-approval-native\/\n            test-results\/ci\/paper-host-approval-native.json\n          retention-days: 7/);
  assert.ok(fixture.includes("spawnSync('dbus-run-session', ['--', process.execPath, import.meta.filename]"));
  assert.ok(fixture.includes('await copyFile('));
  assert.ok(fixture.includes("desktop/dist/reproduction-approval-preload.cjs"));
  assert.ok(fixture.includes('createHash(\'sha256\')'));
  assert.ok(fixture.includes("assert.equal(excludedOwnerMatches, 0"));
  assert.ok(fixture.includes("receipt.outcome.execution?.route, 'semantic'"));
  assert.ok(helper.includes("assert.equal(observation.truncated, false"));
  assert.ok(helper.includes("contents.some(element => element.label.includes(nonce))"));
  assert.ok(helper.includes("button.actions.includes('click')"));
  assert.doesNotMatch(fixture, /\.click\s*\(|\.press\s*\(|sendInputEvent|kind:\s*['"]pixel['"]|--confirm-execution|paper_agent\.pcgym/);
});


test('startup diagnostics retain failure details with bounded events and window summaries', () => {
  const app = new EventEmitter();
  const events = observeApprovalStartup(app);
  const windows = Array.from({ length: 12 }, (_, id) => diagnosticWindow(id));
  app.emit('browser-window-created', {}, windows[0]);
  windows[0].webContents.emit('did-fail-load', {}, -2, 'x'.repeat(1000), 'https://secret.invalid/private', true);
  windows[0].webContents.emit('preload-error', {}, '/private/preload', new Error('y'.repeat(1000)));
  windows[0].webContents.emit('render-process-gone', {}, { reason: 'crashed' });
  for (let i = 0; i < 100; i++) windows[0].emit('show');
  assert.equal(events.length, 64);
  assert.deepEqual(events.slice(0, 4), [
    { id: 0, kind: 'created' },
    { id: 0, kind: 'did-fail-load', code: -2, mainFrame: true, description: 'x'.repeat(200) },
    { id: 0, kind: 'preload-error', error: 'Error', message: 'y'.repeat(300) },
    { id: 0, kind: 'render-process-gone', reason: 'crashed' },
  ]);
  globalThis.paperHostApproval = { state: () => ({ ownerId: 42, disabled: false }), events };
  try {
    const snapshot = approvalStartupState({ BrowserWindow: { getAllWindows: () => windows } });
    assert.equal(snapshot.windows.length, 8);
    assert.equal(snapshot.state.disabled, false, 'Diagnostics must not turn failure into readiness');
    assert.deepEqual(snapshot.events, events);
    assert.equal(snapshot.windows[0].urlScheme, 'data');
    assert.ok(!JSON.stringify(snapshot).includes('private'));
  } finally { delete globalThis.paperHostApproval; }
});

function diagnosticWindow(id, parentId = 42, title = 'Paper reproduction') {
  const window = new EventEmitter();
  Object.assign(window, { id, getTitle: () => title, isVisible: () => true, isModal: () => true,
    getParentWindow: () => ({ id: parentId }), webContents: new EventEmitter() });
  Object.assign(window.webContents, { isLoading: () => false, getURL: () => 'data:text/html,private',
    capturePage: async () => ({ isEmpty: () => false, toPNG: () => Buffer.from('owned pixels') }) });
  return window;
}

test('diagnostic image capture requires exactly one matching title and parent', async () => {
  globalThis.paperHostApproval = { state: () => ({ ownerId: 42 }) };
  try {
    const owned = diagnosticWindow(1);
    const foreign = diagnosticWindow(2, 99);
    foreign.webContents.capturePage = () => assert.fail('Never capture another owner');
    const otherTitle = diagnosticWindow(3, 42, 'Other title');
    otherTitle.webContents.capturePage = () => assert.fail('Never capture another title');
    for (const windows of [[], [foreign, otherTitle], [owned, diagnosticWindow(4)]]) {
      assert.deepEqual(await captureOwnedApproval({ BrowserWindow: { getAllWindows: () => windows } }),
        { skipped: 'no unique owned approval window' });
    }
    assert.deepEqual(await captureOwnedApproval({ BrowserWindow: { getAllWindows: () => [foreign, owned, otherTitle] } }),
      { windowId: 1, empty: false, png: Buffer.from('owned pixels').toString('base64') });
  } finally { delete globalThis.paperHostApproval; }
});

test('startup artifacts label renderer evidence and bound an unresponsive capture', async context => {
  const out = await mkdtemp(join(tmpdir(), 'paper-approval-diagnostics-'));
  context.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    for (const mode of ['image', 'timeout']) {
      let captureStarted;
      const started = new Promise(resolve => { captureStarted = resolve; });
      const application = { evaluate: async callback => {
        if (callback === approvalStartupState) return { state: { disabled: false }, events: [], windows: [] };
        assert.equal(callback, captureOwnedApproval);
        captureStarted();
        return mode === 'image' ? { windowId: 1, empty: false, png: Buffer.from('owned pixels').toString('base64') } : new Promise(() => {});
      } };
      const saved = saveApprovalStartup(application, out, mode);
      await started;
      if (mode === 'timeout') {
        let settled = false;
        void saved.then(() => { settled = true; });
        context.mock.timers.tick(1999);
        await Promise.resolve();
        assert.equal(settled, false);
        context.mock.timers.tick(1);
      }
      await saved;
      const state = JSON.parse(await readFile(join(out, `${mode}-startup.json`), 'utf8'));
      assert.equal(state.state.disabled, false);
      const metadata = JSON.parse(await readFile(join(out, `${mode}-startup-image.json`), 'utf8'));
      assert.equal(metadata.source, 'owned renderer diagnostic only; not native approval evidence');
      if (mode === 'timeout') assert.match(metadata.error, /timed out/);
      else {
        assert.equal(metadata.windowId, 1);
        assert.match(metadata.sha256, /^[a-f0-9]{64}$/);
        assert.equal(await readFile(join(out, 'image-startup.png'), 'utf8'), 'owned pixels');
      }
    }
    assert.deepEqual((await readdir(out)).sort(), ['image-startup-image.json', 'image-startup.json', 'image-startup.png', 'timeout-startup-image.json', 'timeout-startup.json']);
  } finally { await rm(out, { recursive: true, force: true }); }
});

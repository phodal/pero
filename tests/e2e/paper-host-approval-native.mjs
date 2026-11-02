// Explicitly authorized new Linux Host-owned UI; no Host worker or computation.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { build } from 'esbuild';
import { expect } from '@playwright/test';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { electron } from './electron.mjs';
import { waitFor } from '../fixtures/computer-app.mjs';
import { approvalTarget, approvalAction, approvalTitle } from '../fixtures/paper-host-approval.mjs';
import { closeOwnedElectron } from './owned-electron-close.mjs';

assert.equal(process.platform, 'linux', 'This new approval path is Linux-only');
assert.equal(process.env.PERO_PAPER_HOST_APPROVAL_NATIVE, '1', 'Explicit no-compute semantic approval opt-in required');
if (process.env.PERO_PAPER_HOST_APPROVAL_DBUS !== '1') {
  const child = spawnSync('dbus-run-session', ['--', process.execPath, import.meta.filename], {
    stdio: 'inherit', env: { ...process.env, PERO_PAPER_HOST_APPROVAL_DBUS: '1', ACCESSIBILITY_ENABLED: '1', GTK_A11Y: 'atspi', NO_AT_BRIDGE: '' },
  });
  if (child.error) throw child.error;
  assert.equal(child.status, 0, `Host approval fixture failed (${child.signal || child.status})`);
} else {
  const root = resolve(import.meta.dirname, '../..');
  const temporary = await mkdtemp(join(tmpdir(), 'pero-paper-host-approval-'));
  const out = resolve(root, 'test-results/paper-host-approval-native');
  const nonce = `authored-no-compute-${randomUUID()}`;
  const drivers = [];
  function computer(excludedPid) {
    const env = { ...process.env }; delete env.PERO_COMPUTER_HOST_PID;
    if (excludedPid !== undefined) env.PERO_COMPUTER_HOST_PID = String(excludedPid);
    const child = spawn(resolve(root, 'target/debug/pero-computer'), [], { env, stdio: ['pipe', 'pipe', 'inherit'] });
    drivers.push(child);
    let sequence = 0, failure;
    const replies = new Map();
    child.on('error', error => { failure = error; });
    child.stdin.on('error', error => { failure = error; });
    createInterface({ input: child.stdout }).on('line', line => {
      try { const reply = JSON.parse(line); replies.set(reply.id, reply); }
      catch (error) { failure = error; }
    });
    return async request => {
      const id = `paper-host-${++sequence}`;
      child.stdin.write(JSON.stringify({ id, thread: 'paper-host-no-compute', request }) + '\n');
      const reply = await waitFor(() => {
        if (failure) throw failure;
        if (child.exitCode !== null || child.signalCode !== null) throw Error('Owned native driver exited');
        return replies.get(id);
      }, 'native driver reply');
      replies.delete(id);
      assert.equal(reply.error, undefined, 'Native driver refused requested capability');
      return reply.value;
    };
  }
  let application;
  try {
    await mkdir(out, { recursive: true });
    // Static production preload is built by the existing Desktop build. Never
    // generate a test preload or change the production window's IPC boundary.
    await copyFile(resolve(root, 'desktop/dist/reproduction-approval-preload.cjs'), join(temporary, 'reproduction-approval-preload.cjs'));
    await build({
      stdin: { contents: `
        import { app, BrowserWindow } from 'electron';
        import { confirmReproduction } from './desktop/src/main/reproduction-approval.ts';
        // Existing computer-electron fixture convention: expose renderer AX tree.
        app.commandLine.appendSwitch('force-renderer-accessibility');
        app.whenReady().then(() => {
          const events = [];
          const record = (id, kind, detail = {}) => { if (events.length < 64) events.push({ id, kind, ...detail }); };
          app.on('browser-window-created', (_event, window) => {
            const id = window.id, contents = window.webContents;
            record(id, 'created');
            for (const kind of ['show', 'closed', 'unresponsive']) window.on(kind, () => record(id, kind));
            for (const kind of ['did-start-loading', 'dom-ready', 'did-finish-load', 'did-stop-loading'])
              contents.on(kind, () => record(id, kind));
            contents.on('did-fail-load', (_event, code, description, _url, mainFrame) => record(id, 'did-fail-load', { code, mainFrame, description: description.slice(0, 200) }));
            contents.on('preload-error', (_event, _path, error) => record(id, 'preload-error', { error: error.name, message: error.message.slice(0, 300) }));
            contents.on('render-process-gone', (_event, details) => record(id, 'render-process-gone', { reason: details.reason }));
          });
          const keeper = new BrowserWindow({ show: false });
          let owner, controller, result, failure;
          globalThis.paperHostApproval = {
            keeper,
            events,
            create() {
              owner = new BrowserWindow({ show: true, width: 480, height: 320 });
              owner.loadURL('data:text/html,<title>Owned no-compute parent</title><p>No worker exists</p>');
              return owner.isEnabled();
            },
            begin() {
              controller = new AbortController(); result = undefined; failure = undefined;
              void confirmReproduction(owner, ${JSON.stringify(`SYNTHETIC HOST APPROVAL FIXTURE. No job will run. ${nonce}`)}, controller.signal)
                .then(value => { result = value; }, error => { failure = String(error); });
            },
            state() { return { ownerId: owner?.id, disabled: !owner.isDestroyed() && !owner.isEnabled(), destroyed: owner.isDestroyed(), result, failure }; },
            abort() { controller.abort(); },
            closeOwner() { owner.close(); },
            destroyOwner() { owner.destroy(); },
          };
        });`, resolveDir: root, loader: 'ts' },
      outfile: join(temporary, 'main.cjs'), bundle: true, platform: 'node', format: 'cjs', external: ['electron'],
    });
    application = await electron.launch({ requiresNativeWindow: true, args: [join(temporary, 'main.cjs')], cwd: root });
    await expect.poll(() => application.evaluate(() => Boolean(globalThis.paperHostApproval)), { timeout: 10000 }).toBe(true);
    await writeFile(join(out, 'runtime.json'), JSON.stringify(await application.evaluate(() => ({
      electron: process.versions.electron, chromium: process.versions.chrome, node: process.versions.node,
      requestedAccessibility: process.env.ACCESSIBILITY_ENABLED, forceRendererAccessibility: true,
      scope: 'New trusted Host-owned Linux window, not a repaired GTK dialog; no worker/science',
    })), null, 2));
    // Failure-only capture of this authored process, before cleanup destroys the
    // window. Renderer PNG is diagnostic only, never semantic/native evidence.
    async function waitForOwnedModal(stage) {
      try {
        await expect.poll(() => application.evaluate(() => globalThis.paperHostApproval.state().disabled), { timeout: 10000 }).toBe(true);
      } catch (error) {
        const state = await application.evaluate(({ BrowserWindow }) => ({
          state: globalThis.paperHostApproval.state(), events: globalThis.paperHostApproval.events,
          windows: BrowserWindow.getAllWindows().slice(0, 8).map(window => ({
            id: window.id, title: window.getTitle(), visible: window.isVisible(), modal: window.isModal(),
            parentId: window.getParentWindow()?.id, loading: window.webContents.isLoading(),
            urlScheme: window.webContents.getURL().split(':')[0],
          })),
        }));
        await writeFile(join(out, `${stage}-startup.json`), JSON.stringify(state, null, 2));
        let timer;
        try {
          const capture = await Promise.race([
            application.evaluate(async ({ BrowserWindow }) => {
              const ownerId = globalThis.paperHostApproval.state().ownerId;
              const matches = BrowserWindow.getAllWindows().filter(window => window.getTitle() === 'Paper reproduction' && window.getParentWindow()?.id === ownerId);
              if (matches.length !== 1) return { skipped: 'no unique owned approval window' };
              const pixels = await matches[0].webContents.capturePage();
              return { windowId: matches[0].id, empty: pixels.isEmpty(), png: pixels.toPNG().toString('base64') };
            }),
            new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Owned diagnostic capture timed out')), 2000); }),
          ]);
          const { png, ...metadata } = capture;
          if (png) {
            const bytes = Buffer.from(png, 'base64');
            await writeFile(join(out, `${stage}-startup.png`), bytes);
            metadata.sha256 = createHash('sha256').update(bytes).digest('hex');
          }
          await writeFile(join(out, `${stage}-startup-image.json`), JSON.stringify({ source: 'owned renderer diagnostic only; not native approval evidence', ...metadata }, null, 2));
        } catch (captureError) {
          await writeFile(join(out, `${stage}-startup-image.json`), JSON.stringify({ error: captureError.message }, null, 2));
        } finally { clearTimeout(timer); }
        throw error;
      }
    }
    const checks = [];
    for (const mode of ['abort', 'owner-close', 'owner-destroy']) {
      assert.equal(await application.evaluate(() => globalThis.paperHostApproval.create()), true);
      await application.evaluate(() => globalThis.paperHostApproval.begin());
      await waitForOwnedModal(mode);
      if (mode === 'abort') await application.evaluate(() => globalThis.paperHostApproval.abort());
      else if (mode === 'owner-close') await application.evaluate(() => globalThis.paperHostApproval.closeOwner());
      else await application.evaluate(() => globalThis.paperHostApproval.destroyOwner());
      await expect.poll(() => application.evaluate(() => globalThis.paperHostApproval.state().result), { timeout: 10000 }).toBe(false);
      await expect.poll(() => application.evaluate(() => globalThis.paperHostApproval.state().destroyed), { timeout: 10000 }).toBe(mode !== 'abort');
      await expect.poll(() => application.evaluate(() => globalThis.paperHostApproval.state().disabled), { timeout: 10000 }).toBe(false);
      assert.equal((await application.evaluate(() => globalThis.paperHostApproval.state())).failure, undefined);
      if (mode === 'abort') await application.evaluate(() => globalThis.paperHostApproval.closeOwner());
      checks.push({ mode, ownerDisabledObserved: true, decision: false });
    }
    await writeFile(join(out, 'lifecycle.json'), JSON.stringify({ checks }, null, 2));
    const call = computer();
    const status = (await call({ operation: 'status' })).status;
    await writeFile(join(out, 'capability.json'), JSON.stringify(status, null, 2));
    assert.equal(status.available, true);
    assert.equal(status.accessibility, 'granted');
    const pid = await application.evaluate(() => process.pid);
    const excludingOwner = computer(pid);
    for (const label of ['Cancel', 'Run once']) {
      const name = label === 'Cancel' ? 'cancel' : 'run-once';
      assert.equal(await application.evaluate(() => globalThis.paperHostApproval.create()), true);
      await application.evaluate(() => globalThis.paperHostApproval.begin());
      await waitForOwnedModal(name);
      let listed;
      await expect.poll(async () => {
        listed = await call({ operation: 'targets' });
        return listed.targets.filter(target => target.title === approvalTitle).length;
      }, { timeout: 10000 }).toBe(1);
      const target = approvalTarget(listed.targets);
      const excludedOwnerMatches = (await excludingOwner({ operation: 'targets' })).targets.filter(target => target.title === approvalTitle).length;
      await writeFile(join(out, `${name}-ownership.json`), JSON.stringify({ pid, primaryDialogMatches: 1, excludedOwnerMatches,
        method: 'unchanged driver exact PID exclusion and geometry-bound observation' }, null, 2));
      assert.equal(excludedOwnerMatches, 0, 'Exact fixture Electron PID exclusion must remove approval window');
      assert.deepEqual(approvalTarget((await call({ operation: 'targets' })).targets), target);
      let observed;
      try {
        await expect.poll(async () => {
          observed = await call({ operation: 'observe', target });
          return observed.observation.elements.some(element => element.label.includes(nonce));
        }, { timeout: 10000 }).toBe(true);
      } finally {
        if (observed) {
          await writeFile(join(out, `${name}-observation.json`), JSON.stringify({ nonce, observation: observed.observation }, null, 2));
          assert.ok(observed.image && observed.observation.screenshot, 'Owned native screenshot required');
          assert.equal(observed.observation.screenshot.media_type, 'image/jpeg');
          const bytes = Buffer.from(observed.image.data, 'base64');
          await writeFile(join(out, `${name}.jpg`), bytes);
          await writeFile(join(out, `${name}-image.json`), JSON.stringify({
            source: 'unchanged native X11 driver observation, not renderer capture',
            revision: process.env.GITHUB_SHA || 'local-unverified', observationId: observed.observation.id,
            target, screenshot: observed.observation.screenshot, sha256: createHash('sha256').update(bytes).digest('hex'),
          }, null, 2));
        }
      }
      const action = approvalAction(observed.observation, target, nonce, label, `host-${name}-${randomUUID()}`);
      const receipt = (await call({ operation: 'act', action })).receipt;
      await writeFile(join(out, `${name}-action.json`), JSON.stringify({ action, receipt }, null, 2));
      assert.equal(receipt.request_id, action.request_id);
      assert.equal(receipt.observation_id, action.observation_id);
      assert.deepEqual(receipt.target, target);
      assert.equal(receipt.outcome.status, 'executed');
      assert.equal(receipt.outcome.execution?.route, 'semantic', 'No nonsemantic delivery counts');
      await expect.poll(() => application.evaluate(() => globalThis.paperHostApproval.state().result), { timeout: 10000 }).toBe(label === 'Run once');
      await expect.poll(() => application.evaluate(() => globalThis.paperHostApproval.state().disabled), { timeout: 10000 }).toBe(false);
      assert.equal((await application.evaluate(() => globalThis.paperHostApproval.state())).failure, undefined);
      checks.push({ mode: `semantic-${name}`, ownerDisabledObserved: true, ownerExclusionMatched: true, decision: label === 'Run once' });
      await application.evaluate(() => globalThis.paperHostApproval.closeOwner());
      await expect.poll(async () => (await call({ operation: 'targets' })).targets.filter(t => t.title === approvalTitle).length).toBe(0);
    }
    await writeFile(join(out, 'report.json'), JSON.stringify({
      scope: 'New Linux Host-owned approval UI: semantic Cancel/Run once, abort, owner close/destroy; no worker or scientific execution; old GTK remains unresolved', checks,
    }, null, 2));
  } finally {
    try {
      try {
        await Promise.all(drivers.map(async child => {
          child.stdin.end();
          if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
          await waitFor(() => child.exitCode !== null || child.signalCode !== null, 'owned native driver exit', 2000);
        }));
      } finally {
        if (application) {
          try {
            if (application.process().exitCode === null && application.process().signalCode === null)
              await application.evaluate(() => globalThis.paperHostApproval?.abort());
          } finally { await closeOwnedElectron(application, { timeoutMs: 5000 }); }
        }
      }
    } finally { await rm(temporary, { recursive: true, force: true }); }
  }
}

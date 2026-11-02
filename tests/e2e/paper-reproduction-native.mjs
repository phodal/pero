// Real Linux native approval and lifecycle; authored text only, no Host or computation.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { build } from 'esbuild';
import { expect } from '@playwright/test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { electron } from './electron.mjs';
import { waitFor } from '../fixtures/computer-app.mjs';
import { approvalTarget, approvalAction, approvalEvidence, approvalTitle } from '../fixtures/paper-native-approval.mjs';
import { closeOwnedElectron } from './owned-electron-close.mjs';

if (process.platform !== 'linux') {
  console.log('Paper native lifecycle fixture is Linux-only; not verified on this platform.');
} else if (process.env.PERO_PAPER_NATIVE_DBUS !== '1') {
  // Only this fixture's children share this disposable bus; never use or change
  // the user's accessibility session. The enclosing suite retains its deadline.
  const child = spawnSync('dbus-run-session', ['--', process.execPath, import.meta.filename], {
    // Chromium's pinned AuraLinux bridge uses ACCESSIBILITY_ENABLED, not the
    // GTK-only hint. This enables discovery, never answers the native dialog.
    stdio: 'inherit', env: { ...process.env, PERO_PAPER_NATIVE_DBUS: '1', ACCESSIBILITY_ENABLED: '1', GTK_A11Y: 'atspi', NO_AT_BRIDGE: '' },
  });
  if (child.error) throw child.error;
  assert.equal(child.status, 0, `Native approval child failed (${child.signal || child.status})`);
} else {
  const root = resolve(import.meta.dirname, '../..');
  const temporary = await mkdtemp(join(tmpdir(), 'pero-paper-native-'));
  const out = resolve(root, 'test-results/paper-reproduction-native');
  const nonce = `authored-fixture-${randomUUID()}`;
  const drivers = [];
  // The existing private stdio protocol; each process is owned by this fixture.
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
      const id = `paper-native-${++sequence}`;
      child.stdin.write(JSON.stringify({ id, thread: 'paper-native-fixture', request }) + '\n');
      const reply = await waitFor(() => {
        if (failure) throw failure;
        if (child.exitCode !== null || child.signalCode !== null) throw Error('Owned native driver exited before its reply');
        return replies.get(id);
      }, 'native driver reply');
      replies.delete(id);
      assert.equal(reply.error, undefined, 'Native driver refused the requested capability');
      return reply.value;
    };
  }
  let application;
  try {
    await mkdir(out, { recursive: true });
    await build({
      stdin: { contents: `
        import { app, BrowserWindow } from 'electron';
        import { confirmReproduction } from './desktop/src/main/reproduction-approval.ts';
        app.whenReady().then(() => {
          const keeper = new BrowserWindow({ show: false });
          let owner, controller, result, failure;
          globalThis.paperNative = {
            keeper,
            create() {
              owner = new BrowserWindow({ show: true, width: 480, height: 320 });
              owner.loadURL('data:text/html,<title>Synthetic Paper lifecycle fixture</title><p>No scientific computation</p>');
              return owner.isEnabled();
            },
            begin() {
              controller = new AbortController(); result = undefined; failure = undefined;
              void confirmReproduction(owner, ${JSON.stringify(`SYNTHETIC LIFECYCLE FIXTURE. No job will run. ${nonce}`)}, controller.signal)
                .then(value => { result = value; }, error => { failure = String(error); });
            },
            state() { return { disabled: !owner.isDestroyed() && !owner.isEnabled(), destroyed: owner.isDestroyed(), result, failure }; },
            abort() { controller.abort(); },
            closeOwner() { owner.close(); },
          };
        });`, resolveDir: root, loader: 'ts' },
      outfile: join(temporary, 'main.cjs'), bundle: true, platform: 'node', format: 'cjs', external: ['electron'],
    });
    application = await electron.launch({ requiresNativeWindow: true, args: [join(temporary, 'main.cjs')], cwd: root });
    await expect.poll(() => application.evaluate(() => Boolean(globalThis.paperNative)), { timeout: 10000 }).toBe(true);
    await writeFile(join(out, 'runtime.json'), JSON.stringify(await application.evaluate(() => ({
      electron: process.versions.electron, chromium: process.versions.chrome, node: process.versions.node,
      requestedAccessibility: process.env.ACCESSIBILITY_ENABLED,
      observedNoAtBridge: process.env.NO_AT_BRIDGE ?? null,
      scope: 'Owned fixture environment only; bridge activation does not prove native GTK dialog exposure',
    })), null, 2));
    application.process().on('exit', (code, signal) => console.log('Paper native fixture process exit', JSON.stringify({ code, signal })));
    const checks = [];
    for (const mode of ['abort', 'owner-close']) {
      console.log('Paper native fixture stage', JSON.stringify({ mode, stage: 'create-owner' }));
      assert.equal(await application.evaluate(() => globalThis.paperNative.create()), true);
      await application.evaluate(() => { globalThis.paperNative.begin(); });
      // GTK disables the owner while its native modal is open. If the installed
      // Electron does not expose this readiness, fail; never substitute a delay.
      await expect.poll(() => application.evaluate(() => globalThis.paperNative.state().disabled), { timeout: 10000 }).toBe(true);
      console.log('Paper native fixture stage', JSON.stringify({ mode, stage: 'native-modal-ready' }));
      if (mode === 'abort') await application.evaluate(() => globalThis.paperNative.abort());
      else await application.evaluate(() => globalThis.paperNative.closeOwner());
      await expect.poll(() => application.evaluate(() => globalThis.paperNative.state().result), { timeout: 10000 }).toBe(false);
      console.log('Paper native fixture stage', JSON.stringify({ mode, stage: 'settled-deny' }));
      // Approval settlement and native owner teardown are separate events.
      await expect.poll(() => application.evaluate(() => globalThis.paperNative.state().destroyed), { timeout: 10000 }).toBe(mode === 'owner-close');
      await expect.poll(() => application.evaluate(() => globalThis.paperNative.state().disabled), { timeout: 10000 }).toBe(false);
      const state = await application.evaluate(() => globalThis.paperNative.state());
      assert.equal(state.failure, undefined);
      assert.equal(state.disabled, false);
      assert.equal(state.destroyed, mode === 'owner-close');
      if (mode === 'abort') await application.evaluate(() => globalThis.paperNative.closeOwner());
      checks.push({ mode, nativeOwnerDisabledObserved: true, decision: false });
    }
    await mkdir(out, { recursive: true });
    await writeFile(join(out, 'lifecycle.json'), JSON.stringify({ checks }, null, 2));
    // Capability probe first: no action until the actual modal, authored nonce,
    // owner identity and semantic button have all been observed independently.
    assert.equal(await application.evaluate(() => globalThis.paperNative.create()), true);
    await application.evaluate(() => { globalThis.paperNative.begin(); });
    await expect.poll(() => application.evaluate(() => globalThis.paperNative.state().disabled), { timeout: 10000 }).toBe(true);
    const call = computer();
    const status = (await call({ operation: 'status' })).status;
    await writeFile(join(out, 'capability.json'), JSON.stringify({ available: status.available,
      accessibility: status.accessibility, message: status.message }, null, 2));
    assert.equal(status.available, true);
    assert.equal(status.accessibility, 'granted', 'Native AT-SPI capability unavailable; no input fallback');
    let listed;
    await expect.poll(async () => {
      listed = await call({ operation: 'targets' });
      return listed.targets.filter(target => target.title === approvalTitle).length;
    }, { timeout: 10000 }).toBe(1);
    const target = approvalTarget(listed.targets);
    const pid = await application.evaluate(() => process.pid);
    const excludingOwner = computer(pid);
    const excludedOwnerMatches = (await excludingOwner({ operation: 'targets' })).targets.filter(target => target.title === approvalTitle).length;
    await writeFile(join(out, 'ownership.json'), JSON.stringify({
      primaryDialogMatches: 1, excludedOwnerMatches, method: 'existing native-driver exact Electron PID exclusion',
    }, null, 2));
    assert.equal(excludedOwnerMatches, 0,
      'Dialog must disappear when exact fixture Electron PID is excluded');
    assert.deepEqual(approvalTarget((await call({ operation: 'targets' })).targets), target);
    let observed;
    try {
      await expect.poll(async () => {
        observed = await call({ operation: 'observe', target });
        // Registration can follow native window mapping. Poll observed facts, not
        // a delay or an alternative action, before applying the strict contract.
        return observed.observation.elements.some(element => element.label.includes(nonce));
      }, { timeout: 10000 }).toBe(true);
    } finally {
      // Keep the last owned-window observation even when accessibility is absent.
      if (observed) {
        const evidence = approvalEvidence(observed.observation);
        await writeFile(join(out, 'native-dialog.json'), JSON.stringify({ ownerExclusionMatched: true, nonce, observation: evidence }, null, 2));
        assert.ok(observed.image && observed.observation.screenshot, 'Native dialog screenshot required');
        assert.equal(observed.observation.screenshot.media_type, 'image/jpeg');
        const bytes = Buffer.from(observed.image.data, 'base64');
        await writeFile(join(out, 'native-dialog.jpg'), bytes);
        await writeFile(join(out, 'native-dialog-image.json'), JSON.stringify({
          source: 'pero-computer native X11 observation of authored Electron dialog; not renderer capture',
          revision: process.env.GITHUB_SHA || 'local-unverified',
          observationId: observed.observation.id, target, screenshot: observed.observation.screenshot,
          sha256: createHash('sha256').update(bytes).digest('hex'),
        }, null, 2));
      }
    }
    const action = approvalAction(observed.observation, target, nonce);
    const receipt = (await call({ operation: 'act', action })).receipt;
    await writeFile(join(out, 'native-action.json'), JSON.stringify({ action, receipt }, null, 2));
    assert.equal(receipt.request_id, action.request_id);
    assert.equal(receipt.observation_id, action.observation_id);
    assert.deepEqual(receipt.target, target);
    assert.equal(receipt.outcome.status, 'executed', 'Native button invocation must execute');
    assert.equal(receipt.outcome.execution?.route, 'semantic', 'Native receipt must confirm the AT-SPI semantic route');
    await expect.poll(() => application.evaluate(() => globalThis.paperNative.state().result), { timeout: 10000 }).toBe(true);
    await expect.poll(() => application.evaluate(() => globalThis.paperNative.state().disabled), { timeout: 10000 }).toBe(false);
    assert.equal((await application.evaluate(() => globalThis.paperNative.state())).failure, undefined);
    checks.push({ mode: 'native-run-once', nativeOwnerDisabledObserved: true, ownerExclusionMatched: true, decision: true });
    await application.evaluate(() => globalThis.paperNative.closeOwner());
    await writeFile(join(out, 'report.json'), JSON.stringify({
      scope: 'Actual Linux Electron native Run once invocation, cancellation and normal owner.close; no Host/worker/science; forced destroy unresolved',
      electron: await application.evaluate(() => process.versions.electron), checks,
    }, null, 2));
    console.log('Paper native Run once, cancellation and owner-close passed (no computation).');
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
              await application.evaluate(() => globalThis.paperNative?.abort());
          } finally { await closeOwnedElectron(application, { timeoutMs: 5000 }); }
        }
      }
    }
    finally { await rm(temporary, { recursive: true, force: true }); }
  }
}

// Real Linux native-dialog lifecycle only: no allow click, Host, Python or computation.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { expect } from '@playwright/test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { electron } from './electron.mjs';

if (process.platform !== 'linux') {
  console.log('Paper native lifecycle fixture is Linux-only; not verified on this platform.');
} else {
  const root = resolve(import.meta.dirname, '../..');
  const temporary = await mkdtemp(join(tmpdir(), 'pero-paper-native-'));
  const out = resolve(root, 'test-results/paper-reproduction-native');
  let application;
  try {
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
              void confirmReproduction(owner, 'SYNTHETIC LIFECYCLE FIXTURE. No job will run.', controller.signal)
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
    await writeFile(join(out, 'report.json'), JSON.stringify({
      scope: 'Actual Linux Electron cancellation/normal owner.close lifecycle; forced destroy unresolved; no allow-click or scientific execution',
      electron: await application.evaluate(() => process.versions.electron), checks,
    }, null, 2));
    console.log('Paper native cancellation and owner-close lifecycle passed (no computation).');
  } finally {
    try { await application?.close(); }
    finally { await rm(temporary, { recursive: true, force: true }); }
  }
}

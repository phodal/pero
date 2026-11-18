import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { electron } from './electron.mjs';
import { closeOwnedElectron } from './owned-electron-close.mjs';

const root = resolve(import.meta.dirname, '../..');
const profile = await mkdtemp(resolve(tmpdir(), 'pero-workbench-startup-'));
const errors = [];
let app;
let ready = false;
try {
  app = await electron.launch({
    args: [...(process.platform === 'darwin' ? ['--use-mock-keychain'] : []), resolve(root, 'desktop')],
    cwd: root,
    env: {
      ...process.env,
      PERO_DESKTOP_DATA_DIR: profile,
      PERO_ENV_FILE: resolve(profile, '.env'),
      PERO_SETTINGS_PATH: resolve(profile, 'runtime-settings.json'),
      PERO_APPS_ROOT: resolve(profile, 'apps'),
      PERO_HISTORY_PATH: resolve(profile, 'sessions.jsonl'),
      PERO_HOST_EXECUTABLE: resolve(root, 'target/debug', process.platform === 'win32' ? 'pero-host.exe' : 'pero-host'),
      PERO_LOCALE: 'en',
    },
  });
  app.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  const result = await (await page.waitForFunction(() => {
    const loading = document.getElementById('loading');
    if (loading?.getAttribute('role') === 'alert') return { error: loading.textContent };
    if (loading || !window.peroDiagnostics) return false;
    const state = JSON.parse(window.peroDiagnostics.snapshot());
    return state.ready && state.connected && { ready: true };
  }, undefined, { timeout: 45_000 })).jsonValue();
  assert.equal(result.ready, true, result.error);
  ready = true;
  console.log('Electron Workbench renderer and Host are ready.');
} catch (error) {
  for (const message of errors) console.error(message);
  throw error;
} finally {
  try {
    if (app) await closeOwnedElectron(app, { crashed: !ready, timeoutMs: 10_000 });
  } finally {
    await rm(profile, { recursive: true, force: true });
  }
}

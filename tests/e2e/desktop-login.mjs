// Go/PostgreSQL + OAuth fixture + Chromium + Electron. OS URL delivery is tested
// separately with the local .app; here app.emit drives the native event boundary.
import { _electron as electron, chromium, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '../..');
if (!process.env.PERO_TEST_DATABASE_URL) throw new Error('Set PERO_TEST_DATABASE_URL');
const scratch = mkdtempSync(resolve(tmpdir(), 'pero-desktop-login-'));
const metadata = resolve(scratch, 'fixture.json');
const settings = resolve(scratch, 'settings.json');
const output = resolve(root, 'test-results/desktop-login'); mkdirSync(output, { recursive: true });
const child = spawn('go', ['test', '-count=1', '-run', '^TestCommunityBrowserFixture$', './internal/community'], {
  cwd: resolve(root, 'server'), env: { ...process.env, PERO_COMMUNITY_BROWSER_FIXTURE: metadata }, stdio: ['ignore', 'pipe', 'pipe'],
});
let logs = ''; child.stdout.on('data', x => logs += x); child.stderr.on('data', x => logs += x);
const finished = new Promise(done => child.on('exit', done));
let app, browser, succeeded = false;
const errors = [];
async function launch(base) {
  const env = { ...process.env, PERO_DESKTOP_DATA_DIR: resolve(scratch, 'profile'), PERO_SETTINGS_PATH: settings,
    PERO_HISTORY_PATH: resolve(scratch, 'history'), PERO_LOCALE: 'en', PERO_CLOUD_URL: base };
  for (const key of ['ELECTRON_RUN_AS_NODE', 'PERO_OPERATOR_TOKEN', 'PERO_CLIENT_TOKEN']) delete env[key];
  app = await electron.launch({ args: [resolve(root, 'desktop')], cwd: root, env });
  const page = await app.firstWindow(); page.on('pageerror', x => errors.push(x.message));
  const state = () => page.evaluate(() => window.peroDiagnostics ? JSON.parse(window.peroDiagnostics.snapshot()) : {});
  await expect.poll(async () => (await state()).ready, { timeout: 60_000 }).toBe(true);
  await page.evaluate(() => window.pero.remoteCommand({ action: 'remote_refresh' }));
  await app.evaluate(({ shell }) => { globalThis.loginURL = ''; shell.openExternal = async url => { globalThis.loginURL = url; }; });
  return { page, state, command: command => page.evaluate(value => window.pero.remoteCommand(value), command) };
}
async function callback(url) {
  await app.evaluate(({ app }, url) => app.emit('open-url', { preventDefault() {} }, url), url);
}
try {
  const deadline = Date.now() + 30_000;
  while (!existsSync(metadata)) {
    if (child.exitCode !== null || Date.now() > deadline) throw new Error(logs || 'Fixture startup failed');
    await new Promise(done => setTimeout(done, 100));
  }
  const { url, worker } = JSON.parse(readFileSync(metadata, 'utf8'));
  let ui = await launch(url);
  await ui.command({ action: 'remote_login', url });
  expect((await ui.state()).remote.state.connection.authenticating).toBe(true);
  const start = await app.evaluate(() => globalThis.loginURL);
  expect(start).toContain(`${url}/connect/desktop?`);
  expect(start).not.toContain('code_verifier');
  browser = await chromium.launch({ headless: true, ...(process.env.PERO_CHROMIUM_PATH ? { executablePath: process.env.PERO_CHROMIUM_PATH } : {}) });
  const context = await browser.newContext({ viewport: { width: 1100, height: 800 } });
  const page = await context.newPage();
  await page.goto(start);
  await expect(page.getByRole('heading', { name: '连接 Pero Desktop' })).toBeVisible();
  await page.screenshot({ path: resolve(output, 'consent-light.png') });
  // Operator grants existing Worker project scope, independently of sign-in.
  const admin = await browser.newPage();
  await admin.goto(`${url}/community/admin/login`);
  await admin.getByLabel('管理员凭证').fill('fixture-operator');
  await admin.getByRole('button', { name: '登录管理台' }).click();
  await admin.getByLabel('Worker ID', { exact: true }).fill(worker);
  await admin.getByLabel('GitHub 用户名').fill('alice');
  await admin.getByRole('button', { name: '绑定 Worker' }).click();
  await page.getByRole('button', { name: '连接 Desktop', exact: true }).click();
  const link = await page.getByRole('link', { name: '打开 Pero Desktop', exact: true }).getAttribute('href');
  expect(link).toMatch(/^pero:\/\/connect\/callback\?/);
  await page.screenshot({ path: resolve(output, 'return-light.png') });
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: resolve(output, 'return-dark-narrow.png') });
  const spoofed = new URL(link); spoofed.searchParams.set('state', 'z'.repeat(43));
  await callback(spoofed.href);
  await expect.poll(async () => (await ui.state()).remote.state.error).toContain('GitHub sign-in could not complete');
  expect((await ui.state()).remote.state.configured).toBe(false);
  await callback(link);
  await expect.poll(async () => (await ui.state()).remote.state.identity?.name, { timeout: 15_000 }).toBe('alice');
  expect((await ui.state()).remote.state.identity.projects).toEqual(['pero']);
  expect((await ui.state()).remote.state.connection.authenticating).toBe(false);
  expect((await ui.state()).remote.state.error).toBe(null);
  await ui.page.screenshot({ path: resolve(output, 'desktop-connected.png') });
  const saved = JSON.parse(readFileSync(settings, 'utf8')).remote_connection;
  expect(saved.mode).toBe('client'); expect(saved.encrypted_token.length).toBeGreaterThan(0);
  expect(readFileSync(settings, 'utf8')).not.toContain('secret_');
  expect(JSON.stringify(await ui.state())).not.toContain('secret_');
  expect(JSON.stringify(await ui.state())).not.toContain(saved.encrypted_token);
  await callback(link);
  expect((await ui.state()).remote.state.error).toBe(null);
  expect(JSON.parse(readFileSync(settings, 'utf8')).remote_connection).toEqual(saved);
  await app.close(); app = undefined;
  ui = await launch(url);
  expect((await ui.state()).remote.state.identity?.name).toBe('alice');
  await ui.command({ action: 'remote_login', url });
  await ui.command({ action: 'remote_login_cancel' });
  expect((await ui.state()).remote.state.connection.authenticating).toBe(false);
  expect((await ui.state()).remote.state.identity.name).toBe('alice');
  await callback(link);
  await expect.poll(async () => (await ui.state()).remote.state.error).toContain('GitHub sign-in could not complete');
  expect(JSON.parse(readFileSync(settings, 'utf8')).remote_connection).toEqual(saved);
  expect(errors).toEqual([]);
  writeFileSync(resolve(output, 'result.json'), JSON.stringify({ result: 'passed', provider: 'local OAuth fixture', cases: ['browser sign-in continuation', 'consent', 'fixed deeplink', 'PKCE exchange', 'nonce mismatch', 'encrypted persistence', 'restart', 'cancel preserves connection', 'replay does not replace connection', 'light/dark/narrow'] }, null, 2));
  succeeded = true;
} finally {
  if (app) await app.close(); if (browser) await browser.close();
  writeFileSync(metadata + '.stop', 'stop');
  const code = await finished;
  rmSync(scratch, { recursive: true, force: true });
  if (code !== 0) throw new Error(`Desktop sign-in fixture failed: ${logs}`);
}
console.log('Desktop browser sign-in acceptance passed');

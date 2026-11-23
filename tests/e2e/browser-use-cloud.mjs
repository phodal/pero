// Run via TestCloudBrowserFollowsClaimAndRuntimeChannel, which owns the
// temporary PostgreSQL binding, HTTP Gateway and projected Pod fixture.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { expect } from '@playwright/test';
import { electron } from './electron.mjs';

const { PERO_TEST_CLOUD_BROWSER_ORIGIN: origin, PERO_TEST_CLOUD_BROWSER_CLIENT: client,
  PERO_TEST_CLOUD_BROWSER_POD: pod, PERO_TEST_CLOUD_BROWSER_RUN: runId,
  PERO_TEST_CLOUD_BROWSER_TASK: taskId } = process.env;
assert(origin && new URL(origin).hostname === '127.0.0.1' && client && pod && runId && taskId,
  'Start the isolated Browser Use Go test fixture.');
const root = resolve(import.meta.dirname, '../..');
const temp = await mkdtemp(resolve(tmpdir(), 'pero-cloud-browser-'));
const output = resolve(root, 'test-results/browser-use-cloud');
await mkdir(output, { recursive: true });
const effects = [];
const site = createServer((request, response) => {
  if (request.url === '/effect') { effects.push(request.url); response.writeHead(204).end(); return; }
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.end(`<!doctype html><title>Cloud Browser fixture</title><button>Mark fixture</button>
    <p data-testid="effect">Waiting</p><script>
    document.querySelector('button').onclick = event => {
      if (!event.isTrusted) return;
      document.querySelector('p').textContent = 'Trusted Cloud click';
      fetch('/effect');
    };
    </script>`);
});
await new Promise(done => site.listen(0, '127.0.0.1', done));
const url = `http://127.0.0.1:${site.address().port}/`;
const call = async args => {
  const endpoint = new URL(`/api/runtime/v1/runs/${runId}/browser/call`, origin);
  endpoint.searchParams.set('session_id', runId);
  const response = await fetch(endpoint, { method: 'POST', signal: AbortSignal.timeout(5000),
    headers: { Authorization: `Bearer ${pod}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
  const text = await response.text();
  return { status: response.status, value: response.ok ? JSON.parse(text) : text };
};
let app;
try {
  app = await electron.launch({ args: ['--use-mock-keychain', resolve(root, 'desktop')], cwd: root, env: {
    PATH: process.env.PATH, HOME: process.env.HOME, PERO_LOCALE: 'en',
    PERO_CLOUD_URL: origin, PERO_CLIENT_TOKEN: client, PERO_DESKTOP_DATA_DIR: resolve(temp, 'desktop'),
    PERO_SETTINGS_PATH: resolve(temp, 'settings.json'), PERO_HISTORY_PATH: resolve(temp, 'history.jsonl'),
  } });
  const page = await app.firstWindow();
  await page.waitForFunction(() => window.peroDiagnostics && JSON.parse(window.peroDiagnostics.snapshot()).connected && !document.getElementById('loading'));
  const state = () => page.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()));
  const menu = id => app.evaluate(({ Menu, BrowserWindow }, id) => {
    Menu.getApplicationMenu().getMenuItemById(id).click(undefined, BrowserWindow.getAllWindows()[0]);
  }, id);
  await menu('remote-tasks');
  await page.evaluate(task_id => window.pero.remoteCommand({ action: 'remote_select', task_id }), taskId);
  await expect.poll(async () => (await state()).remote.state.detail?.run?.id, { timeout: 15000 }).toBe(runId);
  await page.evaluate(url => window.pero.webCommand({ action: 'web_open', url }), url);
  await expect.poll(async () => (await state()).webDocuments.find(item => item.id === url)?.observation.load.kind).toBe('ready');

  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async (_window, options) => {
      globalThis.cloudBrowserDialog = options;
      return { response: options.type === 'question' && globalThis.cloudBrowserApproved ? 1 : 0 };
    };
  });
  await menu('browser-use-cloud-share');
  const consent = () => app.evaluate(() => globalThis.cloudBrowserDialog);
  await expect.poll(async () => {
    const dialog = await consent();
    assert(dialog?.type !== 'info', dialog?.detail);
    return dialog?.type;
  }).toBe('question');
  assert.match((await consent()).detail, /Browser fixture/);
  assert((await consent()).detail.includes(origin) && (await consent()).detail.includes(new URL(url).origin));
  assert.equal((await call({ action: 'status' })).status, 409);
  await app.evaluate(() => { globalThis.cloudBrowserApproved = true; });
  await menu('browser-use-cloud-share');
  await expect.poll(async () => {
    const result = await call({ action: 'status' });
    return result.status === 200 && result.value.authorized;
  }, { timeout: 10000 }).toBe(true);
  for (const blocked of [{ action: 'open', url }, { action: 'files' }, { action: 'observe', tabId: 'other-tab' }])
    assert.equal((await call(blocked)).value.kind, 'error');
  const match = await call({ action: 'locate', locator: { by: 'role', role: 'button', name: 'Mark fixture' } });
  assert.equal(match.value.kind, 'observation', JSON.stringify(match.value));
  const ref = match.value.nodes.find(node => node.name === 'Mark fixture')?.ref;
  assert(ref, JSON.stringify(match.value));
  const click = (await call({ action: 'click', ref })).value;
  assert.equal(click.outcome, 'dispatched', JSON.stringify(click));
  await expect.poll(() => effects).toEqual(['/effect']);
  const result = (await call({ action: 'observe' })).value;
  assert(JSON.stringify(result).includes('Trusted Cloud click'));
  await page.screenshot({ path: resolve(output, 'embedded-cloud-share.png') });
  const captured = await app.evaluate(async ({ webContents }, address) => {
    const page = webContents.getAllWebContents().find(contents => contents.getURL() === address);
    return (await page.capturePage(undefined, { stayHidden: true })).toPNG().toString('base64');
  }, url);
  await writeFile(resolve(output, 'embedded-cloud-page.png'), Buffer.from(captured, 'base64'));

  await menu('browser-use-cloud-stop');
  await expect.poll(async () => (await call({ action: 'status' })).status).toBe(409);
  assert.deepEqual(effects, ['/effect']);
  await writeFile(resolve(output, 'result.json'), JSON.stringify({
    declined: true, granted: true, blockedOtherTabAndFiles: true, effects, click, revoked: true,
  }, null, 2));
  console.log('Electron Browser Use completed one trusted click through the real Cloud Runtime Gateway.');
} finally {
  await app?.close();
  site.close();
  await rm(temp, { recursive: true, force: true });
}

import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { test } from 'node:test';
import { chromium, expect } from '@playwright/test';

// Match the Workbench App sandbox: scripts and same-origin I/O, no native dialogs.
test('Notebook deletion confirms inside the App sandbox and survives reload', { timeout: 60_000 }, async t => {
  const app = resolve(import.meta.dirname, '..');
  const directory = await mkdtemp(resolve(tmpdir(), 'pero-notebook-delete-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const backend = spawn(process.env.PYTHON || 'python3', [resolve(app, 'backend/server.py')], {
    env: { ...process.env, PERO_APP_DATA: directory, PERO_APP_TOKEN: 'delete-fixture', PYTHONDONTWRITEBYTECODE: '1' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  t.after(async () => {
    if (backend.exitCode === null) { const stopped = once(backend, 'exit'); backend.kill(); await stopped; }
  });
  const lines = createInterface({ input: backend.stdout });
  const [ready] = await once(lines, 'line', { signal: AbortSignal.timeout(10_000) });
  lines.close();
  const { port } = JSON.parse(ready);
  const api = (path, init) => fetch(`http://127.0.0.1:${port}${path}`, {
    ...init, headers: { 'Content-Type': 'application/json', 'X-Pero-App-Token': 'delete-fixture' },
  });
  const entries = [];
  for (const title of ['Retained notebook', 'Selected notebook', 'Other notebook']) {
    const response = await api('/api/entries', { method: 'POST', body: JSON.stringify({ title }) });
    assert.equal(response.status, 201);
    entries.push(await response.json());
  }
  const files = new Map(await Promise.all([
    ['/', 'index.html', 'text/html'], ['/index.js', 'index.js', 'text/javascript'], ['/index.css', 'index.css', 'text/css'],
  ].map(async ([path, name, type]) => [path, { body: await readFile(resolve(app, 'dist', name)), type }])));
  const server = createServer(async (request, response) => {
    const file = files.get(request.url);
    if (file) return response.writeHead(200, {
      'Content-Type': file.type + '; charset=utf-8',
      'Content-Security-Policy': "sandbox allow-scripts allow-same-origin allow-downloads allow-popups; default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:",
    }).end(file.body);
    if (request.url === '/host/sdk') return response.writeHead(200, { 'Content-Type': 'application/json' }).end('{}');
    if (!request.url?.startsWith('/api/')) return response.writeHead(404).end();
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const result = await api(request.url, { method: request.method, ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) });
    response.writeHead(result.status, { 'Content-Type': 'application/json' }).end(await result.text());
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(done => { server.close(done); server.closeAllConnections(); }));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PERO_CHROMIUM_EXECUTABLE });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [], nativeDialogs = [], deletions = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => { nativeDialogs.push(dialog.type()); void dialog.dismiss(); });
  page.on('request', request => { if (request.method() === 'DELETE') deletions.push(request.url()); });
  await page.goto(origin);
  const rows = page.locator('.notebook-list li');
  const title = page.getByRole('textbox', { name: 'Notebook title', exact: true });
  await rows.filter({ hasText: 'Selected notebook' }).locator('.pero-list-open').click();
  await expect(title).toHaveValue('Selected notebook');
  const openDelete = async name => {
    await rows.filter({ hasText: name }).getByRole('button', { name: 'Notebook actions', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Delete notebook', exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(name);
    await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
    return dialog;
  };
  let dialog = await openDelete('Selected notebook');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  assert.deepEqual(deletions, []);
  dialog = await openDelete('Selected notebook');
  await dialog.press('Escape');
  await expect(dialog).toHaveCount(0);
  assert.deepEqual(deletions, []);

  // Failure retains the target and current editor, with an explicit retry.
  const selectedPath = `/api/entries/${entries[1].id}`;
  await page.route('**' + selectedPath, route => route.request().method() === 'DELETE'
    ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: 'Deletion temporarily unavailable' }) })
    : route.continue());
  dialog = await openDelete('Selected notebook');
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(dialog).toContainText('Deletion temporarily unavailable');
  await expect(rows).toHaveCount(3);
  await expect(title).toHaveValue('Selected notebook');
  await page.unroute('**' + selectedPath);
  const output = resolve(app, '../../test-results/notebook'); await mkdir(output, { recursive: true });
  await page.screenshot({ path: resolve(output, 'delete-failure-light.png') });
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(rows).toHaveCount(2);
  await expect(title).not.toHaveValue('Selected notebook');
  assert.equal((await api(selectedPath)).status, 404);

  await rows.filter({ hasText: 'Retained notebook' }).locator('.pero-list-open').click();
  await expect(title).toHaveValue('Retained notebook');
  dialog = await openDelete('Other notebook');
  await page.screenshot({ path: resolve(output, 'delete-confirm-light.png') });
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(rows).toHaveCount(1);
  await expect(title).toHaveValue('Retained notebook');
  await page.reload();
  await expect(rows).toHaveCount(1);
  await expect(title).toHaveValue('Retained notebook');
  dialog = await openDelete('Retained notebook');
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(rows).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'New notebook', exact: true })).toBeVisible();
  await page.reload();
  await expect(rows).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'New notebook', exact: true })).toBeVisible();
  assert.deepEqual((await (await api('/api/entries')).json()).entries, []);
  assert.deepEqual(nativeDialogs, []);
  assert.deepEqual(errors, []);
});

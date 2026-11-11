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

const app = resolve(import.meta.dirname, '..');
const root = resolve(app, '../..');
const token = 'ipynb-browser';
const output = resolve(root, 'test-results/notebook');
test('IPYNB imports, edits, persists and exports exact retained recorded data', { timeout: 120_000 }, async t => {
  const directory = await mkdtemp(resolve(tmpdir(), 'pero-ipynb-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const files = new Map(await Promise.all([
    ['/', 'index.html', 'text/html'], ['/index.js', 'index.js', 'text/javascript'], ['/index.css', 'index.css', 'text/css'],
    ['/source-evidence.json', 'source-evidence.json', 'application/json'],
  ].map(async ([path, name, type]) => [path, { body: await readFile(resolve(app, 'dist', name)), type }])));
  const backend = spawn(process.env.PYTHON || 'python3', [resolve(app, 'backend/server.py')], {
    env: { ...process.env, PERO_APP_DATA: directory, PERO_APP_TOKEN: token, PYTHONDONTWRITEBYTECODE: '1' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  t.after(async () => { if (backend.exitCode === null) { const stopped = once(backend, 'exit'); backend.kill(); await stopped; } });
  const lines = createInterface({ input: backend.stdout });
  const [ready] = await once(lines, 'line', { signal: AbortSignal.timeout(10_000) });
  lines.close();
  const { port } = JSON.parse(ready);
  const server = createServer(async (request, response) => {
    const file = files.get(request.url);
    if (file) {
      response.writeHead(200, { 'Content-Type': `${file.type}; charset=utf-8`, 'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:" });
      return response.end(file.body);
    }
    if (request.url === '/host/sdk') return response.writeHead(200, { 'Content-Type': 'application/json' }).end('{}');
    if (!request.url?.startsWith('/api/')) return response.writeHead(404).end();
    try {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const result = await fetch(`http://127.0.0.1:${port}${request.url}`, {
        method: request.method, headers: { 'Content-Type': 'application/json', 'X-Pero-App-Token': token },
        ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
      });
      response.writeHead(result.status, { 'Content-Type': 'application/json' }).end(await result.text());
    } catch (error) { response.writeHead(502).end(String(error)); }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(done => { server.close(done); server.closeAllConnections?.(); }));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const api = async (path, init) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/${path}`, {
      ...init, headers: { 'Content-Type': 'application/json', 'X-Pero-App-Token': token },
    });
    assert.ok(response.ok, await response.clone().text());
    return response.json();
  };
  const entry = await api('entries', { method: 'POST', body: JSON.stringify({ document: {
    schemaVersion: 1, title: 'MyST browser publication', content: { type: 'doc', content: [
      { type: 'paragraph', attrs: { blockId: 'intro' }, content: [{ type: 'text', text: 'Existing notebook text stays.' }] },
    ] },
  } }) });
  const browser = await chromium.launch({ executablePath: process.env.PERO_CHROMIUM_EXECUTABLE, headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [], externalRequests = [];
  page.on('pageerror', error => errors.push(error.message));
  // Record attempted outbound traffic as a failure, but never actually send it.
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (['http:', 'https:'].includes(url.protocol) && url.origin !== origin) {
      externalRequests.push(url.href);
      return route.abort();
    }
    return route.continue();
  });
  t.after(async () => {
    try {
      await mkdir(output, { recursive: true });
      await page.screenshot({ path: resolve(output, 'ipynb-document.png'), fullPage: true });
    } finally { await browser.close(); }
  });
  await page.goto(`${origin}/#notebook-entry=${entry.id}`);
  const english = () => page.evaluate(() => window.postMessage({ type: 'pero:app:context', context: { locale: 'en', dark: false, active: true } }, location.origin));
  await english();
  const source = await readFile(resolve(root, 'packages/notebook/test/fixtures/ipynb-contract.json'), 'utf8');
  await page.locator('input[type="file"][accept*=".ipynb"]').setInputFiles({name:'science.ipynb',mimeType:'application/x-ipynb+json',buffer:Buffer.from(source)});
  const input = page.getByRole('textbox',{name:'Cell 2: code',exact:true});
  await expect(input).toHaveValue('print("界")\r\n');
  await input.fill('print("edited")');
  const iframe = page.getByTitle('Notebook publication preview',{exact:true});
  await expect(iframe).toHaveAttribute('sandbox','');
  const preview=page.frameLocator('iframe[title="Notebook publication preview"]');
  await expect(preview.locator('math')).toHaveCount(1);
  await expect(preview.getByText(/Stale recorded outputs/)).toHaveCount(1);
  await expect(preview.locator('script,iframe,object')).toHaveCount(0);
  await page.getByRole('button',{name:'Save revision',exact:true}).click();
  await expect(page.locator('.notebook-status')).toContainText('Revision 2');
  const saved=await api(`entries/${entry.id}`);
  const block=saved.document.content.content.find(node=>node.type==='ipynbDocument');
  const raw=JSON.parse(block.attrs.source),original=JSON.parse(source);
  assert.deepEqual(raw.cells[1].outputs,original.cells[1].outputs);
  assert.deepEqual(raw.cells[0],original.cells[0]);
  assert.equal(raw.cells[1].metadata['pero.outputsStale'],true);
  assert.equal(raw.cells[1].execution_count,7);
  await page.reload();await english();await expect(input).toHaveValue('print("edited")');
  const pending=page.waitForEvent('download');
  await page.getByRole('button',{name:'Download original .ipynb',exact:true}).click();
  const download=await pending;assert.equal(download.suggestedFilename(),'notebook.ipynb');
  const destination=resolve(directory,'notebook.ipynb');await download.saveAs(destination);
  assert.equal(await readFile(destination,'utf8'),block.attrs.source);
  assert.deepEqual(externalRequests,[]);assert.deepEqual(errors,[]);
});

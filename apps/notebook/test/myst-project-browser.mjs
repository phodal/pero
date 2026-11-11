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
const token = 'myst-project-browser';
const output = resolve(root, 'test-results/notebook');
test('MyST project imports, resolves, edits, persists and roundtrips explicit resources', { timeout: 120_000 }, async t => {
  const directory = await mkdtemp(resolve(tmpdir(), 'pero-myst-project-'));
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
      await page.screenshot({ path: resolve(output, 'myst-project-publication.png'), fullPage: true });
    } finally { await browser.close(); }
  });
  await page.goto(`${origin}/#notebook-entry=${entry.id}`);
  const english = () => page.evaluate(() => window.postMessage({ type: 'pero:app:context', context: { locale: 'en', dark: false, active: true } }, location.origin));
  await english();
  const project = { format: 'pero-myst-project', version: 1, entry: 'pages/article.md', files: [
    { path: 'myst.yml', text: 'version: 1\nproject:\n  title: Project title is not the page title\n  authors:\n    - name: Project Researcher\n  bibliography: references.bib\n  plugins:\n    - https://myst-resource.invalid/plugin.js\n' },
    { path: 'pages/article.md', text: '---\ntitle: Project article\n---\n# Findings\n\nSee @Study.\n\n```{include} ../notes.md\n```\n\n![Remote](https://myst-resource.invalid/figure.png)\n\n<script>globalThis.mystExecuted = true</script>\n' },
    { path: 'references.bib', text: '@article{Study, title={Original citation}, author={Doe, Jane}, year={2024}}' },
    { path: 'notes.md', text: '# Inert included text\nThis must not become page content.' },
  ] };
  const picker = page.locator('input[type="file"][accept*=".myst-project.json"]');
  await picker.setInputFiles({ name: 'research.myst-project.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
  const editor = page.getByRole('textbox', { name: 'MyST resource source', exact: true });
  await expect(editor).toHaveValue(project.files[1].text);
  await expect(page.locator('.notebook-prose')).toContainText('Existing notebook text stays.');
  const iframe = page.getByTitle('MyST project preview', { exact: true });
  await expect(iframe).toHaveAttribute('sandbox', '');
  const preview = page.frameLocator('iframe[title="MyST project preview"]');
  await expect(preview.getByRole('heading', { name: 'Project article', exact: true })).toBeVisible();
  await expect(preview.getByRole('list', { name: 'Authors', exact: true })).toContainText('Project Researcher');
  await expect(preview.locator('body')).toContainText('Original citation');
  await expect(preview.locator('body')).not.toContainText('This must not become page content.');
  await expect(preview.locator('script, img, iframe, object')).toHaveCount(0);
  await page.getByRole('button', { name: 'Project resource', exact: true }).click();
  await page.getByRole('option', { name: 'references.bib', exact: true }).click();
  const revised = '@article{Study, title={Revised citation}, author={{Example Institute}}, year={2025}}';
  await editor.fill(revised);
  await expect(preview.locator('body')).toContainText('Revised citation');
  await expect(preview.locator('body')).toContainText('Example Institute');
  project.files[2].text = revised;
  await page.getByRole('button', { name: 'Save revision', exact: true }).click();
  await expect(page.locator('.notebook-status')).toContainText('Revision 2');
  const saved = await api(`entries/${entry.id}`);
  const block = saved.document.content.content.find(node => node.type === 'mystProject');
  assert.deepEqual(JSON.parse(block.attrs.snapshot), project);
  assert.equal(saved.document.content.content.filter(node => node.type === 'mystProject').length, 1);
  await page.reload(); await english();
  await expect(editor).toHaveValue(project.files[1].text);
  await expect(preview.locator('body')).toContainText('Revised citation');
  const downloadText = async (label, filename) => {
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: label, exact: true }).click();
    const download = await pending;
    assert.equal(download.suggestedFilename(), filename);
    const destination = resolve(directory, filename);
    await download.saveAs(destination);
    return readFile(destination, 'utf8');
  };
  const roundtrip = await downloadText('Download project snapshot', 'project.myst-project.json');
  assert.deepEqual(JSON.parse(roundtrip), project);
  const html = await downloadText('Download entry HTML', 'project.html');
  assert.match(html, /Revised citation/);
  assert.match(html, /default-src 'none'/);
  assert.doesNotMatch(html, /<script[ >]|<img[ >]/i);
  await mkdir(output, { recursive: true });
  await page.getByRole('button', { name: 'Project resource', exact: true }).click();
  await page.getByRole('option', { name: 'references.bib', exact: true }).click();
  await editor.scrollIntoViewIfNeeded();
  await page.screenshot({ path: resolve(output, 'myst-project-resource-editor.png'), fullPage: true });
  await iframe.scrollIntoViewIfNeeded();
  await iframe.screenshot({ path: resolve(output, 'myst-project-entry-preview.png') });
  await picker.setInputFiles({ name: 'roundtrip.myst-project.json', mimeType: 'application/json', buffer: Buffer.from(roundtrip) });
  await expect(page.getByTitle('MyST project preview', { exact: true })).toHaveCount(2);
  await page.getByRole('button', { name: 'Save revision', exact: true }).click();
  await expect(page.locator('.notebook-status')).toContainText('Revision 3');
  const resaved = await api(`entries/${entry.id}`);
  const copies = resaved.document.content.content.filter(node => node.type === 'mystProject');
  assert.equal(copies.length, 2);
  assert.notEqual(copies[0].attrs.blockId, copies[1].attrs.blockId);
  assert.deepEqual(JSON.parse(copies[1].attrs.snapshot), project);
  // Emulate a snapshot written by a newer app at the read boundary. The current
  // backend correctly refuses to persist unknown versions, so no invalid write
  // is used to manufacture this recovery case.
  const futureSnapshot = JSON.stringify({ ...project, version: 2 });
  await page.route(`**/api/entries/${entry.id}`, async route => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    const body = await response.json();
    body.document.content.content = [{ type: 'mystProject', attrs: { ...block.attrs, snapshot: futureSnapshot } }];
    await route.fulfill({ response, json: body });
  });
  await page.reload(); await english();
  const recovery = page.getByRole('textbox', { name: 'MyST project snapshot', exact: true });
  await expect(recovery).toHaveValue(futureSnapshot);
  await expect(recovery).toHaveAttribute('readonly', '');
  await expect(page.getByTitle('MyST project preview', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Download entry HTML', exact: true })).toBeDisabled();
  const recovered = await downloadText('Download project snapshot', 'project.myst-project.json');
  assert.equal(recovered, futureSnapshot);
  assert.deepEqual(externalRequests, []);
  assert.deepEqual(errors, []);
  assert.equal(await page.evaluate(() => globalThis.mystExecuted), undefined);
});

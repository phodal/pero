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
const token = 'myst-document-browser';
const output = resolve(root, 'test-results/notebook');
test('MyST imports, edits, persists and exports an inert scientific publication', { timeout: 120_000 }, async t => {
  const directory = await mkdtemp(resolve(tmpdir(), 'pero-myst-document-'));
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
      await page.screenshot({ path: resolve(output, 'myst-document-publication.png'), fullPage: true });
    } finally { await browser.close(); }
  });
  await page.goto(`${origin}/#notebook-entry=${entry.id}`);
  const english = () => page.evaluate(() => window.postMessage({ type: 'pero:app:context', context: { locale: 'en', dark: false, active: true } }, location.origin));
  await english();
  const source = [
    '---', 'title: Scientific browser fixture',
    'authors:', '  - id: example-author', '    name: Example Researcher',
    '    orcid: 0000-0000-0000-0001', '    affiliations: [example-lab]',
    'affiliations:', '  - id: example-lab', '    name: Example Institute',
    'doi: 10.5555/example-myst-browser', 'license: CC-BY-4.0',
    'plugins:', '  - https://myst-resource.invalid/plugin.js', '---', '',
    '# Local science', '', 'Inline $x^2$ and **observations**.', '',
    '```{math}', ':label: eq-growth', 'N(t) = N_0 e^{rt}', '```', '',
    'See {eq}`eq-growth`.', '', '```{note}', 'Keep the control.', '```', '',
    '| Sample | Count |', '| --- | --- |', '| A | 42 |', '',
    '![Remote image](https://myst-resource.invalid/figure.png)', '',
    '```{include} https://myst-resource.invalid/include.md', '```', '',
    '```{code-cell} javascript', 'globalThis.mystExecuted = true;', '```', '',
    '<script>globalThis.mystExecuted = true</script>', '',
    '<img src="https://myst-resource.invalid/raw.png" onerror="globalThis.mystExecuted = true">', '',
  ].join('\n');
  // The actual file input is deliberately hidden by the shared FilePicker.
  await page.locator('input[type="file"][accept=".md,.myst,.myst.json"]').setInputFiles({ name: 'science.myst', mimeType: 'text/plain', buffer: Buffer.from(source) });
  const editor = page.getByRole('textbox', { name: 'MyST source', exact: true });
  await expect(editor).toHaveValue(source);
  const sourceGeometry = await editor.evaluate(element => {
    const style = getComputedStyle(element);
    return { height: element.getBoundingClientRect().height, minHeight: parseFloat(style.minHeight),
      rootSize: parseFloat(getComputedStyle(document.documentElement).fontSize),
      lineHeight: parseFloat(style.lineHeight), fontFamily: style.fontFamily, resize: style.resize };
  });
  assert.ok(sourceGeometry.height >= 16 * sourceGeometry.rootSize, JSON.stringify(sourceGeometry));
  assert.ok(sourceGeometry.minHeight >= 16 * sourceGeometry.rootSize, JSON.stringify(sourceGeometry));
  assert.ok(sourceGeometry.height / sourceGeometry.lineHeight >= 10, JSON.stringify(sourceGeometry));
  assert.match(sourceGeometry.fontFamily, /mono/i);
  assert.equal(sourceGeometry.resize, 'vertical');
  await expect(page.locator('.notebook-prose')).toContainText('Existing notebook text stays.');
  const edited = source.replace('# Local science', '# Revised local science');
  await editor.fill(edited);
  const iframe = page.getByTitle('MyST preview', { exact: true });
  await expect(iframe).toHaveAttribute('sandbox', '');
  await expect(iframe).toHaveAttribute('referrerpolicy', 'no-referrer');
  const preview = page.frameLocator('iframe[title="MyST preview"]');
  await expect(preview.getByRole('heading', { name: 'Revised local science', exact: true })).toBeVisible();
  await expect(preview.getByRole('heading', { name: 'Scientific browser fixture', exact: true })).toHaveCount(1);
  await expect(preview.getByRole('list', { name: 'Authors', exact: true })).toContainText('Example Researcher');
  await expect(preview.locator('.byline a[href="#publication-affiliation-1"]')).toHaveCount(1);
  await expect(preview.locator('#publication-affiliation-1')).toHaveText('Example Institute');
  await expect(preview.locator('a[href="https://orcid.org/0000-0000-0000-0001"]')).toHaveCount(1);
  await expect(preview.locator('a[href="https://doi.org/10.5555/example-myst-browser"]')).toHaveCount(1);
  await expect(preview.locator('a[href="https://creativecommons.org/licenses/by/4.0/"]')).toHaveCount(1);
  await expect(preview.locator('math')).toHaveCount(2);
  await expect(preview.getByRole('cell', { name: '42', exact: true })).toBeVisible();
  await expect(preview.getByText('Keep the control.', { exact: true })).toBeVisible();
  await expect(preview.locator('a[href="#myst-eq-growth"]')).toHaveCount(1);
  await expect(preview.locator('script, img, iframe, object')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'MyST diagnostics', exact: true })).toContainText('Document plugins are not loaded');
  assert.equal(await page.evaluate(() => globalThis.mystExecuted), undefined);

  await page.getByRole('button', { name: 'Save revision', exact: true }).click();
  await expect(page.locator('.notebook-status')).toContainText('Revision 2');
  const saved = await api(`entries/${entry.id}`);
  const block = saved.document.content.content.find(node => node.type === 'mystDocument');
  assert.equal(block.attrs.source, edited);
  assert.equal(block.attrs.schemaVersion, 1);
  assert.equal(saved.document.content.content.filter(node => node.type === 'mystDocument').length, 1);
  await page.reload();
  await english();
  await expect(editor).toHaveValue(edited);
  await expect(preview.getByRole('heading', { name: 'Revised local science', exact: true })).toBeVisible();

  for (const [button, name] of [['Download source', 'document.myst'], ['Download MyST bundle', 'document.myst.json'], ['Download HTML', 'document.html']]) {
    const downloaded = page.waitForEvent('download');
    await page.getByRole('button', { name: button, exact: true }).click();
    const download = await downloaded;
    assert.equal(download.suggestedFilename(), name);
    const destination = resolve(directory, name);
    await download.saveAs(destination);
    const text = await readFile(destination, 'utf8');
    if (name === 'document.myst') assert.equal(text, edited);
    else if (name.endsWith('.json')) {
      assert.equal(JSON.parse(text).format, 'pero-myst');
      assert.equal(JSON.parse(text).source, edited);
    } else {
      assert.match(text, /Content-Security-Policy/);
      assert.match(text, /default-src 'none'/);
      assert.match(text, /<math[ >]/);
      assert.match(text, /Revised local science/);
      assert.doesNotMatch(text, /<script[ >]|<img[ >]/i);
    }
  }
  await mkdir(output, { recursive: true });
  await editor.scrollIntoViewIfNeeded();
  await page.screenshot({ path: resolve(output, 'myst-document-source.png'), fullPage: true });
  await iframe.scrollIntoViewIfNeeded();
  await iframe.screenshot({ path: resolve(output, 'myst-document-preview.png') });
  console.log(`MyST source geometry: ${JSON.stringify(sourceGeometry)}`);
  assert.deepEqual(externalRequests, []);
  assert.deepEqual(errors, []);
});

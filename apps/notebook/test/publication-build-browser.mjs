import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { test } from 'node:test';
import { chromium, expect } from '@playwright/test';

// Explicit local-toolchain acceptance; no network, model, package installation or
// scientific acceptance. Run after building Notebook with the selected Python.
test('real figure → saved manuscript → PDF → revised panel → retained failure and old preview', {
  skip: process.env.NOTEBOOK_REAL_PUBLICATION !== '1', timeout: 180_000,
}, async t => {
  const app = resolve(import.meta.dirname, '..'), root = resolve(app, '../..');
  const directory = await mkdtemp(resolve(tmpdir(), 'pero-publication-browser-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const python = process.env.PYTHON || 'python3';
  const generate = (version, extra = [], script = resolve(app, 'examples/publication/generate_figure.py')) => {
    const result = spawnSync(python, [script, '--output', resolve(directory, version), ...extra], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  };
  generate('v1');
  const firstRaw = await readFile(resolve(directory, 'v1/fisher.myst-project.json'), 'utf8');
  const data = await readFile(resolve(directory, 'v1/data/fisher_table1.csv'), 'utf8');
  await writeFile(resolve(directory, 'edited.csv'), data.replace('setosa,1,5.1', 'setosa,1,5.2'));
  generate('v2', ['--data', resolve(directory, 'edited.csv'), '--panel-b-title', 'Revised dispersion panel'], resolve(directory, 'v1/code/figure.py'));
  const secondRaw = await readFile(resolve(directory, 'v2/fisher.myst-project.json'), 'utf8');
  const token = 'publication-browser';
  const backend = spawn(python, [resolve(app, 'backend/server.py')], {
    env: { ...process.env, PERO_APP_DATA: resolve(directory, 'store'), PERO_APP_TOKEN: token, PYTHONDONTWRITEBYTECODE: '1' },
    cwd: root, stdio: ['ignore', 'pipe', 'inherit'],
  });
  t.after(async () => { if (backend.exitCode === null) { const stopped = once(backend, 'exit'); backend.kill(); await stopped; } });
  const lines = createInterface({ input: backend.stdout });
  const [ready] = await once(lines, 'line', { signal: AbortSignal.timeout(10_000) }); lines.close();
  const { port } = JSON.parse(ready);
  const api = async (path, init) => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, { ...init, headers: { 'Content-Type': 'application/json', 'X-Pero-App-Token': token } });
    assert.ok(response.ok, await response.clone().text()); return response.json();
  };
  const document = raw => ({ schemaVersion: 1, title: 'Fisher publication workflow', content: { type: 'doc', content: [
    { type: 'mystProject', attrs: { blockId: 'manuscript', schemaVersion: 1, snapshot: raw } },
  ] } });
  const entry = await api('/api/entries', { method: 'POST', body: JSON.stringify({ document: document(firstRaw) }) });
  const files = new Map(await Promise.all([
    ['/', 'index.html', 'text/html'], ['/index.js', 'index.js', 'text/javascript'], ['/index.css', 'index.css', 'text/css'],
    ['/source-evidence.json', 'source-evidence.json', 'application/json'],
    ...(await readdir(resolve(app, 'dist'))).filter(name => name.endsWith('.wasm')).map(name => [`/${name}`, name, 'application/wasm']),
  ].map(async ([path, name, type]) => [path, { body: await readFile(resolve(app, 'dist', name)), type }])));
  const server = createServer(async (request, response) => {
    const file = files.get(request.url);
    if (file) return response.writeHead(200, { 'Content-Type': file.type, 'Content-Security-Policy': "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; object-src 'none'" }).end(file.body);
    if (request.url === '/host/sdk') return response.writeHead(200, { 'Content-Type': 'application/json' }).end('{}');
    if (!request.url?.startsWith('/api/')) return response.writeHead(404).end();
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const result = await api(request.url, { method: request.method, ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) });
    response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(result));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(done => { server.close(done); server.closeAllConnections(); }));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PERO_CHROMIUM_EXECUTABLE });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const errors = [], external = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (['http:', 'https:'].includes(url.protocol) && url.origin !== origin) { external.push(url.href); return route.abort(); }
    return route.continue();
  });
  const english = dark => page.evaluate(dark => window.postMessage({ type: 'pero:app:context', context: { locale: 'en', dark, active: true } }, location.origin), dark);
  const panel = page.getByRole('region', { name: 'Publication builds', exact: true });
  const compile = panel.getByRole('button', { name: 'Compile saved revision to PDF', exact: true });
  const builds = () => api(`/api/entries/${entry.id}/publication-builds?blockId=manuscript`);
  const output = resolve(root, 'test-results/notebook-publication'); await mkdir(output, { recursive: true });
  await page.goto(`${origin}/#notebook-entry=${entry.id}`); await english(false);
  await expect(compile).toBeEnabled();
  await expect(panel).toContainText('Figure, code and data hashes match');
  const preview = page.frameLocator('iframe[title="MyST project preview"]');
  await expect(preview.locator('body')).toContainText('Figure 1');
  await compile.click();
  await expect(panel.getByRole('img', { name: /Compiled PDF preview/ })).toBeVisible({ timeout: 60_000 });
  const first = (await builds()).builds[0]; assert.equal(first.status, 'succeeded');
  await panel.screenshot({ path: resolve(output, 'compiled-v1-light.png') });
  await panel.getByRole('img', { name: /Compiled PDF preview/ }).evaluate(node => node.scrollIntoView({ block: 'center' }));
  await page.screenshot({ path: resolve(output, 'pdf-v1-light.png') });
  // Panel provenance returns directly to its actual plotting function.
  await panel.getByRole('button', { name: /Edit code\/figure.py.*panel_dispersion/ }).click();
  const editor = page.getByRole('textbox', { name: 'MyST resource source', exact: true });
  await expect(editor).toBeFocused();
  assert.match(await editor.evaluate(node => node.value.slice(node.selectionStart, node.selectionEnd)), /def panel_dispersion/);
  await panel.getByRole('button', { name: 'Edit data/fisher_table1.csv', exact: true }).first().click();
  await editor.fill(data.replace('setosa,1,5.1', 'setosa,1,5.2'));
  await expect(panel).toContainText('data/fisher_table1.csv changed. Regenerate');
  await expect(compile).toBeDisabled();
  await expect(panel.getByRole('img', { name: /Compiled PDF preview/ })).toBeVisible();
  // Actual external generator produces a new frozen figure/input revision. Save
  // via the existing Entry owner rather than inventing an execution authority.
  await page.getByRole('button', { name: 'Update from regenerated project', exact: true }).locator('..').locator('input[type="file"]').setInputFiles({ name: 'fisher.myst-project.json', mimeType: 'application/json', buffer: Buffer.from(secondRaw) });
  await expect(editor).toHaveValue(JSON.parse(secondRaw).files[0].text);
  await page.locator('button.notebook-save').click();
  await expect(compile).toBeEnabled(); await compile.click();
  await expect(panel.getByRole('img', { name: /Compiled PDF preview · r2/ })).toBeVisible({ timeout: 60_000 });
  const second = (await builds()).builds[0]; assert.equal(second.status, 'succeeded');
  assert.equal(second.revision, 2); assert.notEqual(first.pdfSha256, second.pdfSha256);
  // Use the real source editor and existing save owner to produce a bad build.
  await panel.getByRole('button', { name: 'Edit article.md', exact: true }).click();
  await editor.fill(JSON.parse(secondRaw).files[0].text + '\n\n$$\nx_{\n$$\n');
  await page.locator('button.notebook-save').click();
  await expect(compile).toBeEnabled(); await compile.click();
  await expect(panel.getByText('Compilation failed', { exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(editor).toHaveValue(/x_\{/);
  await expect(panel.getByRole('button', { name: 'Open last compiled PDF', exact: true })).toBeVisible();
  await panel.screenshot({ path: resolve(output, 'failed-build-retains-source.png') });
  const failures = (await builds()).builds; assert.equal(failures[0].status, 'failed');
  assert.ok(failures[0].diagnostics.some(item => item.path === 'article.tex' && item.line));
  const diagnostic = panel.getByRole('button', { name: /^article\.tex:\d+$/ }).first();
  const line = Number((await diagnostic.textContent()).split(':')[1]);
  await diagnostic.click();
  const generated = panel.getByRole('textbox', { name: 'Generated LaTeX', exact: true });
  await expect(generated).toBeFocused();
  assert.equal(await generated.evaluate(node => node.value.slice(node.selectionStart, node.selectionEnd)), (await generated.inputValue()).split('\n')[line - 1]);
  await panel.getByRole('button', { name: 'Open last compiled PDF', exact: true }).click();
  await expect(panel.getByRole('img', { name: /Compiled PDF preview · r2/ })).toBeVisible();
  await expect(panel).toContainText('This PDF and its diagnostics belong to revision 2');
  // Reopen v1 after newer data, code, source and failed builds exist.
  await panel.getByRole('button', { name: 'Build version', exact: true }).click();
  await page.getByRole('option', { name: new RegExp(first.id.slice(0, 8)) }).click();
  await expect(panel.getByRole('img', { name: /Compiled PDF preview · r1/ })).toBeVisible();
  const old = await api(`/api/entries/${entry.id}/publication-builds/${first.id}`);
  assert.deepEqual(JSON.parse(old.snapshot), JSON.parse(firstRaw)); assert.equal(old.build.pdfSha256, first.pdfSha256);
  // A delayed earlier history read must never replace a newer selection.
  let entered, release;
  const waiting = new Promise(done => { entered = done; }), held = new Promise(done => { release = done; });
  const failedPath = `**/publication-builds/${failures[0].id}`;
  await page.route(failedPath, async route => { entered(); await held; await route.continue(); });
  const chooseBuild = async id => {
    await panel.getByRole('button', { name: 'Build version', exact: true }).click();
    await page.getByRole('option', { name: new RegExp(id.slice(0, 8)) }).click();
  };
  await chooseBuild(failures[0].id); await waiting;
  await chooseBuild(second.id);
  await expect(panel.getByRole('img', { name: /Compiled PDF preview · r2/ })).toBeVisible();
  const response = page.waitForResponse(url => url.url().endsWith(`/publication-builds/${failures[0].id}`));
  release(); await (await response).finished();
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await expect(panel.getByRole('img', { name: /Compiled PDF preview · r2/ })).toBeVisible();
  await page.unroute(failedPath); await chooseBuild(first.id);
  await expect(panel.getByRole('img', { name: /Compiled PDF preview · r1/ })).toBeVisible();
  await panel.screenshot({ path: resolve(output, 'historical-v1-light.png') });
  await page.setViewportSize({ width: 480, height: 900 }); await english(true);
  await panel.getByRole('heading', { name: 'Publication builds', exact: true }).evaluate(node => node.scrollIntoView({ block: 'start' }));
  await page.screenshot({ path: resolve(output, 'historical-v1-narrow-dark.png') });
  await panel.getByRole('img', { name: /Compiled PDF preview/ }).evaluate(node => node.scrollIntoView({ block: 'center' }));
  await page.screenshot({ path: resolve(output, 'pdf-v1-narrow-dark.png') });
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  await writeFile(resolve(output, 'receipts.json'), JSON.stringify({ first, second, failed: failures[0], externalRequests: external, pageErrors: errors }, null, 2));
});

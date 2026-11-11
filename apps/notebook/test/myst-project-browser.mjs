import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
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
  for (const name of (await readdir(resolve(app, 'dist'))).filter(name => name.endsWith('.wasm'))) files.set(`/${name}`, { body: await readFile(resolve(app, 'dist', name)), type: 'application/wasm' });
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
      response.writeHead(200, { 'Content-Type': `${file.type}; charset=utf-8`, 'Content-Security-Policy': "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:" });
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
  const errors = [], externalRequests = [], wasmRequests = [];
  page.on('request', request => { const url = new URL(request.url()); if (url.origin === origin && url.pathname.endsWith('.wasm')) wasmRequests.push(url.href); });
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
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAEAAAAAgCAIAAAAt/+nTAAAATklEQVR4nO3PUQkAIBTAwBfHdOY0liH8OITBAtxm7fN1wwUNaEEDWtCAFjSgBQ1oQQNa0IAWNKAFDWhBA1rQgBY0oAUNaEEDWtCAFjx2AdM/8JeZhLHoAAAAAElFTkSuQmCC';
  const style = '<?xml version="1.0"?><style xmlns="http://purl.org/net/xbiblio/csl" version="1.0" class="in-text"><info><title>Browser Numeric Style</title><id>https://example.invalid/browser-style</id><updated>2024-01-01T00:00:00Z</updated></info><citation><layout prefix="[" suffix="]"><text variable="citation-number"/></layout></citation><bibliography><layout><text variable="title" font-style="italic"/></layout></bibliography></style>';
  const project = { format: 'pero-myst-project', version: 2, entry: 'pages/article.md', files: [
    { path: 'myst.yml', text: 'version: 1\nproject:\n  title: Project title is not the page title\n  authors:\n    - name: Project Researcher\n  bibliography: references.bib\n  pero:\n    citation:\n      style: styles/custom.csl\n      locale: en-US\n  plugins:\n    - https://myst-resource.invalid/plugin.js\n' },
    { path: 'pages/article.md', text: '---\ntitle: Project article\n---\n# Findings\n\nSee [@Study] and {ref}`../notes.md#note-label`.\n\n![Provided figure](../images/figure.png)\n\n```{include} ../notes.md\n```\n\n```{csv-table} Recorded measurements\n:file: ../data/results.csv\n:header-rows: 1\n```\n\n![Remote](https://myst-resource.invalid/figure.png)\n\n<script>globalThis.mystExecuted = true</script>\n' },
    { path: 'references.bib', text: '@article{Study, title={Original citation}, author={Doe, Jane}, year={2024}}' },
    { path: 'notes.md', text: '(note-label)=\n# Included findings\nThis becomes included page content.' },
    { path: 'data/results.csv', text: 'Sample,Value\n"Quoted, sample",42\n' },
    { path: 'experiment.ipynb', text: JSON.stringify({ nbformat: 4, nbformat_minor: 5, metadata: {}, cells: [{ id: 'result', cell_type: 'code', metadata: {}, source: 'print(42)', execution_count: 1, outputs: [{ output_type: 'stream', name: 'stdout', text: 'Recorded project result: 42' }] }] }) },
    { path: 'styles/custom.csl', text: style },
  ], assets: [{ path: 'images/figure.png', mediaType: 'image/png', base64: png }] };
  const picker = page.locator('input[type="file"][accept*=".myst-project.json"]');
  await picker.setInputFiles({ name: 'research.myst-project.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
  const editor = page.getByRole('textbox', { name: 'MyST resource source', exact: true });
  await expect(editor).toHaveValue(project.files[1].text);
  await expect(page.locator('.notebook-prose')).toContainText('Existing notebook text stays.');
  const iframe = page.getByTitle('MyST project preview', { exact: true });
  await expect(iframe).toHaveAttribute('sandbox', '');
  const preview = page.frameLocator('iframe[title="MyST project preview"]');
  await expect(preview.getByRole('heading', { name: 'Project article', exact: true })).toBeVisible();
  await expect(preview.getByRole('list', { name: 'Authors', exact: true }).first()).toContainText('Project Researcher');
  await expect(preview.locator('body')).toContainText('Original citation');
  await expect(preview.locator('body')).toContainText('Browser Numeric Style');
  await expect(preview.locator('body')).toContainText('refkit-js@0.4.0');
  await expect(preview.getByText('See [1] and', { exact: false })).toHaveCount(1);
  await expect(preview.locator('body')).toContainText('This becomes included page content.');
  await expect(preview.locator('script, iframe, object')).toHaveCount(0);
  await expect(preview.getByRole('img', { name: 'Provided figure' })).toHaveCount(1);
  await expect(preview.getByRole('img', { name: 'Provided figure' })).toHaveJSProperty('naturalWidth', 64);
  await expect(preview.getByRole('navigation', { name: 'Project pages' })).toBeVisible();
  const crossref = preview.getByRole('link', { name: 'Section 1', exact: true });
  await expect(crossref).toHaveAttribute('href', '#myst-notes~2e~md:note-label');
  await crossref.click();
  await expect(preview.locator('[id="myst-notes~2e~md:note-label"]')).toBeVisible();
  await expect(preview.locator('body')).toContainText('Recorded project result: 42');
  await expect(preview.getByRole('table')).toContainText('Quoted, sample');
  await expect(preview.getByRole('columnheader', { name: 'Sample' })).toBeVisible();
  await page.getByRole('button', { name: 'Project resource', exact: true }).click();
  await page.getByRole('option', { name: 'images/figure.png', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Binary resource' })).toContainText('64 × 32');
  const originalDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download original asset', exact: true }).click();
  const downloadedAsset = await originalDownload;
  const assetDestination = resolve(directory, 'figure.png');
  await downloadedAsset.saveAs(assetDestination);
  assert.deepEqual(await readFile(assetDestination), Buffer.from(png, 'base64'));
  await page.getByRole('button', { name: 'Project resource', exact: true }).click();
  await page.getByRole('option', { name: 'references.bib', exact: true }).click();
  const revised = '@article{Study, title={Revised citation}, author={{Example Institute}}, year={2025}}';
  await editor.fill(revised);
  await expect(preview.locator('body')).toContainText('Revised citation');
  await expect(preview.locator('body')).toContainText('Browser Numeric Style');
  project.files[2].text = revised;
  await page.getByRole('button', { name: 'Project resource', exact: true }).click();
  await page.getByRole('option', { name: 'styles/custom.csl', exact: true }).click();
  const revisedStyle = style.replace('prefix="[" suffix="]"', 'prefix="{" suffix="}"');
  await editor.fill(revisedStyle);
  project.files.find(file => file.path === 'styles/custom.csl').text = revisedStyle;
  await expect(preview.getByText('See {1} and', { exact: false })).toHaveCount(1);
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
  const html = await downloadText('Download project HTML', 'project.html');
  assert.equal(html, await iframe.getAttribute('srcdoc'));
  assert.match(html, /Browser Numeric Style/);
  assert.match(html, /See \{1\} and/);
  assert.equal(JSON.parse(roundtrip).files.find(file => file.path === 'styles/custom.csl').text, revisedStyle);
  assert.match(html, /Revised citation/);
  assert.match(html, /default-src 'none'/);
  assert.doesNotMatch(html, /<script[ >]/i);
  assert.match(html, /src="data:image\/png;base64,/);
  assert.match(html, /Quoted, sample/);
  await mkdir(output, { recursive: true });
  await page.getByRole('button', { name: 'Project resource', exact: true }).click();
  await page.getByRole('option', { name: 'references.bib', exact: true }).click();
  await editor.scrollIntoViewIfNeeded();
  await page.screenshot({ path: resolve(output, 'myst-project-resource-editor.png'), fullPage: true });
  await iframe.scrollIntoViewIfNeeded();
  await iframe.screenshot({ path: resolve(output, 'myst-project-entry-preview.png') });
  await preview.getByRole('table').scrollIntoViewIfNeeded();
  await iframe.screenshot({ path: resolve(output, 'myst-project-csv-table.png') });
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
  const futureSnapshot = JSON.stringify({ ...project, version: 99 });
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
  await expect(page.getByRole('button', { name: 'Download project HTML', exact: true })).toBeDisabled();
  const recovered = await downloadText('Download project snapshot', 'project.myst-project.json');
  assert.equal(recovered, futureSnapshot);
  // A notebook-entry project uses the same UI codecs, and discloses that full
  // original recovery includes hidden cells even though publication bodies do not.
  const notebookSource = JSON.stringify({ nbformat: 4, nbformat_minor: 5, metadata: { title: 'Notebook scientific publication', bibliography: 'refs.json', pero: { citation: { style: 'styles/custom.csl' } } }, cells: [
    { id: 'visible', cell_type: 'markdown', metadata: {}, source: '# Visible notebook body\n\n[@Alpha]' },
    { id: 'hidden', cell_type: 'markdown', metadata: { tags: ['remove-cell'] }, source: 'RECOVERY_ONLY_HIDDEN_SENTINEL [@Hidden]' },
    { id: 'recorded', cell_type: 'code', metadata: {}, source: 'print(42)', execution_count: 1, outputs: [{ output_type: 'stream', name: 'stdout', text: 'Recorded notebook output: 42' }] },
  ] }, null, 2) + '\r\n';
  const notebookProject = { format: 'pero-myst-project', version: 1, entry: 'study.ipynb', files: [
    { path: 'study.ipynb', text: notebookSource }, { path: 'styles/custom.csl', text: style },
    { path: 'refs.json', text: JSON.stringify([{ id: 'Alpha', type: 'book', title: 'Visible cited study' }, { id: 'Hidden', type: 'book', title: 'HIDDEN_BIBLIOGRAPHY_SENTINEL' }]) },
  ] };
  const notebookEntry = await api('entries', { method: 'POST', body: JSON.stringify({ document: { schemaVersion: 1, title: 'Notebook recovery export', content: { type: 'doc', content: [{ type: 'paragraph', attrs: { blockId: 'notebook-intro' } }] } } }) });
  await page.goto('about:blank');
  await page.goto(`${origin}/#notebook-entry=${notebookEntry.id}`); await english();
  await picker.setInputFiles({ name: 'notebook.myst-project.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(notebookProject)) });
  await expect(page.getByText('Scientific exports include the full original notebook, including content omitted by remove/hide tags, in recovery files or records. Review before sharing.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Word (DOCX)', exact: true })).toBeEnabled();
  await expect(preview.locator('body')).toContainText('Visible cited study');
  await expect(preview.locator('body')).not.toContainText('RECOVERY_ONLY_HIDDEN_SENTINEL');
  await expect(preview.locator('body')).not.toContainText('HIDDEN_BIBLIOGRAPHY_SENTINEL');
  const downloadBytes = async (label, filename) => {
    const pending = page.waitForEvent('download'); await page.getByRole('button', { name: label, exact: true }).click();
    const download = await pending; assert.equal(download.suggestedFilename(), filename);
    const destination = resolve(directory, filename); await download.saveAs(destination); return readFile(destination);
  };
  const word = await JSZip.loadAsync(await downloadBytes('Word (DOCX)', 'project-entry.docx'));
  assert.equal(await word.file('pero/notebook.ipynb').async('string'), notebookSource);
  const wordBody = await word.file('word/document.xml').async('string');
  assert.match(wordBody, /Visible notebook body/); assert.match(wordBody, /Recorded notebook output: 42/);
  assert.doesNotMatch(wordBody, /RECOVERY_ONLY_HIDDEN_SENTINEL|HIDDEN_BIBLIOGRAPHY_SENTINEL/);
  const latex = await JSZip.loadAsync(await downloadBytes('LaTeX + assets (ZIP)', 'project-entry.latex.zip'));
  assert.equal(await latex.file('notebook.ipynb').async('string'), notebookSource);
  await page.screenshot({ path: resolve(output, 'myst-notebook-scientific-recovery-warning.png'), fullPage: true });
  assert.ok(wasmRequests.length > 0, 'The actual production Wasm asset is fetched from this App origin');
  assert.deepEqual(externalRequests, []);
  assert.deepEqual(errors, []);
  assert.equal(await page.evaluate(() => globalThis.mystExecuted), undefined);
});

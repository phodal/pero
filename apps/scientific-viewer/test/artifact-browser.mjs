// Actual production Viewer bundle; only Host byte delivery and chat transport are fixtures.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { chromium, webkit, expect } from '@playwright/test';
import { examples } from '../ui-src/examples.ts';

const root = resolve(import.meta.dirname, '../../..'), dist = resolve(root, 'apps/scientific-viewer/dist');
const useWebKit = process.env.PERO_VIEWER_BROWSER === 'webkit';
const output = resolve(root, 'test-results/session-artifacts-viewer', ...(useWebKit ? ['webkit'] : []));
await mkdir(output, { recursive: true });
const sources = {
  markdown: ['report.md', 'text/markdown', 'document', '# Frozen observations\n\nSynthetic fixture, **unverified**.\n\n| time [s] | temperature [C] |\n| --- | --- |\n| 0 | 20 |\n| 1 | 21 |\n\n```python\nvalues = [20, 21, 23, 22]\nprint(sum(values) / len(values))\n```\n\n![Unfrozen figure](https://example.invalid/figure.png)'],
  code: ['analysis.py', 'text/x-python', 'document', 'from statistics import mean\n\nvalues = [20, 21, 23, 22]\nprint(mean(values))\n'],
  csv: ['voltage.csv', 'text/csv', 'csv', 'time[s],voltage[V]\n0,4.2\n1,\n2,3.9\n'],
  notebook: ['analysis.ipynb', 'application/x-ipynb+json', 'notebook', examples.find(item => item.name === 'demo.ipynb').text],
  saved_notebook: ['saved-analysis.ipynb', 'application/x-ipynb+json', 'notebook', JSON.stringify({
    nbformat: 4, nbformat_minor: 5, metadata: { kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' } },
    cells: [{ id: 'notice', cell_type: 'markdown', metadata: {}, source: ['Synthetic fixture. Saved outputs only; no kernel was run.'] },
      { id: 'result', cell_type: 'code', execution_count: 1, metadata: {}, source: ['value = 13\n', 'value'], outputs: [{ output_type: 'execute_result', execution_count: 1, metadata: {}, data: { 'text/plain': ['13'] } }] }],
  })],
  pdf: ['evidence.pdf', 'application/pdf', 'pdf', examples.find(item => item.name === 'sample.pdf').text],
  html: ['report.html', 'text/html', 'html', '<h1>Static HTML result</h1><p>Original markup remains available in Source.</p><table><tr><th>Measure</th><th>Value</th></tr><tr><td>Mean</td><td>21.5</td></tr></table><script>parent.__artifactScriptRan = true</script>'],
  image: ['figure.svg', 'image/svg+xml', 'image', '<svg xmlns="http://www.w3.org/2000/svg" width="720" height="400" viewBox="0 0 720 400"><rect width="720" height="400" fill="white"/><path d="M70 50V330H670" stroke="#222" fill="none"/><path d="M90 280L240 210L390 120L540 170L650 80" stroke="#176875" stroke-width="4" fill="none"/><text x="70" y="28" font-family="system-ui" font-size="18">Synthetic fixture, unverified</text><text x="310" y="380" font-family="system-ui" font-size="18">time [s]</text></svg>'],
};
let failedOnce = false;
const server = createServer(async (request, response) => {
  try {
    const path = new URL(request.url, 'http://localhost').pathname;
    if (path === '/host/sdk') return response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ name: 'scientific-viewer', version: '0.4.0', permissions: { api: [], events: [], host: [] } }));
    if (path.startsWith('/host/artifacts/')) {
      const id = path.split('/')[4];
      if (id === 'retry' && !failedOnce) { failedOnce = true; return response.writeHead(503).end('Unavailable'); }
      const [name, mediaType, kind, content] = sources[id] ?? sources.markdown;
      const bytes = Buffer.from(content), digest = createHash('sha256').update(bytes).digest('hex');
      return response.writeHead(200, { 'Content-Type': mediaType, 'Content-Length': bytes.length,
        'X-Pero-Artifact-Name': encodeURIComponent(name), 'X-Pero-Artifact-Sha256': id === 'corrupt' ? '0'.repeat(64) : digest,
        'X-Pero-Artifact-Kind': kind }).end(bytes);
    }
    const file = resolve(dist, decodeURIComponent(path).slice(1));
    if (!file.startsWith(dist + sep)) return response.writeHead(404).end();
    const bytes = await readFile(file);
    return response.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm' })[extname(file)] ?? 'application/octet-stream',
      'Content-Security-Policy': "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'" }).end(bytes);
  } catch (error) { response.writeHead(500).end(String(error.message)); }
});
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const origin = `http://127.0.0.1:${server.address().port}`;
const errors = [], checks = [];
let browser;
try {
  browser = await (useWebKit ? webkit : chromium).launch({ headless: true, ...(!useWebKit && process.env.PERO_CHROMIUM_PATH ? { executablePath: process.env.PERO_CHROMIUM_PATH } : {}) });
  const page = await browser.newPage({ viewport: { width: 480, height: 760 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const url = route.request().url();
    return url.startsWith(origin) || url.startsWith(`blob:${origin}/`) || url.startsWith('data:') ? route.continue() : route.abort();
  });
  await page.addInitScript(() => {
    window.__artifactChat = [];
    window.__artifactChatPending = [];
    window.__artifactChatManual = false;
    window.__artifactBrowserContext = null;
    window.__replyArtifactChat = (ok, error = '') => {
      const message = window.__artifactChatPending.shift();
      window.postMessage({ type: 'pero:app:chat-result', id: message.id, ok, error, value: ok ? { threadId: 'fixture-thread' } : undefined }, '*');
    };
    window.addEventListener('message', event => {
      if (event.source === window && event.data?.type === 'pero:artifact:select' && window.__artifactBrowserContext) {
        window.__artifactBrowserContext.selected = event.data.target;
        window.postMessage({ type: 'pero:app:context', context: { artifactBrowser: window.__artifactBrowserContext } }, '*');
        return;
      }
      if (event.source !== window || event.data?.type !== 'pero:app:chat') return;
      window.__artifactChat.push(event.data.options);
      window.__artifactChatPending.push(event.data);
      if (!window.__artifactChatManual) window.__replyArtifactChat(true);
    });
  });
  const open = async id => {
    await page.goto(`${origin}/artifact.html?thread_id=fixture-thread&artifact_id=${id}&version=2`);
    await expect(page.locator('.artifact-rich-preview')).toBeVisible();
  };
  const screenshot = name => page.screenshot({ path: resolve(output, `${name}.png`) });
  await open('markdown');
  await expect(page.getByRole('heading', { name: 'Frozen observations' })).toBeVisible();
  await expect(page.getByRole('table')).toBeVisible();
  await expect(page.locator('.artifact-missing-image')).toContainText('Image is not included');
  await expect(page.getByRole('button', { name: 'Add to prompt', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Discuss selection', exact: true })).toHaveCount(0);
  await page.locator('.artifact-markdown p').first().click({ clickCount: 3 });
  const selectedText = await page.evaluate(() => window.getSelection().toString());
  assert.match(selectedText, /Synthetic fixture, unverified\./);
  const discuss = page.getByRole('button', { name: 'Discuss selection', exact: true });
  await page.evaluate(() => { window.__artifactChatManual = true; });
  await discuss.click();
  await expect.poll(() => page.evaluate(() => window.__artifactChatPending.length)).toBe(1);
  await expect(discuss).toBeDisabled();
  await expect(page.locator('.artifact-notice')).toHaveCount(0);
  await page.evaluate(() => window.__replyArtifactChat(false, 'Frozen context could not be attached'));
  await expect(page.getByRole('alert')).toContainText('Frozen context could not be attached');
  await expect(page.locator('.artifact-notice')).toHaveCount(0);
  await expect(discuss).toBeEnabled();
  await screenshot('compose-error');
  await discuss.click();
  await expect.poll(() => page.evaluate(() => window.__artifactChatPending.length)).toBe(1);
  await expect(discuss).toBeDisabled();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('.artifact-notice')).toHaveCount(0);
  await page.evaluate(() => window.__replyArtifactChat(true));
  await expect(page.getByRole('status')).toContainText('Added to prompt');
  assert.match(await page.evaluate(() => window.__artifactChat[0].message), /About report\.md \(version 2\)/);
  assert.doesNotMatch(await page.evaluate(() => window.__artifactChat[0].message), /fixture-thread|session-artifact:|SHA-256:/);
  assert.ok((await page.evaluate(() => window.__artifactChat[0].message)).includes(`Selected text (data):\n${selectedText}`));
  await screenshot('markdown-light');
  await discuss.click();
  await expect.poll(() => page.evaluate(() => window.__artifactChatPending.length)).toBe(1);
  await expect(page.locator('.artifact-notice')).toHaveCount(0);
  await page.evaluate(() => window.__replyArtifactChat(false, 'Original conversation is unavailable'));
  await expect(page.getByRole('alert')).toContainText('Original conversation is unavailable');
  await expect(page.locator('.artifact-notice')).toHaveCount(0);
  await page.evaluate(() => { window.__artifactChatManual = false; });
  checks.push('SDK rejection stays visible; pending and failed composition never report success; success requires acknowledgement');
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await expect(page.locator('.cm-content')).toContainText('# Frozen observations');
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download', exact: true }).click();
  assert.deepEqual(await readFile(await (await download).path()), Buffer.from(sources.markdown[3]));
  checks.push('Markdown/table/source preview, actual selected text with immutable version chat context and byte-exact download');
  await open('code'); await expect(page.locator('.cm-content')).toContainText('from statistics import mean'); await screenshot('code-light');
  await open('csv'); await expect(page.locator('.numeric-point')).toHaveCount(2); await expect(page.getByRole('alert')).toContainText('1 missing'); await screenshot('csv-light');
  await page.getByRole('tab', { name: 'Table', exact: true }).click(); await expect(page.getByRole('cell', { name: 'Missing', exact: true })).toBeVisible();
  checks.push('Existing CodeMirror and CSV graph/table keep original missing values');
  await page.goto(`${origin}/artifact.html?thread_id=fixture-thread`);
  await expect(page.getByRole('main', { name: 'Artifact browser' })).toBeVisible();
  const catalog = ['csv', 'markdown'].map(id => {
    const [filename, , kind, content] = sources[id];
    const format = { kind: id === 'markdown' ? 'markdown' : 'text' };
    return { id, thread_id: 'fixture-thread', title: filename, versions: [{ version: 2,
      sha256: createHash('sha256').update(content).digest('hex'), bytes: Buffer.byteLength(content), created_at: 0,
      format, media: kind === 'document' ? { kind, format } : { kind }, filename, source: { kind: 'text' } }] };
  });
  await page.evaluate(artifacts => {
    window.__artifactBrowserContext = { thread_id: 'fixture-thread', view: 'gallery', artifacts,
      selected: { thread_id: 'fixture-thread', artifact_id: 'csv', version: 2 } };
    window.postMessage({ type: 'pero:app:context', context: { artifactBrowser: window.__artifactBrowserContext } }, '*');
  }, catalog);
  const chart = page.locator('.numeric-chart svg');
  await chart.focus(); await chart.press('ArrowRight');
  await expect(page.locator('.numeric-chart output')).toContainText('Row 3:');
  await expect(chart).toBeFocused();
  const xAxis = page.getByRole('button', { name: 'X axis', exact: true });
  await xAxis.focus(); await xAxis.press('ArrowDown');
  const axes = page.getByRole('listbox', { name: 'X axis', exact: true });
  await axes.press('End'); await axes.press('Enter');
  await expect(xAxis).toHaveText('voltage[V]'); await expect(xAxis).toBeFocused();
  await expect(chart).toHaveAttribute('aria-label', 'Chart of voltage[V] against voltage[V]');
  await expect.poll(() => page.evaluate(() => window.__artifactBrowserContext.selected.artifact_id)).toBe('csv');
  const csvTile = page.getByRole('option', { name: 'voltage.csv, CSV, v2' });
  const markdownTile = page.getByRole('option', { name: 'report.md, Markdown, v2' });
  await csvTile.focus(); await csvTile.press('ArrowRight');
  await expect(markdownTile).toHaveAttribute('aria-selected', 'true'); await expect(markdownTile).toBeFocused();
  await markdownTile.press('Home');
  await expect(csvTile).toHaveAttribute('aria-selected', 'true'); await expect(csvTile).toBeFocused();
  await csvTile.press('Space');
  await expect(page.getByRole('button', { name: 'Back to artifacts' })).toBeFocused();
  await page.keyboard.press('Escape'); await expect(csvTile).toBeFocused();
  await screenshot('gallery-keyboard');
  checks.push('Gallery keeps chart and select keyboard input local; artifact navigation, quick look and Escape restore focus');
  await open('image'); await expect(page.locator('.artifact-image img')).toBeVisible();
  await expect.poll(() => page.locator('.artifact-image img').evaluate(node => node.naturalWidth)).toBeGreaterThan(0); await screenshot('image-light');
  await open('html'); await expect(page.frameLocator('.artifact-html').getByRole('heading', { name: 'Static HTML result' })).toBeVisible();
  assert.equal(await page.evaluate(() => window.__artifactScriptRan), undefined); await screenshot('html-light');
  checks.push('Image bytes render; static sandboxed HTML renders without running stored scripts');
  await open('pdf'); await expect(page.locator('.artifact-pdf canvas')).toBeVisible();
  await expect.poll(() => page.locator('.artifact-pdf canvas').evaluate(node => node.width)).toBeGreaterThan(300);
  await expect(page.locator('.artifact-pdf .artifact-loading')).toHaveCount(0); await screenshot('pdf-light');
  await page.getByRole('button', { name: 'Discuss page', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__artifactChat.length)).toBe(1);
  assert.match(await page.evaluate(() => window.__artifactChat[0].message), /PDF page 1 \/ 1\nSynthetic scientific evidence\./);
  assert.match(await page.evaluate(() => window.__artifactChat[0].message), /About evidence\.pdf \(version 2\)/);
  checks.push('Real PDF.js page canvas and zoom/page controls');
  await open('notebook'); await expect(page.locator('.jp-Cell')).toHaveCount(3, { timeout: 30000 });
  await expect(page.locator('.jp-MarkdownCell')).toContainText('Synthetic notebook');
  await expect(page.locator('.jp-CodeCell .cm-content').first()).toContainText('values = [20, 21, 23, 22]');
  await expect(page.locator('.jp-CodeCell .jp-OutputArea').first()).toContainText('21.5'); await screenshot('notebook-light');
  await open('saved_notebook'); await expect(page.locator('.jp-Cell')).toHaveCount(2, { timeout: 30000 });
  await expect(page.locator('.jp-MarkdownCell')).toContainText('Saved outputs only; no kernel was run.');
  await expect(page.locator('.jp-CodeCell .cm-content')).toContainText('value = 13');
  await expect(page.locator('.jp-CodeCell .jp-OutputArea')).toContainText('13');
  await expect(page.locator('.jp-CodeCell .jp-OutputArea')).toBeVisible(); await screenshot('saved-notebook-13');
  await page.evaluate(() => window.postMessage({ type: 'pero:app:context', context: { locale: 'zh-CN', dark: true, active: true } }, '*'));
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'pero-dark');
  await expect(page.locator('.jp-CodeCell .cm-content')).toContainText('value = 13');
  await expect(page.locator('.jp-CodeCell .jp-OutputArea')).toContainText('13');
  await expect(page.locator('.notebook-preview [role="status"]')).toHaveCount(0);
  await page.setViewportSize({ width: 320, height: 640 }); await screenshot('notebook-dark-narrow');
  assert.equal(await page.locator('html').evaluate(node => node.scrollWidth <= node.clientWidth + 1), true);
  checks.push('Saved Notebook cells/outputs, actual SDK theme and 320px layout');
  await page.goto(`${origin}/artifact.html?thread_id=fixture-thread&artifact_id=corrupt&version=2`);
  await expect(page.getByRole('alert')).toContainText('digest'); await screenshot('digest-error');
  await page.goto(`${origin}/artifact.html?thread_id=fixture-thread&artifact_id=retry&version=2`);
  await expect(page.getByRole('alert')).toContainText('503'); await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Frozen observations' })).toBeVisible();
  checks.push('Corrupt bytes remain rejected; failed Host read recovers on explicit retry');
  assert.deepEqual(errors, []);
  await writeFile(resolve(output, 'result.json'), JSON.stringify({ scope: `Production Viewer in ${useWebKit ? 'Playwright WebKit' : 'Chromium'}; Host bytes and chat transport are synthetic fixtures`, checks, errors, exclusions: ['Native/Electron bridge', 'real model', 'Notebook execution', 'scientific acceptance'] }, null, 2));
  console.log(JSON.stringify({ passed: checks.length, output }));
} finally { await browser?.close(); server.closeAllConnections(); await new Promise(done => server.close(done)); }

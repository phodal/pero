// Optional Chromium check of saved exports. No external requests are allowed.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { parseIpynb, editIpynbCell, ipynbExportFormats } from '../../packages/notebook/src/ipynb.ts';

const directory = resolve(process.argv[2]);
const imports = [];
for (const file of ['jupyter/first.ipynb', 'marimo/converted-executed.ipynb']) {
  const source = await readFile(resolve(directory, file), 'utf8');
  const document = parseIpynb(source);
  assert.equal(ipynbExportFormats[0].serialize(document), source);
  const cell = document.cells.find(cell => cell.kind === 'code' && cell.outputs.length);
  assert.ok(cell);
  const edited = editIpynbCell(document, cell.index, cell.source + '\n# local revision');
  assert.equal(edited.cells[cell.index].stale, true);
  assert.deepEqual(edited.cells[cell.index].outputs, cell.outputs);
  assert.equal(document.source, source);
  imports.push({ file, original_roundtrip: true, edited_output_stale: true,
    diagnostics: document.cells.flatMap(cell => cell.diagnostics) });
}
await writeFile(resolve(directory, 'pero-import.json'), JSON.stringify(imports, null, 2) + '\n');
const documents = new Map([
  ['/marimo', 'marimo/first.html'],
  ['/jupyter', 'jupyter/first.html'],
  ['/marimo-table', 'marimo/table.html'],
  ['/jupyter-table', 'jupyter/table.html'],
]);
const server = createServer(async (request, response) => {
  const name = documents.get(request.url);
  if (!name) { response.writeHead(404).end(); return; }
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  response.end(await readFile(resolve(directory, name)));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
const observations = [];
try {
  for (const [path, file] of documents) {
    const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
    const blocked = new Set();
    await page.route('**/*', route => {
      const url = route.request().url();
      if (url.startsWith(origin + '/')) return route.continue();
      blocked.add(url);
      return route.abort();
    });
    await page.goto(origin + path, { waitUntil: 'networkidle' });
    const table = page.locator('table').filter({ hasText: 'Mean (mg/L)' }).first();
    const visible = await table.isVisible();
    if (path !== '/marimo') {
      assert.ok(visible, `${file}: saved table is visible offline`);
      assert.deepEqual(await table.locator('tbody tr').allTextContents(), ['control32', 'treatment34']);
    }
    const screenshot = `${path.slice(1)}-offline.png`;
    await page.screenshot({ path: resolve(directory, screenshot), fullPage: true });
    observations.push({ file, table_visible: visible, blocked_urls: [...blocked], screenshot });
    await page.close();
  }
  await writeFile(resolve(directory, 'browser.json'), JSON.stringify(observations, null, 2) + '\n');
  console.log(JSON.stringify(observations.map(({ blocked_urls, ...row }) => ({ ...row, blocked_requests: blocked_urls.length })), null, 2));
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}

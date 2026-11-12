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
const token = 'scientific-block-browser';
const output = resolve(root, 'test-results/notebook');
const fixture = JSON.parse(await readFile(resolve(root, 'packages/notebook/test/fixtures/snapshot-contract.json'), 'utf8'));
const report = fixture.bases.paper.reportId;
const source = {
  app: 'paper-agent', kind: 'report-citation', id: report, version: report,
  locator: `pero-app-location://paper-agent/main/report/${report}/citation/${fixture.bases.paper.citationIndex}`,
};

test('Notebook reviews a real paper reference through the saved entry', { timeout: 120_000 }, async t => {
  const directory = await mkdtemp(resolve(tmpdir(), 'pero-scientific-block-'));
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
  const created = await fetch(`http://127.0.0.1:${port}/api/entries`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Pero-App-Token': token },
    body: JSON.stringify({ document: { schemaVersion: 1, title: 'Paper evidence', content: { type: 'doc', content: [
      { type: 'paragraph', attrs: { blockId: 'intro' }, content: [{ type: 'text', text: 'Opened from the owner export.' }] },
      { type: 'evidence', attrs: { blockId: 'paper-block', label: 'Imported report', source, snapshot: null } },
    ] } } }),
  });
  assert.equal(created.status, 201);
  const entry = await created.json();
  const browser = await chromium.launch({ executablePath: process.env.PERO_CHROMIUM_EXECUTABLE, headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  t.after(async () => {
    try {
      await mkdir(output, { recursive: true });
      await page.screenshot({ path: resolve(output, 'scientific-block-review.png'), fullPage: true });
    } finally { await browser.close(); }
  });
  const proposed = await fetch(`http://127.0.0.1:${port}/api/agent-apply`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Pero-App-Token': token },
    body: JSON.stringify({ entryId: entry.id, baseRevision: 1, operations: [{
      op: 'propose_reference', proposalId: 'proposal-browser', blockId: 'paper-block', label: 'Pinned report', source,
    }] }),
  });
  assert.equal(proposed.status, 200, await proposed.text());
  await page.goto(`${origin}/#notebook-entry=${entry.id}`);
  await page.evaluate(() => window.postMessage({ type: 'pero:app:context', context: { locale: 'en', dark: false, active: true } }, location.origin));
  const card = page.locator('[data-editor-block-id="paper-block"]');
  const openReference = async () => {
    await page.locator('[data-notebook-block-id="paper-block"] .notebook-reference-trigger').click();
    await expect(page.locator('#notebook-inspector')).toBeVisible();
    await page.locator('#notebook-inspector summary').filter({ hasText: /^Record identifiers$/ }).click();
  };
  await openReference();
  await expect(card).toContainText(report);
  await expect(card).toContainText('paper-block');
  await expect(page.getByText('Proposal wording: Pinned report')).toBeVisible();
  await page.getByRole('button', { name: 'Reject proposal', exact: true }).click();
  await expect(page.getByText('Rejected. This revision was not changed.')).toBeVisible();
  await expect(page.locator('.notebook-status')).toContainText('Revision 1');
  await expect(page.getByRole('button', { name: 'Accept proposal', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Reject proposal', exact: true })).toHaveCount(0);
  const second = await fetch(`http://127.0.0.1:${port}/api/agent-apply`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Pero-App-Token': token },
    body: JSON.stringify({ entryId: entry.id, baseRevision: 1, operations: [{
      op: 'propose_reference', proposalId: 'proposal-browser-2', blockId: 'paper-block', label: 'Pinned report', source,
    }] }),
  });
  assert.equal(second.status, 200, await second.text());
  await page.reload();
  await page.evaluate(() => window.postMessage({ type: 'pero:app:context', context: { locale: 'en', dark: false, active: true } }, location.origin));
  await openReference();
  await page.getByRole('button', { name: 'Accept proposal', exact: true }).click();
  await expect(page.locator('.notebook-status')).toContainText('Revision 2');
  // Accept installs the committed entry, which closes the prior inspector.
  await openReference();
  await expect(page.getByText('Accepted as revision 2. The previous revision is unchanged.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Accept proposal', exact: true })).toHaveCount(0);
  await page.reload();
  await page.evaluate(() => window.postMessage({ type: 'pero:app:context', context: { locale: 'en', dark: false, active: true } }, location.origin));
  await openReference();
  await expect(page.getByRole('textbox', { name: 'Label', exact: true })).toHaveValue('Pinned report');
  await expect(page.locator('[data-object-version]')).toContainText(report);
  // A saved edit makes the first proposal stale. A new proposal must not be
  // hidden behind it, and rejecting either one must not create a revision.
  for (const [proposalId, baseRevision] of [['stale-browser', 2], ['fresh-browser', 3]]) {
    if (baseRevision === 3) {
      const edited = await fetch(`http://127.0.0.1:${port}/api/agent-apply`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Pero-App-Token': token },
        body: JSON.stringify({ entryId: entry.id, baseRevision: 2, operations: [{
          op: 'replace_text', blockId: 'intro', match: 'Opened', replacement: 'Updated',
        }] }),
      });
      assert.equal(edited.status, 200, await edited.text());
    }
    const response = await fetch(`http://127.0.0.1:${port}/api/agent-apply`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Pero-App-Token': token },
      body: JSON.stringify({ entryId: entry.id, baseRevision, operations: [{
        op: 'propose_reference', proposalId, blockId: 'paper-block', label: proposalId, source,
      }] }),
    });
    assert.equal(response.status, 200, await response.text());
  }
  await page.reload();
  await page.evaluate(() => window.postMessage({ type: 'pero:app:context', context: { locale: 'en', dark: false, active: true } }, location.origin));
  await openReference();
  await expect(page.getByText('Proposal wording: fresh-browser')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Accept proposal', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Reject proposal', exact: true }).click();
  await expect(page.getByText('Proposal wording: stale-browser')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Accept proposal', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Reject proposal', exact: true }).click();
  await expect(page.getByText('Rejected. This revision was not changed.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reject proposal', exact: true })).toHaveCount(0);
  await expect(page.locator('.notebook-status')).toContainText('Revision 3');
  await expect(page.getByRole('textbox', { name: 'Label', exact: true })).toHaveValue('Pinned report');
  await page.reload();
  await page.evaluate(() => window.postMessage({ type: 'pero:app:context', context: { locale: 'en', dark: false, active: true } }, location.origin));
  await openReference();
  await expect(page.locator('.notebook-status')).toContainText('Revision 3');
  await expect(page.getByRole('button', { name: 'Reject proposal', exact: true })).toHaveCount(0);
  assert.deepEqual(errors, []);
});

// Transport fixtures exercise the production component, not scientific or Native acceptance.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
const root = resolve(import.meta.dirname, '../..');
const output = await mkdtemp(join(tmpdir(), 'pero-fisher-ui-'));
const spec = { id: 'protocol-1', python_version: '3.11.fixture', data_sha256: 'fixture-only', metric: 'within-species sum of squares', unit: 'cm^2', reported: 19.1434, comparison: { mode: 'absolute', tolerance: .00005 }, command: ['python', 'fixed-fixture'], scope: 'One statistic only' };
const source = `import React from 'react';import {createRoot} from 'react-dom/client';
import {AppSdkProvider} from '@pero/app-sdk';
import {FisherReproduction} from '${root}/apps/paper-agent/ui-src/fisher-reproduction';
import '${root}/packages/app-sdk/src/ui.css';
const api={post:async(path,body)=>{const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(!r.ok)throw Error('Fixture transport error');return r.json();}};
createRoot(document.getElementById('root')).render(<AppSdkProvider host={{info:{locale:'en',active:true}}}><FisherReproduction api={api} annotation={{id:'source-annotation'}} onSource={()=>{}}/></AppSdkProvider>);`;
let items = [], failStatus = false, loseRunResponse = false, delayedReport = false;
const operations = [], errors = [];
const server = createServer(async (req, res) => {
  if (req.method === 'GET') {
    if (req.url.endsWith('.js') || req.url.endsWith('.css')) {
      res.setHeader('Content-Type', req.url.endsWith('.js') ? 'text/javascript' : 'text/css');
      res.end(await readFile(join(output, 'app' + (req.url.endsWith('.js') ? '.js' : '.css')))); return;
    }
    res.setHeader('Content-Type', 'text/html');
    res.end('<meta charset="utf-8"><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/app.css"><style>body{font:14px sans-serif;margin:16px}#root{max-width:350px}</style><p>DISPOSABLE UI FIXTURE. No scientific execution.</p><div id="root"></div><script type="module" src="/app.js"></script>'); return;
  }
  let raw = ''; for await (const part of req) raw += part;
  const body = JSON.parse(raw); operations.push(body); let value;
  if (body.action === 'status') {
    if (failStatus) { res.writeHead(503); res.end('Fixture status failure'); return; }
    value = { case: 'fixture', scope: spec.scope, preview: spec, items };
  } else if (body.action === 'freeze') {
    assert.equal(body.confirmed, true);
    const row = { itemId: `item-${items.length + 1}`, spec: { ...spec, id: `protocol-${items.length + 1}`, comparison: body.comparison }, attempts: [] };
    items.push(row); value = { itemId: row.itemId, spec: row.spec };
  } else if (body.action === 'run') {
    assert.equal(body.confirmed, true); const row = items.find(i => i.itemId === body.itemId);
    const attempt = { attemptId: `attempt-${operations.filter(o => o.action === 'run').length}`, execution: { status: 'completed', request_id: body.requestId }, report: delayedReport ? null : { result_verdict: 'REPRODUCED', paper_verdict: 'NOT_ASSESSED', reported: 19.1434, actual: 19.1434, difference: 0 }, independent: delayedReport ? null : { numeric_recomputation: 'PASS', independence: 'Synthetic exact-fraction fixture' }, annotation: null };
    row.attempts.push(attempt); value = attempt;
    if (loseRunResponse) { res.writeHead(503); res.end('Response lost after dispatch'); return; }
  } else if (body.action === 'logs') value = { text: `Synthetic logs for ${body.attemptId}` };
  else if (req.url === '/api/fisher/evidence-archive') { res.setHeader('Content-Type', 'application/zip'); res.end('fixture-only'); return; }
  else { res.writeHead(400); res.end('Unknown fixture operation'); return; }
  res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value));
});
let browser;
try {
  await build({ stdin: { contents: source, loader: 'tsx', resolveDir: root }, outfile: join(output, 'app.js'), bundle: true, format: 'esm', platform: 'browser', jsx: 'automatic', alias: { react: resolve(root, 'apps/paper-agent/node_modules/react'), 'react-dom': resolve(root, 'apps/paper-agent/node_modules/react-dom'), '@pero/app-sdk/ui': resolve(root, 'packages/app-sdk/src/ui.tsx') } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({ executablePath: process.env.PERO_CHROMIUM_PATH || chromium.executablePath(), headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
  page.on('pageerror', e => errors.push(e.message));
  const base = `http://127.0.0.1:${server.address().port}`;
  await page.route('**/*', route => route.request().url().startsWith(base + '/') ? route.continue() : route.abort());
  await page.goto(base);
  const freeze = page.getByRole('button', { name: 'Freeze protocol', exact: true });
  await expect(freeze).toBeDisabled();
  await page.getByRole('checkbox').check();
  await page.getByLabel('Tolerance', { exact: true }).fill('-1');
  await expect(freeze).toBeDisabled(); // Editing resets explicit confirmation.
  await page.getByRole('checkbox').check(); await freeze.click();
  await expect(page.getByText('Enter a finite nonnegative tolerance', { exact: false })).toBeVisible();
  assert.equal(items.length, 0);
  await page.getByLabel('Tolerance', { exact: true }).fill('0.00005');
  await page.getByRole('checkbox').check(); await freeze.click();
  const run = page.getByRole('button', { name: 'Confirm and run fixed arithmetic', exact: true });
  await expect(run).toBeEnabled(); assert.equal(operations.filter(o => o.action === 'run').length, 0);
  await run.click();
  await expect(page.getByText('Single-result verdict: REPRODUCED')).toBeVisible();
  await expect(page.getByText('Independent numerical check: PASS')).toBeVisible();
  await page.getByRole('button', { name: 'Read attempt logs' }).click();
  await expect(page.getByText('Synthetic logs for attempt-1', { exact: true })).toBeVisible();
  failStatus = true; await page.getByRole('button', { name: 'Refresh status' }).click();
  await expect(page.getByText('Request failed; retained records may not be current.')).toBeVisible();
  await expect(page.getByText('Single-result verdict: REPRODUCED')).toBeVisible();
  failStatus = false; loseRunResponse = true; delayedReport = true;
  const rerun = page.getByRole('button', { name: 'Confirm and run a new attempt', exact: true });
  await rerun.click(); await expect(rerun).toBeDisabled();
  await expect(page.getByText('Run response is unconfirmed.', { exact: false })).toBeVisible();
  await expect.poll(() => operations.filter(o => o.action === 'run').length).toBe(2);
  await expect(page.getByText('Fixture transport error', { exact: false })).toBeVisible();
  await page.reload(); await expect(rerun).toBeDisabled();
  await expect(page.getByText('Run response is unconfirmed.', { exact: false })).toBeVisible();
  assert.equal(operations.filter(o => o.action === 'run').length, 2);
  items[0].attempts[1].report = { result_verdict: 'INCONCLUSIVE', reported: 19.1434, actual: null, difference: null, reason: 'Synthetic check failed' };
  await page.getByRole('button', { name: 'Refresh status' }).click(); await expect(rerun).toBeEnabled();
  await expect(page.getByText('Single-result verdict: INCONCLUSIVE')).toBeVisible();
  await expect(page.getByText('Independent numerical check: Not checked')).toBeVisible();
  loseRunResponse = false; delayedReport = false;
  await rerun.click();
  await expect.poll(() => operations.filter(o => o.action === 'run').length).toBe(3);
  await expect(page.getByText('Single-result verdict: REPRODUCED')).toBeVisible();
  await expect(rerun).toBeEnabled();
  const runs = operations.filter(o => o.action === 'run');
  assert.equal(new Set(runs.map(r => r.requestId)).size, 3);
  assert.equal(new Set(runs.map(r => r.specId)).size, 1);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export standalone handoff ZIP' }).click();
  assert.match((await downloadPromise).suggestedFilename(), /^fisher-attempt-3.zip$/);
  await page.getByRole('button', { name: 'Create new protocol (retain earlier versions)' }).click();
  await page.getByRole('checkbox').check(); await freeze.click();
  await expect.poll(() => items.length).toBe(2);
  await expect(run).toBeEnabled();
  assert.equal(items[0].attempts.length, 3);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  assert.deepEqual(errors, []);
  const evidence = resolve(root, 'test-results/paper-fisher'); await mkdir(evidence, { recursive: true });
  await page.screenshot({ path: join(evidence, 'component-light.png'), fullPage: true });
  console.log('PASS: explicit consent, validation, no auto-run, immutable attempts, retained refresh failure, lost-response reconciliation across reload, missing report blocks replay, independent check absent, ZIP download, narrow layout. Component transport fixture only.');
} finally { await browser?.close(); if (server.listening) await new Promise(resolve => server.close(resolve)); await rm(output, { recursive: true, force: true }); }

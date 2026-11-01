// Disposable UI fixtures only. This does not exercise Electron approval or PC-Gym.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';

const root = resolve(import.meta.dirname, '../..'), app = resolve(root, 'apps/paper-agent');
const output = await mkdtemp(join(tmpdir(), 'pero-reproduction-ui-'));
const ids = { annotation: 'a'.repeat(64), item: 'b'.repeat(64), spec: 'c'.repeat(64), attempt: 'd'.repeat(64) };
const source = `import React from 'react'; import { createRoot } from 'react-dom/client';
import { Reproduction } from '${app}/ui-src/reproduction';
import { messages } from '${app}/ui-src/i18n'; import '${app}/ui-src/styles.css';
const api={post:async(path,body)=>{const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(!r.ok)throw new Error('Fixture transport error');return r.json();}};
createRoot(document.getElementById('root')).render(<Reproduction api={api} annotation={{id:'${ids.annotation}',quote:'0.0727'}} t={key=>messages[key].en}/>);`;
for (const mode of ['browser', 'desktop-fixture']) await build({
  stdin: { contents: source, loader: 'tsx', resolveDir: root }, outfile: join(output, mode + '.js'), bundle: true,
  format: 'esm', platform: 'browser', jsx: 'automatic',
  alias: { react: resolve(app, 'node_modules/react'), 'react-dom': resolve(app, 'node_modules/react-dom'),
    '@pero/app-sdk/ui': resolve(root, 'packages/app-sdk/src/ui.tsx') },
  ...(mode === 'desktop-fixture' ? { define: { 'location.protocol': '"pero-app:"' } } : {}),
});
let item = null, attempts = [], requests = [], polls = 0, runCount = 0;
const operations = [], errors = [];
const spec = { id: ids.spec, profile: 'smoke', seed: 0, steps: 128, episodes: 2, samples: 60, timeout_seconds: 600, packages: [['fixture-only', 'not-a-real-environment']] };
const server = createServer(async (req, res) => {
  if (req.method === 'GET') {
    const mode = req.url.includes('desktop-fixture') ? 'desktop-fixture' : 'browser';
    if (req.url.endsWith('.js') || req.url.endsWith('.css')) {
      res.setHeader('Content-Type', req.url.endsWith('.js') ? 'text/javascript' : 'text/css');
      res.end(await readFile(join(output, mode + (req.url.endsWith('.js') ? '.js' : '.css')))); return;
    }
    res.setHeader('Content-Type', 'text/html');
    res.end(`<meta charset="utf-8"><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/${mode}.css"><style>:root{--pero-surface:#fff;--pero-text:#151515;--pero-text-muted:#555;--pero-border:#bbb}body{font:14px sans-serif;margin:12px}#root{max-width:350px}button{max-width:100%;white-space:normal}body.dark{background:#161616;color:#eee;--pero-surface:#161616;--pero-text:#eee;--pero-text-muted:#bbb;--pero-border:#777}</style><p>DISPOSABLE SYNTHETIC UI FIXTURE — no scientific execution</p><div id="root"></div><script type="module" src="/${mode}.js"></script>`); return;
  }
  let raw = ''; for await (const part of req) raw += part;
  const body = JSON.parse(raw); operations.push({ path: req.url, ...body });
  let value;
  if (req.url === '/host/reproduction') {
    if (body.operation === 'cancel') {
      requests = requests.map(request => request.request_id === body.requestId ? { ...request, status: 'cancelled' } : request);
      value = { state: 'cancelled', ...body };
    } else {
      runCount++; polls = 0;
      requests.push({ request_id: body.requestId, status: runCount === 2 ? 'unknown' : 'starting' });
      if (runCount === 2) { res.statusCode = 503; res.end('Fixture response lost after dispatch'); return; }
      value = { state: 'allowed', status: 'starting', ...body };
    }
  } else if (body.action === 'prepare-item') {
    assert.equal(body.profile, 'smoke'); assert.equal(body.maxSeconds, 600); assert.equal(body.includeOracle, true);
    item = { id: ids.item, spec_id: ids.spec, annotation_id: ids.annotation, policy: body.policy, comparison: body.comparison, reported: .0727 };
    value = item;
  } else if (body.action === 'annotation-evidence') {
    if (requests.at(-1)?.status === 'starting' && ++polls >= 2) {
      const attempt_id = (runCount === 1 ? 'd' : 'e').repeat(64);
      const status = runCount === 1 ? 'completed' : 'failed';
      attempts.push({ attempt_id, status, origin: 'synthetic-fixture', ...(status === 'failed' ? { phase: 'preflight', error: 'Synthetic missing dependency' } : {}) });
      requests.at(-1).status = status; requests.at(-1).attempt_id = attempt_id;
    }
    value = { executionAvailable: true, items: item ? [{ item, spec, attempts, requests }] : [] };
  } else if (body.action === 'compare-item') {
    const attempt = attempts.find(a => a.attempt_id === body.attemptId);
    value = { execution_status: attempt.status, comparison_status: 'inconclusive', paper_verdict: 'INCONCLUSIVE',
      reported: .0727, actual: attempt.status === 'completed' ? 0 : null, diagnostic: null, reasons: ['synthetic-fixture', 'pcgym_metric_and_original_experiment_unresolved'] };
  } else if (body.action === 'logs') value = { text: 'Synthetic fixture log; no PC-Gym execution.', truncated: true };
  else { res.statusCode = 400; value = { error: 'Unknown fixture operation' }; }
  res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.PERO_CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 380, height: 900 } });
  page.on('pageerror', error => errors.push(error.message));
  const base = `http://127.0.0.1:${server.address().port}`;
  await page.route('**/*', route => route.request().url().startsWith(base + '/') ? route.continue() : route.abort());
  await page.goto(base + '/browser');
  await expect(page.getByText('Running requires Pero Desktop.', { exact: false })).toBeVisible();
  await page.getByLabel('Tolerance', { exact: true }).fill('0.001');
  await page.getByRole('button', { name: 'Save frozen verification item', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Approve and run once' })).toBeDisabled();
  await expect(page.locator('.pa-muted')).toContainText('128 steps');
  await page.goto(base + '/desktop-fixture');
  await page.getByRole('button', { name: 'Approve and run once' }).click();
  await expect(page.getByText('Test fixture, not an actual paper reproduction.', { exact: true })).toBeVisible();
  await expect(page.getByText('Paper verdict: INCONCLUSIVE', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'View execution log' }).click();
  await expect(page.getByText('Synthetic fixture log; no PC-Gym execution.', { exact: true })).toBeVisible();
  await expect(page.getByText('Only the first 64 KiB', { exact: false })).toBeVisible();
  const first = operations.find(o => o.path === '/host/reproduction' && o.operation === 'request');
  await page.getByRole('button', { name: 'Approve and run once' }).click();
  await expect(page.getByText('The request outcome is not confirmed.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve and run once' })).toBeDisabled();
  await page.getByRole('button', { name: 'Check original request status' }).click();
  await page.getByRole('button', { name: 'Cancel this request' }).click();
  await expect(page.getByRole('button', { name: 'Approve and run once' })).toBeEnabled();
  const runs = operations.filter(o => o.path === '/host/reproduction' && o.operation === 'request');
  const cancel = operations.find(o => o.path === '/host/reproduction' && o.operation === 'cancel');
  assert.equal(runs.length, 2); assert.notEqual(runs[1].requestId, first.requestId);
  assert.equal(cancel.requestId, runs[1].requestId); assert.equal(runs[1].specId, first.specId); assert.equal(runs[1].itemId, first.itemId);
  await page.getByRole('button', { name: 'Approve and run once' }).click();
  await expect(page.getByText('Environment preflight failed (computation not started)', { exact: false })).toBeVisible();
  await expect(page.getByText('Execution state: failed', { exact: true })).toBeVisible();
  await expect(page.getByText('Execution state: starting', { exact: true })).toHaveCount(0);
  await page.evaluate(() => document.body.classList.add('dark'));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  assert.deepEqual(errors, []);
  const evidence = resolve(root, 'test-results/paper-reproduction');
  await mkdir(evidence, { recursive: true });
  await page.screenshot({ path: join(evidence, 'synthetic-component-dark.png'), fullPage: true });
  await writeFile(join(evidence, 'component.json'), JSON.stringify({ scope: 'synthetic component, not Electron or PC-Gym',
    checks: ['browser gate', 'freeze', 'same-item rerun', 'unknown cancellation', 'result and logs', 'preflight failure', 'narrow dark layout'],
    actualScientificExecution: false }, null, 2));
  console.log('Paper reproduction component fixture PASS: browser gate, freeze, same-item rerun, unknown/cancel, result/logs, preflight failure, narrow dark layout. No Electron or scientific execution.');
} finally {
  await browser?.close(); await new Promise(resolve => server.close(resolve)); await rm(output, { recursive: true, force: true });
}

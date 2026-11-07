/** Real LCMS2Yield UI against its Python case API. Host navigation and environment inspection are fixtures. */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createInterface } from 'node:readline';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
import { appSdkAliases } from '../../../scripts/build/app-sdk.mjs';

const root = resolve(import.meta.dirname, '../../..');
const appRoot = resolve(root, 'apps/lcms2yield');
const captures = resolve(root, 'test-results/lcms2yield');
let browser, directory, bundle, css;

before(async () => {
  directory = await mkdtemp(resolve(tmpdir(), 'pero-lcms2yield-ui-'));
  await mkdir(captures, { recursive: true });
  await build({
    entryPoints: [resolve(appRoot, 'ui-src/frame.tsx')], outfile: resolve(directory, 'app.js'),
    bundle: true, platform: 'browser', format: 'esm', jsx: 'automatic', alias: appSdkAliases(root),
    nodePaths: [resolve(appRoot, 'node_modules')],
    loader: { '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl', '.svg': 'dataurl' },
    plugins: [{ name: 'app-react-runtime', setup(builder) {
      builder.onResolve({ filter: /^(react|react-dom)(\/|$)/ }, args => args.resolveDir === appRoot ? undefined : builder.resolve(args.path, { kind: args.kind, resolveDir: appRoot }));
    } }],
  });
  [bundle, css] = await Promise.all(['app.js', 'app.css'].map(name => readFile(resolve(directory, name))));
  browser = await chromium.launch({ headless: true });
});
after(async () => { await browser?.close(); if (directory) await rm(directory, { recursive: true, force: true }); });

async function fixture(t, inference = false) {
  const mutations = [];
  let custom = null;
  const data = await mkdtemp(resolve(tmpdir(), 'pero-lcms2yield-data-'));
  const secret = 'lcms2yield-loopback-fixture';
  const errors = [];
  const backend = spawn(process.env.PYTHON || 'python3', [resolve(appRoot, 'backend/server.py')], {
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', PERO_APP_DATA: data, PERO_APP_TOKEN: secret },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let diagnostics = '';
  backend.stderr.on('data', chunk => { diagnostics += chunk; });
  const port = await new Promise((resolvePort, reject) => {
    const deadline = setTimeout(() => reject(new Error(`LCMS2Yield readiness timed out: ${diagnostics}`)), 10000);
    backend.once('error', reject);
    backend.once('exit', code => reject(new Error(`LCMS2Yield exited ${code}: ${diagnostics}`)));
    createInterface({ input: backend.stdout }).once('line', line => { clearTimeout(deadline); resolvePort(JSON.parse(line).port); });
  });
  const server = createServer(async (request, response) => {
    if (request.url.startsWith('/api/')) {
      let content = '';
      for await (const chunk of request) content += chunk;
      if (inference && request.method === 'POST') {
        const input = JSON.parse(content);
        mutations.push({ path: request.url, input });
        if (request.url === '/api/predict') custom = { predictions: input.smiles.map(smiles => ({ smiles, predicted: '1.25' })) };
        response.writeHead(200, { 'Content-Type': 'application/json' });
        const state = await fetch(`http://127.0.0.1:${port}/api/state`, { headers: { 'X-Pero-App-Token': secret } }).then(result => result.json());
        return response.end(JSON.stringify({ ...state, checkout: 'synthetic-model-seam', custom }));
      }
      const result = await fetch(`http://127.0.0.1:${port}${request.url}`, {
        method: request.method,
        headers: { 'Content-Type': 'application/json', 'X-Pero-App-Token': secret },
        ...(content ? { body: content } : {}),
      });
      response.writeHead(result.status, { 'Content-Type': 'application/json' });
      if (inference && request.url === '/api/state') return response.end(JSON.stringify({ ...await result.json(), checkout: 'synthetic-model-seam', custom }));
      return response.end(await result.text());
    }
    if (request.url === '/host/environment') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      const missing = { kind: 'python', major: 3, minor: 11, patch: null };
      return response.end(JSON.stringify({
        schema: 'pero.environment.inspection.v1', method: 'lcms2yield.inference', scope: 'configured-interpreter', evidence: 'metadata_only',
        observed_at_ms: Date.now(), matched: false, missing: [missing],
        profile: { id: 'a'.repeat(64), observation: { name: 'lcms2yield', python: { major: 3, minor: 14, patch: 7 }, system: 'Darwin', machine: 'arm64', interpreter_sha256: null, packages: { torch: null }, native: {} } },
        requirements: { method: 'lcms2yield.inference', required: [missing], preferred: [] },
      }));
    }
    if (request.url === '/app.js') { response.writeHead(200, { 'Content-Type': 'text/javascript' }); return response.end(bundle); }
    if (request.url === '/app.css') { response.writeHead(200, { 'Content-Type': 'text/css' }); return response.end(css); }
    if (request.url === '/app') { response.writeHead(200, { 'Content-Type': 'text/html' }); return response.end('<!doctype html><link rel="stylesheet" href="/app.css"><div id="app"></div><script type="module" src="/app.js"></script>'); }
    if (request.url === '/') {
      response.writeHead(200, { 'Content-Type': 'text/html' });
      return response.end(`<!doctype html><style>body{margin:0}iframe{position:fixed;inset:0;width:100%;height:100%;border:0}</style>
        <iframe title="LCMS2Yield" sandbox="allow-scripts allow-same-origin" src="/app"></iframe><script>
        window.hostNavigations=[];
        addEventListener('message',event=>{
          if(event.data?.type==='pero:app:ready')event.source.postMessage({type:'pero:app:context',context:{locale:'en',dark:false,active:true}},'*');
          if(event.data?.type==='pero:app:sdk'&&event.data.operation==='navigate'){
            hostNavigations.push(event.data.input.path);
            event.source.postMessage({type:'pero:app:sdk-result',id:event.data.id,ok:true},'*');
          }
        });</script>`);
    }
    response.writeHead(404); response.end();
  });
  await new Promise((resolveListen, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolveListen); });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', error => errors.push(error.message));
  t.after(async () => {
    if (!t.passed) await page.screenshot({ path: resolve(captures, 'failure.png'), fullPage: true }).catch(() => {});
    await page.close(); server.closeAllConnections();
    await new Promise(resolveClose => server.close(resolveClose));
    if (backend.exitCode === null) await new Promise(resolveStop => { backend.once('exit', resolveStop); backend.kill('SIGTERM'); });
    await rm(data, { recursive: true, force: true });
    assert.deepEqual(errors, []);
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  return { page, frame: page.frameLocator('iframe'), mutations };
}

test('released yield table is visible while the weight rerun and cluster jobs stay unset', async t => {
  const { page, frame } = await fixture(t);
  await expect(frame.getByText('Matches 4.74', { exact: true })).toBeVisible();
  await expect(frame.getByText('Not run', { exact: true })).toBeVisible();
  await expect(frame.getByText('Unsettled', { exact: true })).toBeVisible();
  await expect(frame.locator('.yield-plot circle')).toHaveCount(178);
  await expect(frame.getByText('Mean absolute error 4.74 percentage points', { exact: true })).toBeVisible();
  await expect(frame.getByRole('button', { name: 'Run prediction', exact: true })).toBeDisabled();
  await expect(frame.getByText('Not connected', { exact: true })).toBeVisible();
  await frame.locator('.yield-rows button').nth(1).click();
  await expect(frame.getByText('Structure drawing needs RDKit', { exact: false })).toBeVisible();
  await frame.getByRole('button', { name: 'Software environments', exact: true }).click();
  await frame.getByRole('button', { name: 'Compute', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.hostNavigations)).toEqual(['/apps/environments', '/apps/compute']);
  await page.screenshot({ path: resolve(captures, 'yield-table-light.png'), fullPage: true });
});


test('reaction filters and CSV uploads preserve the selected input', async t => {
  const { page, frame, mutations } = await fixture(t, true);
  await frame.getByRole('button', { name: 'Dataset', exact: true }).click();
  await frame.getByRole('option', { name: 'SN2 · 30', exact: true }).click();
  await expect(frame.locator('.yield-plot circle')).toHaveCount(30);
  await frame.getByRole('button', { name: 'Run prediction', exact: true }).click();
  await frame.getByRole('button', { name: 'Run once', exact: true }).click();
  assert.deepEqual(mutations[0], { path: '/api/rerun', input: { confirm: true, reactionType: 'SN2' } });
  const upload = async (name, text) => frame.locator('input[type=file]').setInputFiles({ name, mimeType: 'text/csv', buffer: Buffer.from(text) });
  await upload('first.csv', 'name,SMILES\n"sample, one",CCO');
  await frame.getByRole('button', { name: 'Run prediction', exact: true }).click();
  await frame.getByRole('button', { name: 'Run once', exact: true }).click();
  await expect(frame.getByText('CCO · 1.25', { exact: true })).toBeVisible();
  await upload('second.csv', 'SMILES\nCO');
  await expect(frame.getByText('CCO · 1.25', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: resolve(captures, 'upload-input-light.png'), fullPage: true });
  await page.setViewportSize({ width: 640, height: 900 });
  await page.evaluate(() => document.querySelector('iframe').contentWindow.postMessage({type:'pero:app:context',context:{locale:'en',dark:true,active:true}}, '*'));
  await expect(frame.locator('html')).toHaveAttribute('data-theme', 'pero-dark');
  await page.screenshot({ path: resolve(captures, 'upload-input-dark-narrow.png'), fullPage: true });
  await upload('too-many.csv', 'SMILES\n' + 'CCO\n'.repeat(33));
  await frame.getByText('Error details', { exact: true }).click();
  await expect(frame.getByText(/Upload at most 32 nonempty SMILES/)).toBeVisible();
  assert.equal(mutations.length, 2);
});

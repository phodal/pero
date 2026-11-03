// Opt-in browser UI acceptance: real Python + PLR, sandboxed App iframe, no LLM.
// This is not Desktop lifecycle or real-provider acceptance. Run on a GUI-capable
// executor: LAB_TEST_PYTHON=/path/to/python3.12 node apps/lab/test/browser-smoke.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { chromium, expect } from '@playwright/test';

const root = resolve(import.meta.dirname, '../../..');
const python = process.env.LAB_TEST_PYTHON;
if (!python) throw new Error('Set LAB_TEST_PYTHON to a prepared CPython 3.12 with pinned PyLabRobot.');
const output = resolve(root, 'test-results/lab-browser');
await mkdir(output, { recursive: true });
const data = await mkdtemp(resolve(tmpdir(), 'pero-lab-ui-'));
const token = randomUUID();
let backend, browser, appServer, parentServer, port;
const failures = [];
async function startBackend() {
  backend = spawn(python, ['apps/lab/backend/server.py'], { cwd: root, env: { ...process.env, PERO_APP_DATA: data, PERO_APP_TOKEN: token }, stdio: ['ignore', 'pipe', 'pipe'] });
  const lines = createInterface({ input: backend.stdout });
  port = await new Promise((done, reject) => {
    const timer = setTimeout(() => reject(new Error('Lab backend readiness timeout')), 15000);
    backend.once('error', reject);
    backend.once('exit', code => { clearTimeout(timer); reject(new Error(`Backend exited before readiness: ${code}`)); });
    lines.on('line', line => { try { const value = JSON.parse(line); if (value.port) { clearTimeout(timer); done(value.port); } } catch {} });
  });
}
async function stopBackend() {
  if (backend.exitCode != null) return;
  const exited = once(backend, 'exit'); backend.kill('SIGTERM'); await exited;
}
async function listen(server) { server.listen(0, '127.0.0.1'); await once(server, 'listening'); return server.address().port; }
try {
  await startBackend();
  appServer = createServer(async (request, response) => {
    try {
      const path = new URL(request.url, 'http://localhost').pathname;
      if (path.startsWith('/api/')) {
        const chunks = []; for await (const chunk of request) chunks.push(chunk);
        const upstream = await fetch(`http://127.0.0.1:${port}${path}`, { method: request.method, headers: { 'Content-Type': 'application/json', 'X-Pero-App-Token': token }, ...(request.method === 'POST' ? { body: Buffer.concat(chunks) } : {}) });
        response.writeHead(upstream.status, { 'Content-Type': 'application/json' }); response.end(await upstream.text()); return;
      }
      const name = path === '/' ? 'index.html' : path.slice(1);
      if (!['index.html', 'index.js', 'index.css'].includes(name)) { response.writeHead(404).end(); return; }
      response.setHeader('Content-Type', { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[extname(name)]);
      response.end(await readFile(resolve(root, 'apps/lab/dist', name)));
    } catch (error) { response.writeHead(500).end(String(error)); }
  });
  const appPort = await listen(appServer);
  parentServer = createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html');
    response.end(`<!doctype html><style>body{margin:0}iframe{width:100vw;height:100vh;border:0}</style><iframe title="lab" sandbox="allow-scripts allow-same-origin allow-downloads allow-popups" src="http://127.0.0.1:${appPort}"></iframe><script>window.dark=false;window.context=()=>document.querySelector('iframe').contentWindow.postMessage({type:'pero:app:context',context:{locale:'en',dark:window.dark,active:true}},'*');window.addEventListener('message',event=>{if(event.data?.type==='pero:app:ready')window.context()})</script>`);
  });
  const parentPort = await listen(parentServer);
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1240, height: 900 } });
  page.on('pageerror', error => failures.push(error.message));
  await page.goto(`http://127.0.0.1:${parentPort}`);
  const frame = page.frameLocator('iframe[title=lab]');
  await expect(frame.getByRole('button', { name: 'Freeze experiment', exact: true })).toBeEnabled();
  await page.screenshot({ path: resolve(output, 'empty-light.png') });
  await frame.getByRole('button', { name: 'Freeze experiment', exact: true }).click();
  await expect(frame.getByRole('heading', { name: 'Candidate draft', exact: true })).toBeVisible();
  await frame.getByRole('button', { name: 'Add step', exact: true }).click();
  await expect(frame.getByRole('textbox', { name: 'Step 9 resource', exact: true })).toHaveValue('T3');
  await frame.getByRole('button', { name: 'Remove step', exact: true }).click();
  await frame.getByRole('button', { name: 'Edit step 2', exact: true }).click();
  await frame.getByRole('spinbutton', { name: 'Step 2 volume in microliters', exact: true }).fill('40');
  await expect(frame.getByText('Aspirate 40 µL from A1', { exact: true })).toBeVisible();
  await frame.getByRole('spinbutton', { name: 'Step 2 volume in microliters', exact: true }).fill('50');
  await frame.getByRole('button', { name: 'Remove step', exact: true }).click();
  await frame.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(frame.getByText('Aspirate 50 µL from A1', { exact: true })).toBeVisible();
  await frame.getByRole('button', { name: 'JSON', exact: true }).click();
  const initialEditor = frame.getByRole('textbox', { name: 'Protocol JSON', exact: true });
  const initialDraft = await initialEditor.inputValue();
  await initialEditor.fill('{ invalid JSON');
  await frame.getByRole('button', { name: 'Save candidate', exact: true }).click();
  await expect(frame.getByRole('alert')).toContainText('Protocol must be valid JSON.');
  await page.screenshot({ path: resolve(output, 'invalid-protocol.png') });
  await initialEditor.fill(initialDraft);
  async function runCandidate() {
    await frame.getByRole('button', { name: 'Save candidate', exact: true }).click();
    await expect(frame.getByRole('button', { name: 'Validate', exact: true })).toBeEnabled();
    await frame.getByRole('button', { name: 'Validate', exact: true }).click();
    await expect(frame.getByRole('button', { name: 'Run simulation', exact: true })).toBeEnabled();
    await frame.getByRole('button', { name: 'Run simulation', exact: true }).click();
    await expect(frame.getByRole('heading', { name: 'Execution completed', exact: true })).toBeVisible();
    await frame.getByRole('tab', { name: 'Results', exact: true }).click();
    await frame.getByRole('button', { name: 'Attach synthetic fixture', exact: true }).click();
    await expect(frame.getByText('synthetic observation', { exact: true })).toBeVisible();
    await frame.getByRole('button', { name: 'Evaluate', exact: true }).click();
  }
  await runCandidate();
  await expect(frame.getByRole('heading', { name: 'Independent verification: FAIL', exact: true })).toBeVisible();
  await frame.getByRole('button', { name: 'Revise from feedback', exact: true }).click();
  await frame.getByRole('button', { name: 'JSON', exact: true }).click();
  const editor = frame.getByRole('textbox', { name: 'Protocol JSON', exact: true });
  const protocol = JSON.parse(await editor.inputValue());
  for (const index of [1, 2]) protocol.steps[index].volume_ul = 40;
  for (const index of [5, 6]) protocol.steps[index].volume_ul = 60;
  await editor.fill(JSON.stringify(protocol, null, 2));
  await frame.getByRole('textbox', { name: 'Revision rationale', exact: true }).fill('Compensate for the explicitly synthetic +0.1 fraction bias.');
  await runCandidate();
  await expect(frame.getByRole('heading', { name: 'Independent verification: PASS', exact: true })).toBeVisible();
  await frame.getByRole('button', { name: 'Compare trials', exact: true }).click();
  await expect(frame.getByText('Improved', { exact: true })).toBeVisible();
  await frame.getByRole('textbox', { name: 'Review rationale', exact: true }).fill('Accept only this illustrative software demonstration, not physical validity.');
  await frame.getByRole('button', { name: 'Accept trial', exact: true }).evaluate(button => button.click());
  await expect(frame.getByRole('alert')).toContainText('Review requires a direct UI interaction.');
  await frame.getByRole('button', { name: 'Accept trial', exact: true }).click();
  const download = page.waitForEvent('download');
  await frame.getByRole('button', { name: 'Export JSON', exact: true }).click();
  const saved = await download; await saved.saveAs(resolve(output, 'export.json'));
  const report = JSON.parse(await readFile(resolve(output, 'export.json'), 'utf8'));
  assert.equal(report.experiment.trials.length, 2);
  assert.equal(report.experiment.trials[1].parent_trial_id, report.experiment.trials[0].id);
  assert.equal(report.experiment.trials[1].events.length, 8);
  await frame.getByRole('tab', { name: 'Deck', exact: true }).click();
  await expect(frame.getByRole('button', { name: 'B1, 100 microliters', exact: true })).toBeVisible();
  await page.screenshot({ path: resolve(output, 'deck-light.png') });
  await page.evaluate(() => { window.dark = true; window.context(); });
  await expect.poll(() => frame.locator('body').evaluate(() => document.documentElement.style.colorScheme)).toBe('dark');
  await page.screenshot({ path: resolve(output, 'deck-dark.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: resolve(output, 'deck-narrow.png') });
  await stopBackend(); await startBackend();
  await page.reload();
  await frame.getByRole('combobox', { name: 'Saved experiments', exact: true }).selectOption(report.experiment.id);
  await frame.getByRole('tab', { name: 'Runs', exact: true }).click();
  await expect(frame.getByRole('heading', { name: 'Execution completed', exact: true })).toBeVisible();
  const restored = await fetch(`http://127.0.0.1:${port}/api/experiments/${report.experiment.id}`, { headers: { 'X-Pero-App-Token': token } }).then(r => r.json());
  assert.deepEqual(restored.trials, report.experiment.trials);
  assert.deepEqual(failures, []);
  await writeFile(resolve(output, 'result.json'), JSON.stringify({ passed: true, scope: 'Sandboxed browser UI + real PLR, not Desktop or real provider', checks: ['freeze', 'two linked trials', 'FAIL then PASS', 'comparison', 'review', 'export', 'light/dark/narrow', 'backend restart without replay'] }, null, 2));
} finally {
  if (browser) await browser.close();
  if (appServer) await new Promise(done => appServer.close(done));
  if (parentServer) await new Promise(done => parentServer.close(done));
  if (backend && backend.exitCode == null) await stopBackend();
  await rm(data, { recursive: true, force: true });
}

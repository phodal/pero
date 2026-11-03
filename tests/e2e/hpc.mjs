// Real Electron -> Host -> Python -> ReFrame -> fixed CPU methods -> independent checker.
// Local reference acceptance only; no model request, Slurm, MPI or OpenFOAM run.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { expect } from '@playwright/test';
import { electron } from './electron.mjs';
import { clickAppOpen, clickAppShortcut } from './sidebar-controls.mjs';

const root = resolve(import.meta.dirname, '../..');
const out = resolve(root, 'test-results/hpc');
const execute = promisify(execFile);
const python = process.env.PERO_APP_PYTHON || 'python3';
const { stdout: runtime } = await execute(python, ['-c', 'import sys,importlib.metadata,json; print(json.dumps({"root":sys.prefix,"version":importlib.metadata.version("reframe-hpc")}))']);
const interpreter = JSON.parse(runtime);
expect(interpreter.version).toBe('4.10.4');
const profile = await mkdtemp(resolve(tmpdir(), 'pero-hpc-e2e-'));
await mkdir(out, { recursive: true });
await writeFile(resolve(profile, 'settings.json'), JSON.stringify({ workbench: { appearance: 'light' }, app_python: { apps: { hpc: interpreter.root } } }));
const env = { ...process.env, PERO_APP_PYTHON: python, PERO_BUILTIN_APPS: 'hpc',
  PERO_DESKTOP_DATA_DIR: profile, PERO_LOCALE: 'en',
  PERO_SETTINGS_PATH: resolve(profile, 'settings.json'), PERO_HISTORY_PATH: resolve(profile, 'history.jsonl') };
delete env.ELECTRON_RUN_AS_NODE;
delete env.PERO_APPS_ROOT;
let app, page, frame;
const checks = [], errors = [];
const state = () => page.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()));
const get = path => frame.locator('body').evaluate(async (_, path) => {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  return response.json();
}, path);
const post = (path, body) => frame.locator('body').evaluate(async (_, { path, body }) => {
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}, { path, body });
async function open() {
  app = await electron.launch({ args: [...(process.platform === 'darwin' ? ['--use-mock-keychain'] : []), resolve(root, 'desktop')], cwd: root, env });
  page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1488, 1000));
  await page.waitForFunction(() => window.peroDiagnostics && !document.getElementById('loading'), undefined, { timeout: 60000 });
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('locale-en').click());
  await expect.poll(async () => (await state()).apps?.some(item => item.name === 'hpc')).toBe(true);
  await clickAppShortcut(page, 'apps');
  await expect.poll(async () => (await state()).appsLoading).toBe(false);
  await clickAppOpen(page, 'hpc');
  frame = page.frameLocator('iframe[title="hpc"]');
  await expect(frame.getByRole('heading', { name: 'HPC Benchmarks', exact: true })).toBeVisible({ timeout: 30000 });
  await expect.poll(async () => (await get('/api/state')).runtime.reframeAvailable).toBe(true);
  const setup = page.getByRole('button', { name: 'Hide', exact: true });
  if (await setup.isVisible()) await setup.click();
}
async function run(benchmark) {
  await frame.getByRole('button', { name: benchmark.name, exact: true }).click();
  const request = page.waitForResponse(response => new URL(response.url()).pathname === '/api/runs' && response.request().method() === 'POST');
  await frame.getByRole('button', { name: 'Run local reference', exact: true }).click();
  const response = await request;
  expect(response.status()).toBe(202);
  const { run: started } = await response.json();
  let finished;
  await expect.poll(async () => {
    finished = (await get(`/api/runs/${started.id}`)).run;
    return finished.operation;
  }, { timeout: 120000, intervals: [100, 250, 500] }).toBeNull();
  expect(finished.status, finished.error || finished.logs).toBe('completed');
  expect(finished.verification?.status).toBe('pass');
  expect(finished.artifacts.some(item => item.name.includes('raw/'))).toBe(true);
  expect(finished.reframeVersion).toBe('4.10.4');
  await expect(frame.getByRole('button', { name: 'Verify saved evidence', exact: true })).toBeEnabled({ timeout: 15000 });
  await expect(frame.getByRole('img', { name: /Integrand samples|Numerical solution/ })).toBeVisible();
  return finished;
}
async function openHistory() {
  const history = frame.locator('.run-history');
  if (await history.getAttribute('open') === null) await history.locator('summary').click();
}
try {
  await open();
  const initial = await get('/api/state');
  expect(initial.runs).toEqual([]);
  expect(initial.benchmarks.filter(item => item.available).length).toBeGreaterThanOrEqual(2);
  expect(await frame.locator('body').evaluate(() => typeof window.pero)).toBe('undefined');
  await page.screenshot({ path: resolve(out, 'library-light.png') });
  checks.push('Host builtin discovery, authenticated App backend, empty library and isolated iframe');

  const methods = initial.benchmarks.filter(item => item.available);
  const first = await run(methods[0]);
  await page.screenshot({ path: resolve(out, 'verified-light.png') });
  const recheck = page.waitForResponse(response => new URL(response.url()).pathname === `/api/runs/${first.id}/verify` && response.request().method() === 'POST');
  await frame.getByRole('button', { name: 'Verify saved evidence', exact: true }).click();
  expect((await recheck).status()).toBe(202);
  await expect.poll(async () => (await get(`/api/runs/${first.id}`)).run.operation).toBeNull();
  expect((await get(`/api/runs/${first.id}`)).run.verification.status).toBe('pass');
  const second = await run(methods[0]);
  const other = await run(methods[1]);
  await page.screenshot({ path: resolve(out, 'poisson-plot.png') });
  checks.push('Two real ReFrame methods, repeat execution, original raw output and independent re-verification');

  const exported = resolve(out, 'evidence.zip');
  await rm(exported, { force: true });
  await app.evaluate(({ session }, path) => session.defaultSession.once('will-download', (_, item) => item.setSavePath(path)), exported);
  await frame.getByRole('button', { name: 'Export evidence ZIP', exact: true }).click();
  await expect.poll(async () => { try { return (await readFile(exported)).length; } catch { return 0; } }).toBeGreaterThan(100);
  const unpacked = resolve(profile, 'offline');
  await execute(python, ['-c', 'import sys,zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])', exported, unpacked]);
  const verified = await execute(python, [resolve(unpacked, 'bundle/verify.py'), resolve(unpacked, 'bundle')]);
  expect(JSON.parse(verified.stdout).status).toBe('pass');
  checks.push('Actual Desktop ZIP download and independent offline verification without ReFrame invocation');

  await openHistory();
  await frame.getByRole('checkbox', { name: `Select for comparison: ${first.id}`, exact: true }).check();
  await frame.getByRole('checkbox', { name: `Select for comparison: ${second.id}`, exact: true }).check();
  await frame.getByRole('button', { name: /^Compare selected runs/ }).click();
  await expect(frame.getByRole('tab', { name: /^Compare/ })).toHaveAttribute('aria-selected', 'true');
  const comparable = await post('/api/compare', { runIds: [first.id, second.id] });
  expect(comparable.body.comparison.comparable).toBe(true);
  const incompatible = await post('/api/compare', { runIds: [first.id, other.id] });
  expect(incompatible.body.comparison.comparable).toBe(false);
  await page.screenshot({ path: resolve(out, 'comparison.png') });
  checks.push('Same-spec result comparison and explicit incompatible-method rejection');

  const unavailable = initial.benchmarks.find(item => !item.available);
  await frame.getByRole('button', { name: unavailable.name, exact: true }).click();
  await expect(frame.getByRole('button', { name: 'Run benchmark', exact: true })).toBeDisabled();
  await expect(frame.locator('.unavailable-note')).toBeVisible();
  const rejected = await post('/api/runs', { benchmarkId: unavailable.id });
  expect(rejected.status).toBeGreaterThanOrEqual(400);
  expect((await get('/api/state')).runs).toHaveLength(3);
  checks.push('Unavailable OpenFOAM/Slurm remains visible and cannot create a fake execution');

  await frame.getByRole('button', { name: methods[0].name, exact: true }).click();
  const separator = frame.getByRole('separator', { name: 'Benchmarks', exact: true });
  await separator.focus();
  await separator.press('ArrowRight');
  const preferences = { ...(await state()).preferences, appearance: 'dark' };
  await page.evaluate(preferences => window.pero.sessionCommand({ method: 'settings.workbench', preferences }), preferences);
  await expect.poll(async () => (await state()).dark).toBe(true);
  await expect.poll(() => frame.locator('html').evaluate(element => element.style.colorScheme)).toBe('dark');
  await page.screenshot({ path: resolve(out, 'library-dark.png') });
  await frame.getByRole('tab', { name: 'Results', exact: true }).click();
  await openHistory();
  await frame.getByRole('button', { name: `Inspect: ${other.id}`, exact: true }).click();
  await expect(frame.getByRole('img', { name: /Numerical solution/ })).toBeVisible();
  await page.screenshot({ path: resolve(out, 'results-dark.png') });
  await frame.getByRole('button', { name: methods[0].name, exact: true }).click();
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('locale-zh-CN').click());
  await expect(frame.getByRole('heading', { name: 'HPC 基准', exact: true })).toBeVisible();
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setMinimumSize(480, 680);
    window.setSize(720, 900);
  });
  await expect.poll(() => frame.locator('html').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await expect(frame.getByRole('separator')).toHaveCount(0);
  await page.screenshot({ path: resolve(out, 'narrow-zh.png') });
  checks.push('Light/dark, live Chinese locale, keyboard split resizing and narrow stacked layout');

  await app.evaluate(({ BrowserWindow, Menu }) => {
    BrowserWindow.getAllWindows()[0].setSize(1488, 1000);
    Menu.getApplicationMenu().getMenuItemById('locale-en').click();
  });
  await frame.getByRole('tab', { name: 'Results', exact: true }).click();
  await openHistory();
  await frame.getByRole('button', { name: `Inspect: ${other.id}`, exact: true }).click();
  const samples = resolve(profile, `app-data/hpc/runs/${other.id}/bundle/raw/samples-128.csv`);
  await writeFile(samples, 'invalid observed sample\n');
  const damagedRecheck = page.waitForResponse(response => new URL(response.url()).pathname === `/api/runs/${other.id}/verify` && response.request().method() === 'POST');
  await frame.getByRole('button', { name: 'Verify saved evidence', exact: true }).click();
  expect((await damagedRecheck).status()).toBe(202);
  await expect.poll(async () => (await get(`/api/runs/${other.id}`)).run.operation).toBeNull();
  expect((await get(`/api/runs/${other.id}`)).run.verification.status).toBe('incomplete');
  await expect(frame.getByRole('region', { name: 'Run details', exact: true }).getByText('Incomplete', { exact: true })).toBeVisible();
  await page.screenshot({ path: resolve(out, 'incomplete-evidence.png') });
  checks.push('Damaged original samples replace the old PASS with visible incomplete evidence');

  await app.close(); app = undefined;
  await open();
  expect((await get('/api/state')).runs).toHaveLength(3);
  expect((await get(`/api/runs/${first.id}`)).run.verification.status).toBe('pass');
  checks.push('Desktop restart retains completed records, original evidence and verification');
  await frame.getByRole('button', { name: 'Discuss with Agent', exact: true }).click();
  await expect.poll(async () => (await state()).appChatOpen).toBe(true);
  await expect.poll(async () => (await state()).composer).toContain('Review HPC benchmark');
  checks.push('App context enters the existing shared Chat draft without submitting a model request');
  expect(errors).toEqual([]);
  await writeFile(resolve(out, 'result.json'), JSON.stringify({ level: 'local-reference-development', checks, errors }, null, 2));
  console.log(JSON.stringify({ checks, errors }));
} catch (error) {
  if (page && !page.isClosed()) {
    await page.screenshot({ path: resolve(out, 'failure.png') }).catch(() => {});
    await writeFile(resolve(out, 'failure.txt'), String(error.stack || error));
  }
  throw error;
} finally {
  if (app) await app.close();
  await rm(profile, { recursive: true, force: true });
}

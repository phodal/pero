// Real Electron -> GPUI -> Host -> unmodified Python backend. Sample data only.
// Requires current development builds and the normal electron.mjs launcher.
// This is not App Use/native-screen acceptance or public Norman validation.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

const root = resolve(import.meta.dirname, '../..');
const out = resolve(root, 'test-results/virtual-cell-comparison');
await mkdir(out, { recursive: true });
// Clear success even if loading Playwright or the development build fails.
await rm(resolve(out, 'result.json'), { force: true });
await rm(resolve(out, 'failure.json'), { force: true });
await rm(resolve(out, 'failure-app-data'), { recursive: true, force: true });
const execute = promisify(execFile);
const python = process.env.PERO_APP_PYTHON || 'python3';
const checks = [], errors = [], requests = [], runEvidence = {}, cleanup = [];
const sampleText = 'Sample data. Demonstration only, not a real Norman validation.';
const activeStatuses = ['starting', 'running', 'cancelling'];
let expect, electron, clickAppOpen, setAppearance, temp, profile, app, page, frame, manifest, failure;

const state = () => page.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()));
const read = path => frame.locator('body').evaluate(async (_body, path) => {
  const response = await fetch(path); // GET evidence only; mutations use controls.
  if (!response.ok) throw new Error(`GET ${path}: ${response.status}`);
  return response.json();
}, path);
const runPath = id => `/api/comparisons/${id}`;
const comparisonPosts = () => requests.filter(item => item.method === 'POST' && item.path.startsWith('/api/comparisons'));
const record = run => { runEvidence[run.id] = run; return run; };
const alive = pid => {
  try { process.kill(pid, 0); return true; }
  catch (error) { if (error.code === 'ESRCH') return false; throw error; }
};

function observe(current) {
  current.on('pageerror', error => errors.push({ type: 'pageerror', message: error.message }));
  current.on('console', message => {
    if (message.type() === 'error') errors.push({ type: 'console', message: message.text(), url: message.location().url });
  });
  current.on('request', request => {
    const url = new URL(request.url());
    if (url.protocol === 'pero-app:' && url.hostname === 'virtual-cell' && url.pathname.startsWith('/api/')) {
      // No request bodies, backend credentials or provider data in receipts.
      requests.push({ method: request.method(), path: url.pathname });
    }
  });
}

async function painted() {
  await page.waitForFunction(() => {
    const canvas = document.querySelector('canvas');
    return canvas?.width === Math.round(innerWidth * devicePixelRatio) && canvas.height === Math.round(innerHeight * devicePixelRatio);
  });
  await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
}

async function openComparison() {
  await page.waitForFunction(() => window.peroDiagnostics && !document.getElementById('loading'), undefined, { timeout: 60000 });
  await expect.poll(async () => (await state()).apps?.some(item => item.name === 'virtual-cell')).toBe(true);
  await painted();
  await page.mouse.click(80, await page.evaluate(() => innerHeight - 55));
  await expect.poll(async () => (await state()).navigation).toBe(7);
  await expect.poll(async () => (await state()).appsLoading).toBe(false);
  await painted();
  await clickAppOpen(page, 'virtual-cell');
  await expect.poll(async () => (await state()).activeContent).toEqual({ kind: 'app', value: { name: 'virtual-cell', panel: 'main' } });
  frame = page.frameLocator('iframe[title="virtual-cell"]');
  await expect(frame.getByLabel('Data view', { exact: true })).toBeVisible({ timeout: 20000 });
  await frame.getByLabel('Data view', { exact: true }).selectOption('comparison');
  await expect(frame.getByRole('region', { name: 'Baseline comparison', exact: true })).toBeVisible();
  await expect(frame.getByText('Non-blind. Condition means. Isolation unverified. Not reviewed.', { exact: true })).toBeVisible();
  await expect.poll(async () => (await read('/api/comparisons')).availability.available).toBe(true);
}

async function importSample(name) {
  const reply = page.waitForResponse(response => response.url().endsWith('/api/inputs') && response.request().method() === 'POST');
  const chooser = page.waitForEvent('filechooser');
  await frame.getByRole('button', { name: 'Import a prepared dataset', exact: true }).click();
  await (await chooser).setFiles(manifest.files[name].path);
  const response = await reply;
  expect(response.status()).toBe(201);
  const input = await response.json();
  await expect(frame.getByLabel('Input revision', { exact: true })).toHaveValue(input.id);
  await expect(frame.getByText(sampleText, { exact: true }).first()).toBeVisible();
  await expect(frame.getByRole('button', { name: 'Start comparison', exact: true })).toBeEnabled();
  expect(input.source).toEqual(manifest.files[name].source);
  return input;
}

async function start(button = 'Start comparison') {
  const response = page.waitForResponse(response => response.url().endsWith('/api/comparisons') && response.request().method() === 'POST');
  await frame.getByRole('button', { name: button, exact: true }).click();
  const reply = await response;
  expect(reply.status()).toBe(202);
  return record(await reply.json());
}

async function completed(id, status = 'succeeded') {
  let run;
  await expect.poll(async () => {
    run = record(await read(runPath(id)));
    return activeStatuses.includes(run.status) ? null : run.status;
  }, { timeout: 30000, intervals: [100, 200, 500] }).toBe(status);
  expect(run.process.exitObserved).toBe(true);
  expect(run.process.exitCode).toBe(status === 'succeeded' ? 0 : 2);
  await expect(frame.locator('.vc-comparison-detail > .pero-ui-toolbar > [role="status"]')).toHaveText(status === 'succeeded' ? 'Calculation completed' : 'Failed');
  expect(alive(run.process.pid)).toBe(false);
  return run;
}

async function selectRun(id, keyboard = false) {
  const button = frame.getByRole('complementary', { name: 'Run history', exact: true })
    .getByRole('button', { name: new RegExp(`\\(${id.slice(0, 8)}\\)`) });
  if (keyboard) {
    await button.focus();
    await expect(button).toBeFocused();
    await button.press('Enter');
  } else await button.click();
  await expect(frame.locator('.vc-comparison-detail').getByRole('heading', { name: `Run ${id.slice(0, 8)}`, exact: true })).toBeVisible();
  await expect(frame.locator('.vc-comparison-history li[aria-current="true"]')).toContainText(id.slice(0, 8));
}

async function exportRun(id, filename) {
  const path = resolve(out, filename);
  await rm(path, { force: true });
  // Native download destination only; the export itself is a normal App click.
  await app.evaluate(({ session }, path) => session.defaultSession.once('will-download', (_event, item) => item.setSavePath(path)), path);
  await frame.getByRole('button', { name: 'Export run package', exact: true }).click();
  let document;
  await expect.poll(async () => {
    try { document = JSON.parse(await readFile(path, 'utf8')); return document.run.id; }
    catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) return null; throw error; }
  }).toBe(id);
  expect(document.schema).toBe('pero.virtual-cell.local-comparison-export.v1');
  return { path, document };
}

async function assertFrozen(first, output) {
  expect(await read(runPath(first.id))).toEqual(first);
  expect(await read(`/api/artifacts/${first.outputId}`)).toEqual(output);
}

async function screenshot(name) {
  const label = frame.getByText(sampleText, { exact: true }).first();
  await label.scrollIntoViewIfNeeded();
  await expect(label).toBeInViewport();
  await page.screenshot({ path: resolve(out, name) });
}

async function closeDesktop() {
  if (!app) return;
  const current = app;
  const pid = current.process().pid;
  const closeErrors = [];
  let tree = [];
  try {
    const { stdout } = await execute('ps', ['-axo', 'pid=,ppid='], { encoding: 'utf8' });
    tree = stdout.trim().split('\n').map(line => line.trim().split(/\s+/).map(Number));
  } catch (error) { closeErrors.push(error); }
  const owned = new Set([pid]);
  for (let changed = true; changed;) {
    changed = false;
    for (const [child, parent] of tree) if (owned.has(parent) && !owned.has(child)) { owned.add(child); changed = true; }
  }
  for (const run of Object.values(runEvidence)) if (activeStatuses.includes(run.status) && run.process.pid && alive(run.process.pid)) owned.add(run.process.pid);
  try { await current.close(); } catch (error) { closeErrors.push(error); }
  app = undefined;
  try { await expect.poll(() => [...owned].filter(alive), { timeout: 10000 }).toEqual([]); }
  catch (error) {
    closeErrors.push(error);
    // A failed shutdown must not leak this suite's observed descendants. This
    // recovery never turns a failed normal shutdown into a passing receipt.
    for (const signal of ['SIGTERM', 'SIGKILL']) {
      for (const child of [...owned].filter(alive)) {
        try { process.kill(child, signal); } catch (killError) { if (killError.code !== 'ESRCH') closeErrors.push(killError); }
      }
      try { await expect.poll(() => [...owned].filter(alive), { timeout: 10000 }).toEqual([]); break; }
      catch (waitError) { closeErrors.push(waitError); }
    }
  }
  cleanup.push({ electronPid: pid, ownedPids: [...owned], allExited: [...owned].every(child => !alive(child)), recoveredShutdown: closeErrors.length > 0 });
  if (closeErrors.length) throw new AggregateError(closeErrors, 'Desktop or backend cleanup failed; no success receipt');
}

async function saveFailure(error) {
  const evidence = { status: 'failed', scope: 'synthetic-development-only', publicNormanValidation: false,
    error: String(error.stack || error), checks, errors, requests, runs: runEvidence, cleanup };
  if (page && !page.isClosed()) {
    try { evidence.desktop = await state(); } catch (capture) { evidence.stateCaptureError = String(capture); }
    try { await page.screenshot({ path: resolve(out, 'failure.png') }); } catch (capture) { evidence.screenshotError = String(capture); }
    try { evidence.appText = await frame.locator('body').innerText(); } catch (capture) { evidence.appCaptureError = String(capture); }
  }
  await writeFile(resolve(out, 'failure.json'), JSON.stringify(evidence, null, 2));
}

try {
  ({ expect } = await import('@playwright/test'));
  ({ electron } = await import('./electron.mjs'));
  ({ clickAppOpen, setAppearance } = await import('./sidebar-controls.mjs'));
  if (!['linux', 'darwin'].includes(process.platform)) throw new Error('Comparison CPU execution currently requires Linux or macOS. This is not a skipped success.');
  temp = await mkdtemp(resolve(tmpdir(), 'pero-comparison-e2e-'));
  profile = resolve(temp, 'desktop');
  const generated = await execute(python, ['-E', '-s', resolve(root, 'tests/fixtures/virtual-cell-comparison.py'), resolve(temp, 'inputs')], { encoding: 'utf8', timeout: 30000 });
  manifest = JSON.parse(generated.stdout);
  await writeFile(resolve(out, 'sample-manifest.json'), JSON.stringify(manifest, null, 2));
  const agents = resolve(temp, 'agents.json');
  await writeFile(agents, JSON.stringify(['pero', 'codex', 'claude', 'copilot', 'grok', 'qoder', 'opencode'].map(id => ({ id, name: id, command: resolve(temp, `unavailable-${id}`) }))));
  const env = { ...process.env, PERO_DESKTOP_DATA_DIR: profile, PERO_LOCALE: 'en', PERO_AGENTS_FILE: agents,
    PERO_SETTINGS_PATH: resolve(temp, 'settings.json'), PERO_HISTORY_PATH: resolve(temp, 'history.jsonl') };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.PERO_APPS_ROOT;
  const launch = async () => {
    app = await electron.launch({ args: [...(process.platform === 'darwin' ? ['--use-mock-keychain'] : []), resolve(root, 'desktop')], cwd: root, env });
    page = await app.firstWindow();
    observe(page);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1488, 1086));
  };
  await launch();
  await openComparison();
  await expect(frame.getByText('No prepared dataset imported', { exact: true })).toBeVisible();
  expect((await read('/api/comparisons')).items).toEqual([]);
  const input = await importSample('prepared');
  const first = await completed((await start()).id);
  expect(first.inputId).toBe(input.id);
  expect(first.scope).toBe('app_local');
  expect(first.isolation).toBe('unverified');
  expect(first.acceptance).toBe('not_reviewed');
  expect(first.logs).toContain('Computed additive:');
  const output = await read(`/api/artifacts/${first.outputId}`);
  const testIds = manifest.files.prepared.testIds;
  expect(output.predictions.map(item => item.model.id)).toEqual(['control', 'train_mean', 'additive']);
  expect(output.result.models.map(item => item.model.id)).toEqual(['control', 'train_mean', 'additive']);
  for (const model of output.result.models) {
    expect(model.denominator).toEqual({ attempted: testIds.length, evaluated: testIds.length, failed: 0 });
    expect(model.conditions.map(item => item.id)).toEqual(testIds);
    expect(model.predictions_digest).toBe(output.predictions.find(item => item.model.id === model.model.id).digest);
  }
  expect(output.result.denominators).toEqual({ ...manifest.files.prepared.counts, excluded: manifest.files.prepared.excluded });
  expect(output.result.blind).toBe(false);
  await expect(frame.locator('.vc-comparison-models tbody tr')).toHaveCount(3);
  await expect(frame.locator('.vc-comparison-conditions tbody tr')).toHaveCount(3 * testIds.length);
  expect(await frame.locator('.vc-comparison-models tbody tr td:nth-child(3)').allTextContents()).toEqual(Array(3).fill(`${testIds.length} / ${testIds.length}`));
  await frame.getByText('Exclusion reasons', { exact: true }).click();
  await expect(frame.getByText('low_support', { exact: true })).toBeVisible();
  checks.push('Visible import/start; actual Python exit 0; three baselines and complete test/exclusion denominators');

  await setAppearance(page, 'light');
  await expect.poll(() => frame.locator('html').evaluate(element => element.style.colorScheme)).toBe('light');
  await screenshot('sample-completed-light.png');
  const search = frame.getByLabel('Find condition', { exact: true });
  await search.fill(testIds[0]);
  await expect(frame.locator('.vc-comparison-conditions tbody tr')).toHaveCount(3);
  await search.press('Tab');
  await expect(frame.getByLabel('Model', { exact: true })).toBeFocused();
  await search.fill('');
  await setAppearance(page, 'dark');
  await expect.poll(() => frame.locator('html').evaluate(element => element.style.colorScheme)).toBe('dark');
  await screenshot('sample-completed-dark.png');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 788));
  await painted();
  await expect.poll(() => frame.locator('html').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await expect(frame.getByRole('button', { name: 'Export run package', exact: true })).toBeVisible();
  await screenshot('sample-completed-narrow.png');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1488, 1086));
  await setAppearance(page, 'light');
  checks.push('Sample data labels, light/dark/narrow screenshots, search and keyboard traversal');

  const second = await completed((await start('Rerun')).id);
  expect(second.id).not.toBe(first.id);
  expect(second.inputId).toBe(first.inputId);
  expect(second.outputId).toBe(first.outputId);
  await selectRun(first.id, true);
  await expect(frame.locator('.vc-comparison-models tbody tr')).toHaveCount(3);
  await assertFrozen(first, output);
  const exported = await exportRun(first.id, 'sample-run-export.json');
  expect(exported.document.run).toEqual(first);
  expect(exported.document.bundle.dataset.source).toEqual(manifest.files.prepared.source);
  expect(exported.document.output).toEqual(output);
  expect(Object.keys(first.sourceHashes)).toContain('evaluation.py');
  for (const [name, hash] of Object.entries(first.sourceHashes)) {
    expect(createHash('sha256').update(await readFile(resolve(root, 'apps/virtual-cell/backend', name))).digest('hex')).toBe(hash);
  }
  const recomputedPath = resolve(out, 'sample-recomputed.json');
  await rm(recomputedPath, { force: true });
  const cli = await execute(python, ['-E', '-s', resolve(root, 'apps/virtual-cell/backend/cli.py'), 'compare', '--bundle', exported.path, '--out', recomputedPath], { encoding: 'utf8', timeout: 30000 });
  const recomputed = JSON.parse(await readFile(recomputedPath, 'utf8'));
  expect(recomputed.evaluation).toEqual(output.result);
  expect(recomputed.predictions).toEqual(output.predictions);
  await writeFile(resolve(out, 'sample-cli.json'), JSON.stringify({ stdout: cli.stdout, stderr: cli.stderr, numericalComparison: 'Exact JSON equality, same fixed method source', exportSha256: createHash('sha256').update(await readFile(exported.path)).digest('hex') }, null, 2));
  checks.push('Explicit rerun creates a fresh run ID with identical input/output; keyboard history; actual export and independent CLI recomputation');

  const partialInput = await importSample('partial');
  const partial = await completed((await start()).id);
  expect(partial.inputId).toBe(partialInput.id);
  const partialOutput = await read(`/api/artifacts/${partial.outputId}`);
  const external = partialOutput.result.models.find(item => item.model.id === 'sample-external');
  expect(external.denominator).toEqual({ attempted: testIds.length, evaluated: testIds.length - 1, failed: 1 });
  expect(external.conditions).toHaveLength(testIds.length);
  await expect(frame.getByText('Some predictions failed. The full denominator is retained; see condition results for reasons.', { exact: true })).toBeVisible();
  await frame.getByLabel('Model', { exact: true }).selectOption('sample-external');
  await expect(frame.locator('.vc-comparison-conditions tbody tr')).toHaveCount(testIds.length);
  await expect(frame.getByText('prediction_missing', { exact: true })).toBeVisible();
  await screenshot('sample-failed-condition.png');
  const badInput = await importSample('incompatible');
  const bad = await completed((await start()).id, 'failed');
  expect(bad.inputId).toBe(badInput.id);
  expect(bad.error).toBe('prediction_gene_order_mismatch');
  expect(bad.logs).toContain('prediction_gene_order_mismatch');
  expect(bad.outputId).toBeNull();
  await expect(frame.locator('.vc-comparison-detail').getByText('prediction_gene_order_mismatch', { exact: true })).toBeVisible();
  await screenshot('sample-incompatible-failed.png');
  const failedExport = await exportRun(bad.id, 'sample-failed-export.json');
  expect(failedExport.document.output).toBeNull();
  expect(failedExport.document.bundle.predictions).toHaveLength(1);
  await assertFrozen(first, output);
  checks.push('Missing prediction remains in denominator and condition table; incompatible gene order fails with actual exit 2 and retained export/history');

  await importSample('cancel');
  const running = await start();
  let beforeCancel;
  await expect.poll(async () => {
    beforeCancel = record(await read(runPath(running.id)));
    if (!activeStatuses.includes(beforeCancel.status)) throw new Error('The real bounded sample completed before cancellation was observable. Cancellation is NOT verified; no success receipt will be written.');
    return beforeCancel.status === 'running' && beforeCancel.logs.includes('Starting CPU comparison');
  }, { timeout: 10000, intervals: [50, 100] }).toBe(true);
  expect(beforeCancel.process.exitObserved).toBe(false);
  expect(alive(beforeCancel.process.pid)).toBe(true);
  const cancelPath = `${runPath(running.id)}/cancel`;
  const cancelReply = page.waitForResponse(response => response.url().endsWith(cancelPath) && response.request().method() === 'POST');
  await frame.getByRole('button', { name: 'Cancel run', exact: true }).click();
  const cancelled = record(await (await cancelReply).json());
  expect(requests.some(item => item.method === 'POST' && item.path === cancelPath)).toBe(true);
  expect(cancelled.status).toBe('cancelled');
  expect(cancelled.process.terminationRequested).toMatch(/^(terminate|kill)$/);
  expect(cancelled.process.exitObserved).toBe(true);
  expect(cancelled.process.exitCode).toBeLessThan(0);
  expect(cancelled.outputId).toBeNull();
  expect(alive(beforeCancel.process.pid)).toBe(false);
  await expect(frame.locator('.vc-comparison-detail > .pero-ui-toolbar > [role="status"]')).toHaveText('Cancelled');
  await screenshot('sample-cancelled.png');
  await writeFile(resolve(out, 'sample-cancellation.json'), JSON.stringify({ beforeCancel, cancelled, processAbsentBeforeTerminalUiAssertion: true }, null, 2));
  await assertFrozen(first, output);
  checks.push('Actual running child -> visible Cancel request -> observed nonzero process exit/PID absence -> terminal Cancelled; old results unchanged');

  const saved = (await read('/api/comparisons')).items;
  expect(saved).toHaveLength(5);
  const postCount = comparisonPosts().length;
  const allPostCount = requests.filter(item => item.method === 'POST').length;
  await page.reload();
  await openComparison();
  await selectRun(first.id);
  await expect(frame.locator('.vc-comparison-models tbody tr')).toHaveCount(3);
  expect((await read('/api/comparisons')).items).toEqual(saved);
  expect(comparisonPosts()).toHaveLength(postCount);
  expect(requests.filter(item => item.method === 'POST')).toHaveLength(allPostCount);
  await closeDesktop();
  await launch();
  await openComparison();
  await selectRun(first.id);
  await expect(frame.locator('.vc-comparison-models tbody tr')).toHaveCount(3);
  await frame.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(frame.getByRole('button', { name: 'Rerun', exact: true })).toBeEnabled();
  expect((await read('/api/comparisons')).items).toEqual(saved);
  expect(comparisonPosts()).toHaveLength(postCount);
  expect(requests.filter(item => item.method === 'POST')).toHaveLength(allPostCount);
  await assertFrozen(first, output);
  await screenshot('sample-reopened-history.png');
  checks.push('Frontend reload and full Desktop/backend restart retain all five attempts; history/refresh issue no comparison POST or automatic replay');
  expect(errors).toEqual([]);
  // Only five explicit starts and one explicit cancellation are authorized.
  expect(comparisonPosts().filter(item => item.path === '/api/comparisons')).toHaveLength(5);
  expect(comparisonPosts().filter(item => item.path.endsWith('/cancel'))).toHaveLength(1);
} catch (error) {
  failure = error;
  await saveFailure(error);
} finally {
  try { await closeDesktop(); }
  catch (error) { failure ||= error; await saveFailure(failure); }
  if (failure && profile) {
    // Preserve scientific state, not the credential/browser profile, on failure.
    try { await cp(resolve(profile, 'app-data/virtual-cell'), resolve(out, 'failure-app-data'), { recursive: true, force: true }); }
    catch (error) { if (error.code !== 'ENOENT') { failure ||= error; } }
  }
  if (temp) {
    try { await rm(temp, { recursive: true, force: true }); }
    catch (error) { failure ||= error; await saveFailure(failure); }
  }
}
if (!failure && errors.length) {
  failure = new Error('Renderer errors were observed, including during shutdown');
  await saveFailure(failure);
}
if (failure) throw failure;
// Receipt is intentionally last: successful UI assertions are not cleanup proof.
const receipt = { status: 'passed', scope: 'synthetic-development-only', publicNormanValidation: false,
  checks, errors, runs: runEvidence, requests, cleanup, temporaryInputsRemoved: true };
await writeFile(resolve(out, 'result.json'), JSON.stringify(receipt, null, 2));
console.log(JSON.stringify({ status: receipt.status, scope: receipt.scope, checks }));

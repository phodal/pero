// Real Electron -> GPUI -> Host -> Python -> python-control/ngspice.
// No mocked solver, provider, App bridge, or static numerical output. Development
// acceptance only: this does not claim real-LLM or packaged-product verification.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
const root = resolve(import.meta.dirname, '../..');
const out = resolve(root, 'test-results/control-lab');
await mkdir(out, { recursive: true });
for (const name of ['result.json', 'failure.json']) await rm(resolve(out, name), { force: true });
const execute = promisify(execFile);
const checks = [], requests = [], errors = [], consoleErrors = [], cleanup = [], experiments = {};
let expect, electron, setAppearance, temp, app, page, frame, failure;
const state = () => page.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()));
const read = path => frame.locator('body').evaluate(async (_body, path) => {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`GET ${path}: ${response.status}`);
  return response.json();
}, path);
const experimentPath = id => `/api/experiments/${id}`;
const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; } };
async function painted() {
  await page.waitForFunction(() => {
    const canvas = document.querySelector('canvas');
    return canvas?.width === Math.round(innerWidth * devicePixelRatio) && canvas.height === Math.round(innerHeight * devicePixelRatio);
  });
  await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
}
async function openLab() {
  await page.waitForFunction(() => window.peroDiagnostics && !document.getElementById('loading'), undefined, { timeout: 60000 });
  await expect.poll(async () => (await state()).apps?.some(item => item.name === 'control-lab')).toBe(true);
  await painted();
  await page.mouse.click(80, await page.evaluate(() => innerHeight - 55));
  await expect.poll(async () => (await state()).navigation).toBe(7);
  await expect.poll(async () => (await state()).appsLoading).toBe(false);
  await painted();
  const catalog = await state(), row = catalog.apps.findIndex(item => item.name === 'control-lab');
  expect(row).toBeGreaterThanOrEqual(0);
  await page.mouse.click(await page.evaluate(() => innerWidth - 183), 130 + (catalog.contentTabs.length ? 30 : 0) + 58 * row);
  await expect.poll(async () => (await state()).activeContent).toEqual({ kind: 'app', value: { name: 'control-lab', panel: 'main' } });
  frame = page.frameLocator('iframe[title="control-lab"]');
  await expect(frame.getByRole('heading', { name: 'Control Lab', exact: true })).toBeVisible({ timeout: 20000 });
}
async function action(label, path) {
  const response = page.waitForResponse(r => new URL(r.url()).pathname === path && r.request().method() === 'POST');
  await frame.getByRole('button', { name: label, exact: true }).click();
  const result = await response;
  expect(result.ok(), `${label}: HTTP ${result.status()}`).toBe(true);
  return result.json();
}
async function settled(id) {
  let result;
  await expect.poll(async () => {
    result = await read(experimentPath(id)); experiments[id] = result;
    return result.status;
  }, { timeout: 120000, intervals: [100, 250, 500] }).not.toBe('running');
  return result;
}
async function closeDesktop() {
  if (!app) return;
  const current = app, pid = current.process().pid, owned = new Set([pid]), failures = [];
  const { stdout } = await execute('ps', ['-axo', 'pid=,ppid='], { encoding: 'utf8' });
  const tree = stdout.trim().split('\n').map(line => line.trim().split(/\s+/).map(Number));
  for (let changed = true; changed;) {
    changed = false;
    for (const [child, parent] of tree) if (owned.has(parent) && !owned.has(child)) { owned.add(child); changed = true; }
  }
  try { await current.close(); } catch (error) { failures.push(error); }
  app = undefined;
  try { await expect.poll(() => [...owned].filter(alive), { timeout: 15000 }).toEqual([]); }
  catch (error) {
    failures.push(error);
    for (const signal of ['SIGTERM', 'SIGKILL']) {
      for (const child of [...owned].filter(alive)) try { process.kill(child, signal); } catch (e) { if (e.code !== 'ESRCH') failures.push(e); }
      try { await expect.poll(() => [...owned].filter(alive), { timeout: 10000 }).toEqual([]); break; } catch (e) { failures.push(e); }
    }
  }
  cleanup.push({ electronPid: pid, ownedPids: [...owned], allExited: [...owned].every(child => !alive(child)), recoveredShutdown: failures.length > 0 });
  if (failures.length) throw new AggregateError(failures, 'Desktop/backend shutdown failed; recovery cannot establish PASS');
}
async function captureFailure(error) {
  const evidence = { status: 'failed', scope: 'real-local-numerical-development', error: String(error.stack || error), checks, experiments, requests, errors, consoleErrors, cleanup };
  if (page && !page.isClosed()) {
    try { evidence.desktop = await state(); } catch {}
    try { evidence.appText = await frame.locator('body').innerText(); } catch {}
    try { evidence.formInputs = await frame.locator('form input, form select').evaluateAll(inputs => inputs.map(input => ({
      label: input.getAttribute('aria-label') || [...input.labels ?? []].map(label => label.textContent.trim()).join(' '),
      value: input.value, validity: Object.fromEntries(['valid', 'badInput', 'rangeOverflow', 'rangeUnderflow', 'stepMismatch', 'typeMismatch', 'valueMissing', 'customError'].map(key => [key, input.validity[key]])),
      validationMessage: input.validationMessage,
    }))); } catch {}
    try { await page.screenshot({ path: resolve(out, 'failure.png') }); } catch {}
  }
  await writeFile(resolve(out, 'failure.json'), JSON.stringify(evidence, null, 2));
}
async function exportEvidence(id) {
  const path = resolve(out, `${id}-export.json`);
  await rm(path, { force: true });
  await app.evaluate(({ session }, path) => session.defaultSession.once('will-download', (_event, item) => item.setSavePath(path)), path);
  await frame.getByRole('button', { name: 'Export evidence', exact: true }).click();
  let document;
  await expect.poll(async () => {
    try { document = JSON.parse(await readFile(path, 'utf8')); return true; }
    catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) return false; throw error; }
  }).toBe(true);
  return document;
}
async function selectExperiment(id) {
  const button = frame.locator('aside').getByTitle(id, { exact: true });
  await button.focus();
  await button.press('Enter');
  await expect(button).toHaveAttribute('aria-current', 'true');
  await expect(frame.getByRole('button', { name: 'Export evidence', exact: true })).toBeEnabled();
}
try {
  ({ expect } = await import('@playwright/test'));
  ({ electron } = await import('./electron.mjs'));
  ({ setAppearance } = await import('./sidebar-controls.mjs'));
  if (!['linux', 'darwin'].includes(process.platform)) throw new Error('Control Lab numerical Desktop gate requires supported Unix process cleanup; unsupported platforms are not a skipped PASS.');
  // Fail before launching if either real engine is missing. A dependency absence
  // must not silently convert this two-engine acceptance into a mocked/one-engine run.
  const python = process.env.PERO_APP_PYTHON || 'python3';
  const control = await execute(python, ['-E', '-s', '-c', 'import control; print(control.__version__)'], { encoding: 'utf8', timeout: 30000 });
  const pythonPath = (await execute(python, ['-E', '-s', '-c', 'import sys; print(sys.executable)'], { encoding: 'utf8' })).stdout.trim();
  const spice = await execute('ngspice', ['--version'], { encoding: 'utf8', timeout: 30000 });
  await writeFile(resolve(out, 'engine-versions.json'), JSON.stringify({ pythonControl: control.stdout.trim(), ngspice: spice.stdout.trim() }, null, 2));
  temp = await mkdtemp(resolve(tmpdir(), 'pero-control-lab-e2e-'));
  const agents = resolve(temp, 'agents.json');
  await writeFile(agents, JSON.stringify(['pero', 'codex', 'claude', 'copilot', 'grok', 'qoder', 'opencode'].map(id => ({ id, name: id, command: resolve(temp, `unavailable-${id}`) }))));
  const env = { ...process.env, PERO_DESKTOP_DATA_DIR: resolve(temp, 'desktop'), PERO_LOCALE: 'en', PERO_AGENTS_FILE: agents,
    PERO_SETTINGS_PATH: resolve(temp, 'settings.json'), PERO_HISTORY_PATH: resolve(temp, 'history.jsonl') };
  delete env.ELECTRON_RUN_AS_NODE; delete env.PERO_APPS_ROOT;
  const launch = async () => {
    app = await electron.launch({ args: [...(process.platform === 'darwin' ? ['--use-mock-keychain'] : []), ...(process.env.PERO_CONTROL_LAB_HEADLESS === '1' ? ['--headless'] : []), resolve(root, 'desktop')], cwd: root, env });
    page = await app.firstWindow();
    page.on('pageerror', error => errors.push({ type: 'pageerror', message: error.message }));
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push({ message: message.text(), location: message.location().url.split('?')[0] }); });
    page.on('request', request => {
      const url = new URL(request.url());
      if (url.protocol === 'pero-app:' && url.hostname === 'control-lab' && url.pathname.startsWith('/api/')) requests.push({ method: request.method(), path: url.pathname });
    });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1488, 1086));
    await openLab();
  };
  await launch();
  const catalog = await read('/api/templates');
  expect(catalog.templates.map(item => item.id)).toEqual(expect.arrayContaining(['robust-pid', 'active-filter', 'p-golden', 'pi-golden']));
  expect(catalog.capabilities).toHaveLength(2);
  expect(catalog.capabilities.every(item => item.available)).toBe(true);
  expect((await read('/api/experiments')).experiments).toEqual([]);
  const finished = [];
  for (const template of catalog.templates) {
    if (finished.length) await frame.getByRole('button', { name: 'New experiment', exact: true }).click();
    await frame.getByLabel('Template', { exact: true }).selectOption(template.id);
    const budget = frame.getByLabel('Total candidate budget', { exact: true });
    await budget.fill('31');
    expect(await budget.evaluate(input => input.validity.valid)).toBe(false);
    const beforeInvalid = requests.filter(item => item.method === 'POST').length;
    await frame.getByRole('button', { name: 'Freeze specification', exact: true }).click();
    expect(requests.filter(item => item.method === 'POST')).toHaveLength(beforeInvalid);
    await budget.press('Enter');
    expect(requests.filter(item => item.method === 'POST')).toHaveLength(beforeInvalid);
    const candidateCount = template.id.endsWith('-golden') ? 1 : 2;
    await budget.fill(String(candidateCount));
    let frozen;
    if (template.id === 'pi-golden') {
      const created = page.waitForResponse(response => new URL(response.url()).pathname === '/api/experiments' && response.request().method() === 'POST');
      await budget.press('Enter');
      const response = await created; expect(response.status()).toBe(201); frozen = await response.json();
      checks.push('Invalid click/Enter creates no POST; valid Enter freezes PI specification through the explicit App action');
    } else frozen = await action('Freeze specification', '/api/experiments');
    expect(frozen.specHash).toMatch(/^[a-f0-9]{64}$/);
    expect(frozen.scenarios.filter(item => item.role === 'verification').length).toBeGreaterThan(0);
    await expect(frame.getByLabel('Template', { exact: true })).toHaveCount(0);
    expect(frozen.candidateBudget).toBe(candidateCount);
    await expect(frame.getByLabel('Total candidate budget', { exact: true })).toHaveCount(0);
    await action('Run bounded search', `${experimentPath(frozen.id)}/search`);
    const searched = await settled(frozen.id);
    expect(searched.status).toBe('completed');
    expect(searched.candidates).toHaveLength(candidateCount);
    expect(searched.specHash).toBe(frozen.specHash);
    expect(searched.parameters).toEqual(frozen.parameters);
    expect(searched.criteria).toEqual(frozen.criteria);
    expect(searched.scenarios).toEqual(frozen.scenarios);
    expect(searched.trials).toHaveLength(candidateCount * frozen.scenarios.filter(item => item.role === 'search').length);
    const nominal = frozen.scenarios.find(item => item.role === 'search').id;
    const pair = searched.trials.filter(item => item.scenarioId === nominal);
    if (candidateCount > 1) expect(pair[0].observation.series).not.toEqual(pair[1].observation.series);
    for (const trial of searched.trials) {
      expect(trial.status).toBe('completed');
      expect(trial.observation.engine).toBe(template.engine);
      expect(trial.observation.engineVersion.length).toBeGreaterThan(0);
      expect(trial.observation.series.length).toBeGreaterThan(0);
      expect(trial.observation.artifacts.length).toBeGreaterThan(0);
      for (const series of trial.observation.series) {
        expect(series.x.length).toBeGreaterThan(1);
        expect(series.y.length).toBe(series.x.length);
        expect(series.x.every(Number.isFinite) && series.y.every(Number.isFinite)).toBe(true);
      }
      for (const artifact of trial.observation.artifacts) expect(artifact.sha256).toMatch(/^[a-f0-9]{64}$/);
    }
    await expect(frame.getByRole('img').first()).toBeVisible();
    await action('Lock candidate', `${experimentPath(frozen.id)}/lock`);
    await expect(frame.getByRole('button', { name: 'Run bounded search', exact: true })).toBeDisabled();
    await action('Verify locked candidate', `${experimentPath(frozen.id)}/verify`);
    const verified = await settled(frozen.id);
    expect(verified.status).toBe('completed');
    expect(['PASS', 'FAIL', 'INCONCLUSIVE']).toContain(verified.report.verdict);
    if (template.id === 'p-golden') expect(verified.report.verdict).toBe('FAIL');
    if (template.id === 'pi-golden') expect(verified.report.verdict).toBe('PASS');
    const finalScenarios = frozen.scenarios.filter(item => item.role === 'verification');
    const finalTrials = verified.trials.filter(item => item.phase === 'verification');
    expect(finalTrials.map(item => item.scenarioId).sort()).toEqual(finalScenarios.map(item => item.id).sort());
    expect(finalTrials.every(item => item.candidateId === verified.lockedCandidateId)).toBe(true);
    const verification = frame.locator('section').filter({ has: frame.getByRole('heading', { name: 'Independent verification', exact: true }) });
    await expect(verification.locator('table').first().locator('tbody > tr')).toHaveCount(finalScenarios.length);
    await expect(verification).toContainText(`/ ${finalScenarios.length} final scenarios passed`);
    const reevaluated = await action('Re-evaluate evidence', `${experimentPath(frozen.id)}/reevaluate`);
    expect(reevaluated.trials).toEqual(verified.trials);
    expect(reevaluated.report.verdict).toBe(verified.report.verdict);
    const saved = await read(experimentPath(frozen.id));
    experiments[frozen.id] = saved; finished.push(saved);
    const exported = await exportEvidence(saved.id);
    expect(exported.experiment).toEqual(saved);
    for (const trial of saved.trials) for (const reference of trial.observation?.artifacts ?? []) {
      const artifact = exported.artifacts.find(item => item.trialId === trial.id && item.name === reference.name);
      expect(artifact, `Missing exported artifact ${trial.id}/${reference.name}`).toBeDefined();
      expect(artifact.sha256).toBe(reference.sha256);
      expect(createHash('sha256').update(artifact.text).digest('hex')).toBe(reference.sha256);
    }
    checks.push(`${template.engine}: real bounded search, numerical series/artifact hashes, immutable policy, locked separate verification, full denominator and saved-evidence reevaluation/export`);
    const responseHeading = frame.getByRole('heading', { name: 'Baseline and candidate', exact: true });
    await responseHeading.evaluate(element => element.scrollIntoView({ block: 'start' }));
    await expect(responseHeading).toBeInViewport();
    await page.screenshot({ path: resolve(out, `${template.id}-response.png`) });
    const verdictHeading = frame.getByRole('heading', { name: 'Independent verification', exact: true });
    await verdictHeading.evaluate(element => element.scrollIntoView({ block: 'start' }));
    await expect(verdictHeading).toBeInViewport();
    await page.screenshot({ path: resolve(out, `${template.id}-verified.png`) });
  }
  const first = finished[0];
  await selectExperiment(first.id);
  await setAppearance(page, 'light');
  await expect.poll(() => frame.locator('html').evaluate(element => element.style.colorScheme)).toBe('light');
  await page.screenshot({ path: resolve(out, 'light.png') });
  await setAppearance(page, 'dark');
  await expect.poll(() => frame.locator('html').evaluate(element => element.style.colorScheme)).toBe('dark');
  await page.screenshot({ path: resolve(out, 'dark.png') });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 788));
  await painted();
  await expect.poll(() => frame.locator('html').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: resolve(out, 'narrow.png') });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1488, 1086));
  const rerun = await action('Rerun as new experiment', '/api/experiments');
  expect(rerun.id).not.toBe(first.id);
  expect(rerun.specHash).toBe(first.specHash);
  expect(rerun.trials).toEqual([]);
  expect(await read(experimentPath(first.id))).toEqual(first);
  await frame.getByRole('button', { name: 'New experiment', exact: true }).click();
  await frame.getByLabel('Template', { exact: true }).selectOption(first.templateId);
  await frame.getByLabel('Observation window', { exact: true }).fill('6');
  await frame.getByLabel('Samples', { exact: true }).fill('601');
  await frame.getByLabel('Total candidate budget', { exact: true }).fill('30');
  const cancelTarget = await action('Freeze specification', '/api/experiments');
  const running = await action('Run bounded search', `${experimentPath(cancelTarget.id)}/search`);
  expect(running.status).toBe('running');
  await action('Cancel search', `${experimentPath(cancelTarget.id)}/cancel`);
  const cancelled = await settled(cancelTarget.id);
  expect(cancelled.status).toBe('cancelled');
  expect(cancelled.candidates.length).toBeLessThanOrEqual(30);
  expect(cancelled.report?.verdict ?? 'INCONCLUSIVE').not.toBe('PASS');
  expect(await read(experimentPath(first.id))).toEqual(first);
  checks.push('Light/dark/narrow, keyboard history, rerun fresh identity, immutable prior evidence, real in-flight bounded cancellation');
  const historyById = data => [...data.experiments].sort((a, b) => a.id.localeCompare(b.id));
  const savedHistory = historyById(await read('/api/experiments'));
  const posts = requests.filter(item => item.method === 'POST').length;
  await page.reload(); await openLab(); await selectExperiment(first.id);
  expect(historyById(await read('/api/experiments'))).toEqual(savedHistory);
  expect(requests.filter(item => item.method === 'POST')).toHaveLength(posts);
  await closeDesktop(); await launch(); await selectExperiment(first.id);
  expect(historyById(await read('/api/experiments'))).toEqual(savedHistory);
  expect(await read(experimentPath(first.id))).toEqual(first);
  expect(requests.filter(item => item.method === 'POST')).toHaveLength(posts);
  checks.push('Reload and actual Desktop/backend restart preserve history and old observations without implicit replay');
  // Remove executable discovery only in this disposable App environment. This
  // invokes the real unavailable-engine branch, not a fake solver implementation.
  await closeDesktop();
  const emptyPath = resolve(temp, 'empty-path'); await mkdir(emptyPath);
  env.PATH = emptyPath; env.PERO_APP_PYTHON = pythonPath;
  await launch();
  const unavailable = await read('/api/templates');
  expect(unavailable.capabilities.find(item => item.engine === 'ngspice').available).toBe(false);
  const filter = unavailable.templates.find(item => item.engine === 'ngspice');
  await frame.getByLabel('Template', { exact: true }).selectOption(filter.id);
  await expect(frame.getByText(/ngspice is unavailable/)).toBeVisible();
  await frame.getByLabel('Total candidate budget', { exact: true }).fill('1');
  const missing = await action('Freeze specification', '/api/experiments');
  await action('Run bounded search', `${experimentPath(missing.id)}/search`);
  const failedSearch = await settled(missing.id);
  expect(failedSearch.status).toBe('failed');
  expect(failedSearch.trials.every(trial => trial.status === 'failed' && trial.observation === null)).toBe(true);
  await expect(frame.getByRole('alert')).toBeVisible();
  await action('Lock candidate', `${experimentPath(missing.id)}/lock`);
  await action('Verify locked candidate', `${experimentPath(missing.id)}/verify`);
  const failedVerification = await settled(missing.id);
  expect(failedVerification.status).toBe('failed');
  expect(failedVerification.report.verdict).toBe('INCONCLUSIVE');
  const full = failedVerification.scenarios.filter(item => item.role === 'verification');
  expect(failedVerification.trials.filter(item => item.phase === 'verification').map(item => item.scenarioId).sort()).toEqual(full.map(item => item.id).sort());
  const missingSection = frame.locator('section').filter({ has: frame.getByRole('heading', { name: 'Independent verification', exact: true }) });
  await expect(missingSection).toContainText(`0 / ${full.length} final scenarios passed`);
  await expect(missingSection.locator('table').first().locator('tbody > tr')).toHaveCount(full.length);
  await page.screenshot({ path: resolve(out, 'engine-unavailable.png') });
  expect((await exportEvidence(missing.id)).experiment).toEqual(failedVerification);
  expect(await read(experimentPath(first.id))).toEqual(first);
  checks.push('Actual missing ngspice PATH: visible availability/error, failed execution with no invented observations, complete final denominator, INCONCLUSIVE and retained export');
  expect(errors).toEqual([]);
} catch (error) { failure = error; await captureFailure(error); }
finally {
  try { await closeDesktop(); } catch (error) { failure ||= error; await captureFailure(failure); }
  if (temp) try { await rm(temp, { recursive: true, force: true }); } catch (error) { failure ||= error; await captureFailure(failure); }
}
if (failure) throw failure;
await writeFile(resolve(out, 'result.json'), JSON.stringify({ status: 'passed', scope: 'real-local-numerical-development', realLLM: false,
  headless: process.env.PERO_CONTROL_LAB_HEADLESS === '1', checks, experiments, requests, errors, consoleErrors, cleanup, temporaryProfileRemoved: true }, null, 2));
console.log(JSON.stringify({ status: 'passed', checks }));

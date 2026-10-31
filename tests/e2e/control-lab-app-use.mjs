// Real Desktop -> bound App Chat -> scripted ACP -> Host MCP -> real Python solver.
// This is transport acceptance, not real-model or scientific-method acceptance.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
const root = resolve(import.meta.dirname, '../..'), out = resolve(root, 'test-results/control-lab-app-use');
await mkdir(out, { recursive: true });
// Preserve an earlier failure before starting a new run. A later pass does not
// explain an intermittent failure; retain both its receipt and screenshot.
const priorFiles = [];
for (const name of ['failure.json', 'failure.png']) {
  try { priorFiles.push({ name, modified: (await stat(resolve(out, name))).mtime.toISOString() }); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
let previousFailure;
if (priorFiles.length) {
  const archive = await mkdtemp(resolve(out, 'failure-'));
  for (const { name } of priorFiles) await rename(resolve(out, name), resolve(archive, name));
  previousFailure = { observedAt: priorFiles[0].modified, files: priorFiles.map(({ name }) => resolve(archive, name)) };
}
await rm(resolve(out, 'result.json'), { force: true });
const execute = promisify(execFile), errors = [], consoleErrors = [], cleanup = [], uiActions = [];
let expect, electron, clickAppOpen, clickAppShortcut, app, page, frame, temp, failure, result, frozen, final;
const state = () => page.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()));
const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; } };
async function closeDesktop() {
  if (!app) return;
  const owned = new Set([app.process().pid]), failures = [];
  const { stdout } = await execute('ps', ['-axo', 'pid=,ppid='], { encoding: 'utf8' });
  const tree = stdout.trim().split('\n').map(line => line.trim().split(/\s+/).map(Number));
  for (let changed = true; changed;) {
    changed = false;
    for (const [child, parent] of tree) if (owned.has(parent) && !owned.has(child)) { owned.add(child); changed = true; }
  }
  try { await app.close(); } catch (error) { failures.push(error); }
  app = undefined;
  try { await expect.poll(() => [...owned].filter(alive), { timeout: 15000 }).toEqual([]); }
  catch (error) {
    failures.push(error);
    for (const signal of ['SIGTERM', 'SIGKILL']) {
      for (const pid of [...owned].filter(alive)) try { process.kill(pid, signal); } catch (e) { if (e.code !== 'ESRCH') failures.push(e); }
      try { await expect.poll(() => [...owned].filter(alive), { timeout: 10000 }).toEqual([]); break; } catch (e) { failures.push(e); }
    }
  }
  cleanup.push({ ownedPids: [...owned], allExited: [...owned].every(pid => !alive(pid)), recoveredShutdown: failures.length > 0 });
  if (failures.length) throw new AggregateError(failures, 'App/Host/ACP cleanup failed; no success receipt');
}
async function recordFailure(error) {
  const receipt = { status: 'failed', fixture: true, realModel: false, error: String(error.stack || error), errors, consoleErrors, cleanup, result, uiActions, previousFailure };
  if (page && !page.isClosed()) {
    try { receipt.state = await state(); } catch {}
    if (frame && frozen) try {
      receipt.experiment = await frame.locator('body').evaluate(async (_body, id) => {
        const record = await (await fetch(`/api/experiments/${id}`)).json();
        return { status: record.status, operation: record.operation, error: record.error,
          trials: record.trials.map(({ status, error, scenarioId }) => ({ status, error, scenarioId })) };
      }, frozen.id);
    } catch {}
    try { receipt.formInputs = await frame.locator('form input, form select').evaluateAll(inputs => inputs.map(input => ({
      label: input.getAttribute('aria-label') || [...input.labels ?? []].map(label => label.textContent.trim()).join(' '),
      value: input.value, validity: Object.fromEntries(['valid', 'badInput', 'rangeOverflow', 'rangeUnderflow', 'stepMismatch', 'typeMismatch', 'valueMissing', 'customError'].map(key => [key, input.validity[key]])),
      validationMessage: input.validationMessage,
    }))); } catch {}
    try { await page.screenshot({ path: resolve(out, 'failure.png') }); } catch {}
  }
  await writeFile(resolve(out, 'failure.json'), JSON.stringify(receipt, null, 2));
}
try {
  ({ clickAppOpen, clickAppShortcut } = await import('./sidebar-controls.mjs'));
  ({ expect } = await import('@playwright/test')); ({ electron } = await import('./electron.mjs'));
  if (!['linux', 'darwin'].includes(process.platform)) throw new Error('The process-cleanup gate is Unix-only, not a skipped PASS');
  await execute(process.env.PERO_APP_PYTHON || 'python3', ['-E', '-s', '-c', 'import control; print(control.__version__)'], { timeout: 30000 });
  temp = await mkdtemp(resolve(tmpdir(), 'pero-control-lab-app-use-'));
  const agents = resolve(temp, 'agents.json'), settings = resolve(temp, 'settings.json');
  await writeFile(agents, JSON.stringify([
    ...['pero', 'claude', 'copilot', 'grok', 'qoder', 'opencode'].map(id => ({ id, name: id, command: resolve(temp, `unavailable-${id}`) })),
    { id: 'codex', name: 'Control Lab scripted transport fixture', command: process.execPath, args: [resolve(root, 'tests/fixtures/control-lab-acp.mjs')] },
  ]));
  await writeFile(settings, JSON.stringify({ chat_agent: 'codex' }));
  const env = { ...process.env, PERO_DESKTOP_DATA_DIR: resolve(temp, 'profile'), PERO_SETTINGS_PATH: settings,
    PERO_HISTORY_PATH: resolve(temp, 'history.jsonl'), PERO_AGENTS_FILE: agents, PERO_LOCALE: 'en' };
  delete env.ELECTRON_RUN_AS_NODE; delete env.PERO_APPS_ROOT;
  app = await electron.launch({ requiresNativeWindow: true, args: [...(process.platform === 'darwin' ? ['--use-mock-keychain'] : []), resolve(root, 'desktop')], cwd: root, env });
  page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (request.method() !== 'POST') return;
    const path = new URL(request.url()).pathname;
    if (/^\/api\/experiments\/[a-f0-9]{32}\/(search|verify|cancel|lock|reevaluate|propose)$/.test(path))
      uiActions.push(path.split('/').at(-1));
  });
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push({ message: message.text(), location: message.location().url.split('?')[0] }); });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1488, 1086));
  await page.waitForFunction(() => window.peroDiagnostics && !document.getElementById('loading'), undefined, { timeout: 60000 });
  await expect.poll(async () => (await state()).apps?.some(item => item.name === 'control-lab')).toBe(true);
  await page.waitForFunction(() => { const c = document.querySelector('canvas'); return c?.width === Math.round(innerWidth * devicePixelRatio) && c.height === Math.round(innerHeight * devicePixelRatio); });
  await clickAppShortcut(page, 'apps');
  await expect.poll(async () => (await state()).navigation).toBe(7);
  await expect.poll(async () => (await state()).appsLoading).toBe(false);
  await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
  await clickAppOpen(page, 'control-lab');
  await expect.poll(async () => (await state()).activeContent).toEqual({ kind: 'app', value: { name: 'control-lab', panel: 'main' } });
  frame = page.frameLocator('iframe[title="control-lab"]');
  await expect(frame.getByLabel('Template', { exact: true })).toBeVisible({ timeout: 20000 });
  await frame.getByLabel('Template', { exact: true }).selectOption('robust-pid');
  await frame.getByLabel('Observation window', { exact: true }).fill('6');
  await frame.getByLabel('Samples', { exact: true }).fill('601');
  await frame.getByLabel('Total candidate budget', { exact: true }).fill('3');
  const created = page.waitForResponse(response => new URL(response.url()).pathname === '/api/experiments' && response.request().method() === 'POST');
  await frame.getByRole('button', { name: 'Freeze specification', exact: true }).click();
  const response = await created; expect(response.status()).toBe(201); frozen = await response.json();
  const proxyStatuses = await frame.locator('body').evaluate(async () => Promise.all(
    ['/api/agent-step', '/api/agent-step?x=1', '/api/extra/../agent-step', '/api/%61gent-step'].map(async path =>
      (await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status)));
  expect(proxyStatuses.slice(0, 3)).toEqual([403, 403, 403]);
  expect(proxyStatuses[3]).not.toBe(200);
  await frame.getByRole('button', { name: 'Approve goal and discuss', exact: true }).click();
  await expect.poll(async () => (await state()).composer).toContain(`Review Control Lab experiment ${frozen.id}`);
  await expect.poll(async () => (await state()).floatingChat).toBe(true);
  await expect.poll(async () => (await state()).attachments?.length).toBe(1);
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  await page.mouse.click(viewport.width - 51, viewport.height - ((await state()).floatingChatExpanded ? 561 : 133));
  await expect.poll(async () => (await state()).floatingChat).toBe(false);
  const active = async () => { const value = await state(); return value.chats[value.activeChat]; };
  expect((await active()).agent).toBe('codex');
  expect((await active()).scope).toEqual({ app: 'control-lab', panel: 'main' });
  // The real environment-ready notice overlays the composer; dismiss it using
  // its visible action before the user gesture, rather than clicking through it.
  const preparation = page.getByRole('region', { name: 'App environment', exact: true });
  if (await preparation.isVisible()) {
    await expect(preparation.getByRole('status')).toHaveText('Environment ready');
    await preparation.getByRole('button', { name: 'Hide', exact: true }).click();
    await expect(preparation).toBeHidden();
  }
  const edge = await page.locator('#pero-app-surface').evaluate(element => element.getBoundingClientRect().right);
  await page.mouse.click(edge + 120, await page.evaluate(() => innerHeight - 70)); await page.keyboard.press('Enter');
  await expect.poll(async () => (await active()).messages.filter(item => item.role === 'user').length).toBe(1);
  await expect.poll(async () => (await active()).messages.filter(item => item.role === 'assistant').at(-1)?.text || '', { timeout: 120000, intervals: [100, 250, 500] }).toContain('CONTROL_LAB_RESULT:');
  await expect.poll(async () => (await active()).state).toBe('idle');
  const text = (await active()).messages.filter(item => item.role === 'assistant').at(-1).text;
  result = JSON.parse(text.slice(text.indexOf('CONTROL_LAB_RESULT:') + 'CONTROL_LAB_RESULT:'.length));
  expect(result.error).toBeUndefined(); expect(result.fixture).toBe(true); expect(result.realModel).toBe(false);
  expect(result.experimentId).toBe(frozen.id); expect(result.specHash).toBe(frozen.specHash);
  expect(result.steps.filter(item => item.rejected)).toHaveLength(6);
  expect((await active()).permission).toBeNull();
  // Independently read persisted domain evidence, not just the fixture's claim.
  final = await frame.locator('body').evaluate(async (_body, id) => (await fetch(`/api/experiments/${id}`)).json(), frozen.id);
  expect(final.status).toBe('completed'); expect(final.specHash).toBe(frozen.specHash);
  expect(final.criteria).toEqual(frozen.criteria); expect(final.parameters).toEqual(frozen.parameters);
  expect(final.candidates).toHaveLength(3); expect(final.lockedCandidateId).toBe(result.proposalId);
  expect(final.candidates.find(item => item.id === result.proposalId).parameters.kp).toBe(3);
  expect(final.report).toEqual(result.report);
  expect(final.trials.every(item => item.status === 'completed' && item.observation.engine === 'python-control')).toBe(true);
  for (const candidate of final.candidates)
    expect(final.trials.filter(item => item.phase === 'search' && item.candidateId === candidate.id).map(item => item.scenarioId).sort())
      .toEqual(frozen.scenarios.filter(item => item.role === 'search').map(item => item.id).sort());
  expect(final.trials.filter(item => item.phase === 'verification').map(item => item.scenarioId).sort())
    .toEqual(frozen.scenarios.filter(item => item.role === 'verification').map(item => item.id).sort());
  await expect(frame.getByRole('button', { name: 'Select Agent/user proposal', exact: true })).toContainText('Agent/user proposal (locked)');
  await page.screenshot({ path: resolve(out, 'fixture-proposed-and-verified.png') });
  expect(errors).toEqual([]);
} catch (error) { failure = error; await recordFailure(error); }
finally {
  try { await closeDesktop(); } catch (error) { failure ||= error; await recordFailure(failure); }
  if (temp) try { await rm(temp, { recursive: true, force: true }); } catch (error) { failure ||= error; await recordFailure(failure); }
}
if (failure) throw failure;
await writeFile(resolve(out, 'result.json'), JSON.stringify({ status: 'passed', scope: 'real-Desktop-ACP-MCP-App-transport', fixture: true, realModel: false,
  result, experiment: final, errors, consoleErrors, cleanup, temporaryProfileRemoved: true, previousFailure }, null, 2));
console.log(JSON.stringify({ status: 'passed', fixture: true, realModel: false, experimentId: final.id }));

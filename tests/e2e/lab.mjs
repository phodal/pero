// Real Desktop -> Host shared Chat -> scripted ACP -> declared App writes ->
// actual PyLabRobot Chatterbox. Fixture transport, not real-model acceptance.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { expect } from '@playwright/test';
import { electron } from './electron.mjs';
import { focusWorkbenchComposer } from './workbench-chat-controls.mjs';
import { observeAppChatLaunch } from '../fixtures/app-chat-launch.mjs';
import { clickAppOpen, clickAppShortcut, setAppearance } from './sidebar-controls.mjs';

const root = resolve(import.meta.dirname, '../..'), out = resolve(root, 'test-results/lab-desktop');
await mkdir(out, { recursive: true });
const execute = promisify(execFile), errors = [], consoleErrors = [], checks = [], cleanup = [];
const temp = await mkdtemp(resolve(tmpdir(), 'pero-lab-desktop-'));
let app, page, frame, frozen, final, fixture, failure, exportReceipt, narrowViewport;
const state = () => page.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()));
const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; } };
async function closeDesktop() {
  if (!app) return;
  const owned = new Set([app.process().pid]);
  const { stdout } = await execute('ps', ['-axo', 'pid=,ppid='], { encoding: 'utf8' });
  const tree = stdout.trim().split('\n').map(line => line.trim().split(/\s+/).map(Number));
  for (let changed = true; changed;) {
    changed = false;
    for (const [child, parent] of tree) if (owned.has(parent) && !owned.has(child)) { owned.add(child); changed = true; }
  }
  await app.close(); app = undefined;
  try { await expect.poll(() => [...owned].filter(alive), { timeout: 15000 }).toEqual([]); }
  catch (error) {
    for (const pid of [...owned].filter(alive)) try { process.kill(pid, 'SIGTERM'); } catch (cause) { if (cause.code !== 'ESRCH') throw cause; }
    await expect.poll(() => [...owned].filter(alive), { timeout: 10000 }).toEqual([]);
    throw error; // A recovered leak is not a clean lifecycle PASS.
  }
  cleanup.push({ allExited: true, ownedPids: [...owned] });
}
const agents = resolve(temp, 'agents.json'), settings = resolve(temp, 'settings.json');
await writeFile(agents, JSON.stringify([
  ...['pero', 'claude', 'copilot', 'grok', 'qoder', 'opencode'].map(id => ({ id, name: id, command: resolve(temp, `unavailable-${id}`) })),
  { id: 'codex', name: 'Lab scripted transport fixture', command: process.execPath, args: [resolve(root, 'tests/fixtures/lab-acp.mjs')] },
]));
const env = { ...process.env, PERO_DESKTOP_DATA_DIR: resolve(temp, 'profile'), PERO_SETTINGS_PATH: settings,
  PERO_HISTORY_PATH: resolve(temp, 'history.jsonl'), PERO_AGENTS_FILE: agents, PERO_LOCALE: 'en',
  PERO_BUILTIN_APPS: 'lab', PERO_REQUIRED_APPS: 'lab', PERO_APP_INFRA_EMBED: '0' };
delete env.ELECTRON_RUN_AS_NODE; delete env.PERO_APPS_ROOT;
async function launch() {
  app = await electron.launch({ requiresNativeWindow: true, args: [...(process.platform === 'darwin' ? ['--use-mock-keychain'] : []), resolve(root, 'desktop')], cwd: root, env });
  page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1488, 1000));
  await page.waitForFunction(() => window.peroDiagnostics && !document.getElementById('loading'), undefined, { timeout: 60000 });
  await expect.poll(async () => (await state()).apps?.some(item => item.name === 'lab')).toBe(true);
  await page.evaluate(path => window.pero.sessionCommand({ action: 'workspace', path }), temp);
  await expect.poll(async () => (await state()).workspace).toBe(temp);
  await page.waitForFunction(() => { const c = document.querySelector('canvas'); return c?.width === Math.round(innerWidth * devicePixelRatio) && c.height === Math.round(innerHeight * devicePixelRatio); });
  await clickAppShortcut(page, 'apps');
  await expect.poll(async () => (await state()).navigation).toBe(7);
  await expect.poll(async () => (await state()).appsLoading).toBe(false);
  await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
  await clickAppOpen(page, 'lab');
  await expect.poll(async () => (await state()).activeContent).toEqual({ kind: 'app', value: { name: 'lab', panel: 'main' } });
  frame = page.frameLocator('iframe[title="lab"]');
  // Backend preparation may precede apps_opened/iframe mounting. Use the existing
  // startup gate first; keep the subsequent visibility and sandbox checks intact.
  await expect(frame.getByRole('button', { name: 'Freeze experiment', exact: true })).toBeEnabled({ timeout: 120000 });
  await expect(page.locator('iframe[title="lab"]')).toBeVisible();
  await expect(frame.getByRole('heading', { name: 'Lab', exact: true })).toBeVisible();
  await expect(page.locator('iframe[title="lab"]')).toHaveAttribute('sandbox', /allow-scripts/);
  expect(await page.locator('iframe[title="lab"]').getAttribute('sandbox')).not.toContain('allow-forms');
}
const readExperiment = id => frame.locator('body').evaluate(async (_body, id) => {
  const response = await fetch(`/api/experiments/${id}`); if (!response.ok) throw Error(await response.text()); return response.json();
}, id);
try {
  if (!['linux', 'darwin'].includes(process.platform)) throw Error('This lifecycle process gate requires Unix.');
  const { stdout: pythonRoot } = await execute(process.env.PERO_APP_PYTHON || 'python3', ['-E', '-s', '-c', "import sys, importlib.metadata; assert sys.version_info[:2] == (3,12); assert importlib.metadata.version('pylabrobot') == '0.2.2'; print(sys.prefix)"], { encoding: 'utf8', timeout: 30000 });
  // Bind the interpreter just validated, not a new implicitly prepared environment.
  await writeFile(settings, JSON.stringify({ chat_agent: 'codex', app_python: { apps: { lab: pythonRoot.trim() } } }));
  await launch();
  await page.screenshot({ path: resolve(out, 'empty-light.png') });
  const created = page.waitForResponse(response => new URL(response.url()).pathname === '/api/experiments' && response.request().method() === 'POST');
  await frame.getByRole('button', { name: 'Freeze experiment', exact: true }).click();
  const reply = await created; expect(reply.status()).toBe(201); frozen = await reply.json();
  expect(frozen.mode).toBe('simulation'); expect(frozen.initial_state.wells).toHaveLength(96);
  const prohibited = await frame.locator('body').evaluate(async () => (await fetch('/api/agent-step', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status);
  expect(prohibited).toBe(403);
  // First-use Host context preparation has the SDK's 125-second RPC deadline.
  // Wait for this real button's matching acknowledgement before testing paint.
  const parentOrigin = await page.evaluate(() => `${location.protocol}//${location.host}`);
  const appOrigin = await frame.locator('body').evaluate(() => `${location.protocol}//${location.host}`);
  await page.evaluate(observeAppChatLaunch, { parent: true, origin: appOrigin });
  await frame.locator('body').evaluate(observeAppChatLaunch, { parent: false, origin: parentOrigin });
  let handoff;
  try {
    await frame.getByRole('button', { name: 'Approve goal and ask Agent', exact: true }).click();
    await expect.poll(async () => {
      const id = await page.evaluate(() => window.appChatLaunch.getRequest());
      handoff = await frame.locator('body').evaluate((_element, id) => window.appChatLaunch.results[id], id);
      if (handoff && !handoff.ok) throw Error(handoff.error || 'Lab goal handoff failed');
      return !!handoff;
    }, { timeout: 125000, message: 'Lab goal receives its matching Host acknowledgement' }).toBe(true);
    expect(handoff.value.references).toHaveLength(1);
  } finally {
    await page.evaluate(() => { window.appChatLaunch.dispose(); delete window.appChatLaunch; });
    await frame.locator('body').evaluate(() => { window.appChatLaunch.dispose(); delete window.appChatLaunch; });
  }
  await expect.poll(async () => (await state()).composer).toContain(`Color Mixing experiment ${frozen.id}`);
  await expect.poll(async () => (await state()).attachments?.length).toBe(1);
  if ((await state()).floatingChat) {
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    await expect.poll(async () => (await state()).chatCloseButtonBounds?.height || 0).toBeGreaterThan(0);
    const closeBounds = (await state()).chatCloseButtonBounds;
    await page.mouse.click(viewport.width - 51, closeBounds.y + closeBounds.height / 2);
    await expect.poll(async () => (await state()).floatingChat).toBe(false);
  }
  const active = async () => { const value = await state(); return value.chats[value.activeChat]; };
  expect((await active()).id).toBe(handoff.value.threadId);
  expect((await active()).agent).toBe('codex'); expect((await active()).scope).toEqual({ app: 'lab', panel: 'main' });
  const preparation = page.getByRole('region', { name: 'App environment', exact: true });
  if (await preparation.isVisible()) { await expect(preparation.getByRole('status')).toHaveText('Environment ready'); await preparation.getByRole('button', { name: 'Hide', exact: true }).click(); }
  await focusWorkbenchComposer(page);
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await active()).messages.filter(item => item.role === 'user').length).toBe(1);
  await expect.poll(async () => (await active()).messages.filter(item => item.role === 'assistant').at(-1)?.text ?? '', { timeout: 120000, intervals: [100, 250, 500] }).toContain('LAB_RESULT:');
  await expect.poll(async () => (await active()).state).toBe('idle');
  const text = (await active()).messages.filter(item => item.role === 'assistant').at(-1).text;
  fixture = JSON.parse(text.slice(text.indexOf('LAB_RESULT:') + 'LAB_RESULT:'.length));
  expect(fixture.error).toBeUndefined(); expect(fixture.fixture).toBe(true); expect(fixture.realModel).toBe(false);
  final = await readExperiment(frozen.id);
  expect(final.spec_hash).toBe(frozen.spec_hash); expect(final.criteria).toEqual(frozen.criteria);
  expect(final.trials).toHaveLength(2); expect(final.trials.map(t => t.verification.verdict)).toEqual(['FAIL', 'PASS']);
  expect(final.trials[1].parent_trial_id).toBe(final.trials[0].id);
  expect(final.trials.every(t => t.status === 'completed' && t.events.length === 8 && t.events.every(e => e.status === 'completed' && e.backend.version === '0.2.2'))).toBe(true);
  expect(final.decisions).toHaveLength(0);
  checks.push('Actual Host ACP fixture executes two linked PLR trials; frozen rules unchanged, synthetic FAIL then PASS, no paid model');
  await frame.getByRole('button', { name: 'Refresh', exact: true }).click();
  await frame.getByRole('combobox', { name: 'Trial', exact: true }).selectOption(final.trials[1].id);
  await frame.getByRole('tab', { name: 'Results', exact: true }).click();
  await expect(frame.getByRole('heading', { name: 'Independent verification: PASS', exact: true })).toBeVisible();
  await expect(frame.getByText('synthetic observation', { exact: true })).toBeVisible();
  await frame.getByRole('button', { name: 'Compare trials', exact: true }).click();
  await expect(frame.getByText('Improved', { exact: true })).toBeVisible();
  await page.screenshot({ path: resolve(out, 'results-light.png') });
  await frame.getByRole('textbox', { name: 'Review rationale', exact: true }).fill('Accept the illustrative software result only.');
  await frame.getByRole('button', { name: 'Accept trial', exact: true }).evaluate(button => button.click());
  await expect(frame.getByRole('alert')).toContainText('Review requires a direct UI interaction.');
  expect((await readExperiment(frozen.id)).decisions).toHaveLength(0);
  await frame.getByRole('button', { name: 'Accept trial', exact: true }).click();
  await expect(frame.getByText(/Accepted via UI/)).toBeVisible();
  final = await readExperiment(frozen.id);
  expect(final.decisions).toHaveLength(1); expect(final.decisions[0].human_identity_verified).toBe(false);
  // Electron owns downloads; use its real session event, as the Control Lab
  // acceptance does, rather than a browser Page event Electron does not emit.
  const exportPath = resolve(out, 'experiment-export.json');
  await rm(exportPath, { force: true });
  await app.evaluate(({ session }, path) => session.defaultSession.once('will-download', (_event, item) => item.setSavePath(path)), exportPath);
  await frame.getByRole('button', { name: 'Export JSON', exact: true }).click();
  let exported;
  await expect.poll(async () => {
    try { exported = JSON.parse(await readFile(exportPath, 'utf8')); return true; }
    catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) return false; throw error; }
  }).toBe(true);
  expect(exported.experiment).toEqual(final);
  const exportedBytes = await readFile(exportPath);
  exportReceipt = { filename: 'experiment-export.json', bytes: exportedBytes.length,
    sha256: createHash('sha256').update(exportedBytes).digest('hex') };
  for (const observation of final.trials.flatMap(trial => trial.observations)) {
    const bytes = Buffer.from(exported.assets[observation.sha256], 'base64');
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(observation.sha256);
  }
  checks.push('UI download saved real JSON bytes with a file digest and original observation asset hashes');
  await frame.getByRole('tab', { name: 'Deck', exact: true }).click();
  await expect(frame.getByRole('button', { name: 'B1, 100 microliters', exact: true })).toBeVisible();
  await page.screenshot({ path: resolve(out, 'deck-light.png') });
  await setAppearance(page, 'dark');
  await expect.poll(() => frame.locator('html').evaluate(element => element.style.colorScheme)).toBe('dark');
  await page.screenshot({ path: resolve(out, 'deck-dark.png') });
  // Close the visible dock through its actual header control before narrowing:
  // the Host intentionally gives an open dock all content space at this width.
  const appTop = await page.locator('#pero-app-surface').evaluate(element => element.getBoundingClientRect().top);
  await page.mouse.click(await page.evaluate(() => innerWidth - 18), appTop + 16);
  await expect.poll(async () => (await state()).appChatOpen).toBe(false);
  // The production main window has minWidth=1000; its sidebar leaves a narrow App pane.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 800));
  await expect.poll(() => page.evaluate(() => innerWidth)).toBe(1000);
  await expect(page.locator('iframe[title="lab"]')).toBeVisible();
  await expect(frame.getByRole('heading', { name: '96-well plate', exact: true })).toBeVisible();
  await expect.poll(() => frame.locator('html').evaluate(element => element.clientWidth > 300 && element.clientWidth <= 760 && element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await frame.getByRole('button', { name: 'B1, 100 microliters', exact: true }).click();
  narrowViewport = { scope: 'Supported Desktop minimum window; not mobile acceptance',
    window: await page.evaluate(() => ({ width: innerWidth, height: innerHeight })),
    app: await frame.locator('html').evaluate(element => ({ width: element.clientWidth, height: element.clientHeight, scrollWidth: element.scrollWidth })),
    chatOpen: (await state()).appChatOpen, plateVisible: true, targetWellClicked: true };
  await page.screenshot({ path: resolve(out, 'deck-dark-narrow.png') });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1488, 1000));
  await expect.poll(() => page.evaluate(() => innerWidth)).toBe(1488);
  checks.push('Actual App iframe displays deck, provenance, verification, comparison, explicit UI review and exported immutable evidence; light/dark/narrow');
  // Separate user-import UI path: bytes are test data, explicitly not instrument evidence.
  await expect(page.locator('iframe[title="lab"]')).toBeVisible();
  await expect(frame.getByRole('button', { name: 'New experiment', exact: true })).toBeVisible();
  await frame.getByRole('button', { name: 'New experiment', exact: true }).click();
  await frame.getByRole('textbox', { name: 'Objective', exact: true }).fill('Imported-file UI acceptance fixture');
  const importCreated = page.waitForResponse(response => new URL(response.url()).pathname === '/api/experiments' && response.request().method() === 'POST');
  await frame.getByRole('button', { name: 'Freeze experiment', exact: true }).click();
  const importedExperiment = await (await importCreated).json();
  await frame.getByRole('button', { name: 'Save candidate', exact: true }).click();
  await frame.getByRole('button', { name: 'Validate', exact: true }).click();
  await frame.getByRole('button', { name: 'Run simulation', exact: true }).click();
  await expect(frame.getByRole('heading', { name: 'Execution completed', exact: true })).toBeVisible();
  await frame.getByRole('tab', { name: 'Results', exact: true }).click();
  await frame.getByRole('textbox', { name: 'Measurement source', exact: true }).fill('User-supplied acceptance fixture; not an instrument measurement');
  const measurementBytes = Buffer.from('well,value,unit\r\nB1,0.5,fraction\r\n');
  await frame.getByLabel('Import CSV or JSON', { exact: true }).setInputFiles({ name: 'user-fixture.csv', mimeType: 'text/csv', buffer: measurementBytes });
  await expect(frame.getByText('imported observation', { exact: true })).toBeVisible();
  const imported = await readExperiment(importedExperiment.id);
  expect(imported.trials[0].observations[0].sha256).toBe(createHash('sha256').update(measurementBytes).digest('hex'));
  expect(imported.trials[0].observations[0].measurements).toEqual([{ well: 'B1', value: 0.5, unit: 'fraction' }]);
  await frame.getByRole('button', { name: 'Evaluate', exact: true }).click();
  await expect(frame.getByRole('heading', { name: 'Independent verification: PASS', exact: true })).toBeVisible();
  await page.screenshot({ path: resolve(out, 'imported-observation.png') });
  checks.push('UI imports user-supplied CSV test bytes with source, fraction units and exact original-byte SHA-256; never labelled device evidence');
  await closeDesktop(); await launch();
  await expect(frame.getByRole('combobox', { name: 'Saved experiments', exact: true })).toBeVisible();
  await frame.getByRole('combobox', { name: 'Saved experiments', exact: true }).selectOption(frozen.id);
  await frame.getByRole('tab', { name: 'Runs', exact: true }).click();
  await expect(frame.getByRole('heading', { name: 'Execution completed', exact: true })).toBeVisible();
  expect(await readExperiment(frozen.id)).toEqual(final);
  await page.screenshot({ path: resolve(out, 'reopened-run.png') });
  checks.push('Actual Desktop + Host + Python restart reopens byte-equivalent trial evidence without replay');
  expect(errors).toEqual([]);
} catch (error) {
  failure = error;
  if (page && !page.isClosed()) {
    await page.screenshot({ path: resolve(out, 'failure.png') }).catch(() => {});
    await writeFile(resolve(out, 'failure-state.json'), await state().then(value => JSON.stringify(value, null, 2)).catch(() => '{}'));
  }
} finally {
  try { await closeDesktop(); } catch (error) { failure ||= error; }
  await rm(temp, { recursive: true, force: true });
}
await writeFile(resolve(out, failure ? 'failure.json' : 'result.json'), JSON.stringify({ status: failure ? 'failed' : 'passed', scope: 'Real Desktop, Host, ACP fixture and PLR Chatterbox; not real model or physical lab acceptance', error: failure ? String(failure.stack || failure) : null, checks, errors, consoleErrors, cleanup, fixture, exportReceipt, narrowViewport, experiment: final }, null, 2));
if (failure) throw failure;

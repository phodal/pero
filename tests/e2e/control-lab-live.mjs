// Opt-in development acceptance: actual Desktop, Host MCP, Go ACP and solvers.
// It reserves a shared provider budget before *each* ACP process starts.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { fixtureExhaustionVerified, inspectSession } from '../runtime/control-lab/live-evidence.mjs';
import { startFixtureProvider } from '../runtime/control-lab/fixture-provider.mjs';
const root = resolve(import.meta.dirname, '../..');
const out = resolve(root, 'test-results/control-lab-live');
const execute = promisify(execFile);
const scene = process.env.PERO_CONTROL_LAB_LIVE_SCENE;
const agent = process.env.PERO_CONTROL_LAB_LIVE_AGENT;
const expectedHash = process.env.PERO_CONTROL_LAB_LIVE_AGENT_SHA256;
const reservation = Number(process.env.PERO_CONTROL_LAB_LIVE_RESERVATION);
const fixture = process.env.PERO_CONTROL_LAB_LOCAL_FIXTURE === '1';
if (process.env.PERO_CONTROL_LAB_REAL_MODEL !== '1' || !['p-golden', 'active-filter'].includes(scene) ||
    !agent || !isAbsolute(agent) || !/^[a-f0-9]{64}$/.test(expectedHash || '') ||
    !Number.isInteger(reservation) || reservation < 1 || reservation > 6 || !process.env.DEEPSEEK_API_KEY)
  throw new Error('Live Control Lab needs explicit opt-in, scene, absolute agent, agent SHA-256, reservation 1..6, and a credential in the environment');
if (fixture && (process.env.DEEPSEEK_API_KEY !== 'local-control-lab-fixture' || reservation !== 6 || scene !== 'p-golden'))
  throw new Error('The local fixture requires the synthetic key, P golden, and a six-attempt reservation');
if (!['linux', 'darwin'].includes(process.platform)) throw new Error('Live Control Lab process cleanup requires Unix');
if (createHash('sha256').update(await readFile(agent)).digest('hex') !== expectedHash) throw new Error('Agent hash mismatch');
await mkdir(out, { recursive: true });
const run = await mkdtemp(resolve(out, `${scene}-`));
const temp = await mkdtemp(resolve(tmpdir(), 'pero-control-lab-live-'));
const sessions = resolve(temp, 'sessions'), settings = resolve(temp, 'settings.json'), agents = resolve(temp, 'agents.json');
// A fresh isolated settings file leaves Computer Use disabled.
await writeFile(settings, JSON.stringify({ chat_agent: 'codex', computer_use: { enabled: false } }));
const env = { ...process.env, PERO_DESKTOP_DATA_DIR: resolve(temp, 'profile'), PERO_SETTINGS_PATH: settings,
  PERO_HISTORY_PATH: resolve(temp, 'history.jsonl'), PERO_AGENTS_FILE: agents, PERO_LOCALE: 'en' };
delete env.ELECTRON_RUN_AS_NODE; delete env.PERO_APPS_ROOT;
const ledgerPath = fixture ? resolve(run, 'fixture-ledger.json') : resolve(out, 'attempt-ledger.json');
let app, page, frame, frozen, final, transcript, failure, provider, cleanup = {}, evidence = {}, modelObserved = false, fixturePassed = false;
const state = () => page.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()));
const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; } };
const { expect } = await import('@playwright/test');
const { clickAppOpen } = await import('./sidebar-controls.mjs');
const { electron } = await import('./electron.mjs');
try {
  if (fixture) {
    const digest = 'sha256:' + createHash('sha256').update(await readFile(resolve(root, 'apps/control-lab/skills/control-design/SKILL.md'))).digest('hex');
    provider = await startFixtureProvider('control-design', digest);
  }
  await writeFile(agents, JSON.stringify([
    ...['pero', 'claude', 'copilot', 'grok', 'qoder', 'opencode'].map(id => ({ id, name: id, command: resolve(temp, `unavailable-${id}`) })),
    { id: 'codex', name: 'Control Lab bounded real agent', command: process.execPath,
      args: [resolve(root, 'tests/runtime/control-lab/live-agent.mjs'), agent, expectedHash, sessions, String(reservation),
        ...(fixture ? ['fixture', provider.endpoint, ledgerPath] : ['real'])] },
  ]));
  const python = process.env.PERO_APP_PYTHON || 'python3';
  await execute(python, ['-E', '-s', '-c', 'import control; print(control.__version__)'], { timeout: 30000 });
  if (scene === 'active-filter') await execute('ngspice', ['--version'], { timeout: 30000 });
  app = await electron.launch({ requiresNativeWindow: true, args: [...(process.platform === 'darwin' ? ['--use-mock-keychain'] : []), resolve(root, 'desktop')], cwd: root, env });
  page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1488, 1086));
  await page.waitForFunction(() => window.peroDiagnostics && !document.getElementById('loading'), undefined, { timeout: 60000 });
  await expect.poll(async () => (await state()).apps?.some(item => item.name === 'control-lab')).toBe(true);
  await page.waitForFunction(() => { const c = document.querySelector('canvas'); return c?.width === Math.round(innerWidth * devicePixelRatio) && c.height === Math.round(innerHeight * devicePixelRatio); });
  await page.mouse.click(80, await page.evaluate(() => innerHeight - 55));
  await expect.poll(async () => (await state()).navigation).toBe(7);
  await expect.poll(async () => (await state()).appsLoading).toBe(false);
  await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
  await clickAppOpen(page, 'control-lab');
  await expect.poll(async () => (await state()).activeContent).toEqual({ kind: 'app', value: { name: 'control-lab', panel: 'main' } });
  frame = page.frameLocator('iframe[title="control-lab"]');
  await expect(frame.getByLabel('Template', { exact: true })).toBeVisible({ timeout: 20000 });
  await frame.getByLabel('Template', { exact: true }).selectOption(scene);
  await frame.getByLabel('Total candidate budget', { exact: true }).fill('2');
  const created = page.waitForResponse(response => new URL(response.url()).pathname === '/api/experiments' && response.request().method() === 'POST');
  await frame.getByRole('button', { name: 'Freeze specification', exact: true }).click();
  const response = await created; expect(response.status()).toBe(201); frozen = await response.json();
  await frame.getByRole('button', { name: 'Approve goal and discuss', exact: true }).click();
  await expect.poll(async () => (await state()).composer).toContain(`Review Control Lab experiment ${frozen.id}`);
  await expect.poll(async () => (await state()).attachments?.length).toBe(1);
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  await page.mouse.click(viewport.width - 51, viewport.height - ((await state()).floatingChatExpanded ? 561 : 133));
  await expect.poll(async () => (await state()).floatingChat).toBe(false);
  const active = async () => { const value = await state(); return value.chats[value.activeChat]; };
  expect((await active()).agent).toBe('codex');
  expect((await active()).scope).toEqual({ app: 'control-lab', panel: 'main' });
  const edge = await page.locator('#pero-app-surface').evaluate(element => element.getBoundingClientRect().right);
  await page.mouse.click(edge + 120, await page.evaluate(() => innerHeight - 70));
  const cdp = await page.context().newCDPSession(page);
  // Revised after an observed P-golden development run; that run is not blind evidence.
  await cdp.send('Input.insertText', { text: `\nList skills, then read the ${scene === 'p-golden' ? 'control-design' : 'active-filter-design'} skill by its catalog digest. Call app_describe to inspect Control Lab's declared data tools; use app_write with experiment-step or propose-candidate for the approved experiment. Do not use generic app_use to operate Control Lab. Read the frozen experiment, evaluate baseline and inspect its saved evidence. If further candidates are needed, use search-next or propose a candidate within the frozen budget. Lock one candidate and run full verification. Check the saved report and observations; keep the frozen model, criteria and budget unchanged. Report the actual verifier verdict and any failed or missing evidence, or say if the work is incomplete. End with a JSON object containing experimentId, specHash, verdict, and explanation.` });
  await page.keyboard.press('Enter');
  await expect.poll(async () => { const chat = await active(); return chat.state !== 'idle' || chat.messages.some(item => item.role === 'assistant'); }, { timeout: 30000 }).toBe(true);
  await expect.poll(async () => (await active()).state, { timeout: 240000, intervals: [250, 500, 1000] }).toBe('idle');
  transcript = (await active()).messages.filter(item => item.role === 'assistant').map(item => item.text).join('\n');
  final = await frame.locator('body').evaluate(async (_body, id) => (await fetch(`/api/experiments/${id}`)).json(), frozen.id);
  const rawExport = await frame.locator('body').evaluate(async (_body, id) => {
    const response = await fetch(`/api/experiments/${id}/export`);
    if (!response.ok) throw new Error(`Export failed: ${response.status}`);
    return response.text();
  }, frozen.id);
  const exportPath = resolve(run, 'export.json');
  await writeFile(exportPath, rawExport);
  expect(JSON.parse(rawExport).experiment).toEqual(final);
  const validated = await execute(python, ['-E', '-s', '-B', resolve(root, 'tests/fixtures/control-lab-export.py'), exportPath], { encoding: 'utf8', timeout: 30000 });
  evidence.exportValidation = JSON.parse(validated.stdout);
  expect(final.id).toBe(frozen.id); expect(final.specHash).toBe(frozen.specHash);
  expect(final.criteria).toEqual(frozen.criteria); expect(final.parameters).toEqual(frozen.parameters);
  expect(final.candidateBudget).toBe(frozen.candidateBudget);
  expect(final.scenarios).toEqual(frozen.scenarios); expect(final.searchSpace).toEqual(frozen.searchSpace);
  expect(final.methodVersion).toBe(frozen.methodVersion);
  expect(final.candidates.length).toBeLessThanOrEqual(frozen.candidateBudget);
  expect(final.trials.length).toBeLessThanOrEqual(80);
  expect(final.trials.reduce((sum, trial) => sum + Math.max(0, ...(trial.observation?.series || []).map(series => series.x.length)), 0)).toBeLessThanOrEqual(40000);
  if (!fixture) {
    expect(evidence.exportValidation.reportReproduced).toBe(true);
    expect(final.report.verdict).toMatch(/^(PASS|FAIL|INCONCLUSIVE)$/);
    expect(final.lockedCandidateId).toBeTruthy();
    const verified = final.trials.filter(trial => trial.phase === 'verification' && trial.candidateId === final.lockedCandidateId && trial.operationId === final.verificationOperationId);
    expect(verified.map(trial => trial.scenarioId).sort()).toEqual(frozen.scenarios.filter(item => item.role === 'verification').map(item => item.id).sort());
    expect(verified.every(trial => trial.status === 'completed' && trial.observation?.engine === (scene === 'p-golden' ? 'python-control' : 'ngspice'))).toBe(true);
    if (scene === 'p-golden') {
      expect(final.report.verdict).toBe('FAIL');
      expect(final.report.checks.some(check => check.name.includes('Final-window target error') && check.verdict === 'FAIL')).toBe(true);
    }
    const object = /\{[^{}]*"experimentId"\s*:[^{}]*\}/s.exec(transcript)?.[0];
    const answer = JSON.parse(object || 'null');
    expect(answer).not.toBeNull();
    expect(answer.experimentId).toBe(frozen.id); expect(answer.specHash).toBe(frozen.specHash);
    expect(answer.verdict).toBe(final.report.verdict);
    if (scene === 'p-golden') expect(answer.explanation).toMatch(/tracking|target|steady|reference/i);
  }
} catch (error) { failure = String(error.stack || error); }
finally {
  if (app) {
    const owned = new Set([app.process().pid]);
    try {
      const { stdout } = await execute('ps', ['-axo', 'pid=,ppid=']);
      const tree = stdout.trim().split('\n').map(line => line.trim().split(/\s+/).map(Number));
      for (let changed = true; changed;) { changed = false; for (const [child, parent] of tree) if (owned.has(parent) && !owned.has(child)) { owned.add(child); changed = true; } }
      await app.close();
      await expect.poll(() => [...owned].filter(alive), { timeout: 15000 }).toEqual([]);
      cleanup = { ownedPids: [...owned], allExited: true };
    } catch (error) {
      failure ||= String(error.stack || error);
      for (const signal of ['SIGTERM', 'SIGKILL']) {
        for (const pid of [...owned].filter(alive)) try { process.kill(pid, signal); } catch (e) { if (e.code !== 'ESRCH') failure ||= String(e); }
        try { await expect.poll(() => [...owned].filter(alive), { timeout: 10000 }).toEqual([]); break; } catch {}
      }
      cleanup = { ownedPids: [...owned], allExited: [...owned].every(pid => !alive(pid)), recoveredShutdown: true };
    }
  }
  // The session contains only the synthetic task and actual tool events. Preserve
  // it before deleting the isolated profile, including on failure.
  try {
    const names = (await readdir(sessions)).filter(name => name.endsWith('.jsonl'));
    evidence.sessions = [];
    const skillName = scene === 'p-golden' ? 'control-design' : 'active-filter-design';
    const digest = 'sha256:' + createHash('sha256').update(await readFile(resolve(root, `apps/control-lab/skills/${skillName}/SKILL.md`))).digest('hex');
    for (const [index, name] of names.entries()) {
      const text = await readFile(resolve(sessions, name), 'utf8');
      await writeFile(resolve(run, `session-${index}.jsonl`), text, { mode: 0o600 });
      const events = text.trim().split('\n').map(line => JSON.parse(line).event).filter(Boolean);
      modelObserved ||= events.some(event => event.type === 'assistant/message' || event.type === 'tool/call');
      const summary = { tools: [...new Set(events.filter(event => event.type === 'request/header').flatMap(event => (event.data.tools || []).map(tool => tool.name)))],
        calls: events.filter(event => event.type === 'tool/call').map(event => event.data),
        usage: events.filter(event => event.type === 'assistant/message').map(event => event.data.usage ?? 'unknown'),
        budgetExhausted: events.some(event => event.type === 'turn/end' && /BUDGET_EXHAUSTED|provider request budget exhausted/i.test(event.data.error || '')) };
      try { summary.validated = inspectSession(events, skillName, digest, frozen?.id, fixture ? ['read', 'search'] : ['read', 'baseline', 'lock', 'verify']); }
      catch (error) { summary.validationFailure = String(error.message); failure ||= `Session evidence: ${error.message}`; }
      evidence.sessions.push(summary);
    }
    if (names.length !== 1) failure ||= `Expected one ACP session, found ${names.length}`;
  } catch (error) { failure ||= String(error.stack || error); }
  try {
    evidence.ledger = JSON.parse(await readFile(ledgerPath, 'utf8'));
    const audit = await readFile(`${ledgerPath}.attempts`, 'utf8');
    if (!/^(attempt\n)*$/.test(audit)) throw new Error('Malformed attempt audit');
    evidence.recordedHttpAttemptsTotal = audit.length / 'attempt\n'.length;
    if (evidence.recordedHttpAttemptsTotal > evidence.ledger.reserved) throw new Error('Attempt audit exceeds reserved budget');
  } catch (error) { evidence.ledgerError = String(error.message); failure ||= 'Attempt ledger or audit unavailable'; }
  // The record is durable before transport. A crash immediately after the
  // record can conservatively overcount an attempt that never reached HTTP.
  evidence.requestUpperBound = evidence.ledger?.reserved ?? 'unknown';
  evidence.agentHashAfter = createHash('sha256').update(await readFile(agent)).digest('hex');
  if (evidence.agentHashAfter !== expectedHash) failure ||= 'Agent binary changed during execution';
  if (provider) {
    evidence.fixtureHttpRequests = provider.attempts();
    await provider.close();
    fixturePassed = fixtureExhaustionVerified(failure, cleanup, evidence);
    if (!fixturePassed) failure ||= 'Fixture did not prove the expected budget-exhausted path';
  }
  await rm(temp, { recursive: true, force: true });
  await writeFile(resolve(run, 'result.json'), JSON.stringify({ status: fixturePassed ? 'fixture-budget-exhaustion-verified' : failure ? 'failed' : 'passed', fixture, realModel: !fixture && modelObserved,
    modelResponseObserved: modelObserved, realProviderAttemptedInTask: fixture ? false : (Number.isInteger(evidence.recordedHttpAttemptsTotal) ? evidence.recordedHttpAttemptsTotal > 0 : 'unknown'),
    scene, failure, frozen, experiment: final, transcript, evidence, cleanup, temporaryProfileRemoved: true }, null, 2));
}
if (failure && !fixturePassed) throw new Error(`Live Control Lab failed; evidence in ${run}: ${failure}`);
console.log(JSON.stringify({ status: fixturePassed ? 'fixture-budget-exhaustion-verified' : 'passed', realModel: !fixture, scene, experimentId: frozen.id, evidence: run }));

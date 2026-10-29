// Invoked by the opt-in Go harness with a real database, API and GitHub fixture.
import { expect } from '@playwright/test';
import { electron, focusPage } from './electron.mjs';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '../..');
const base = process.env.PERO_GITHUB_E2E_URL;
if (!base) throw new Error('Run through the Go Desktop/GitHub test harness');
const tokens = Object.fromEntries(['OPERATOR', 'ALICE', 'BOB', 'WORKER'].map(key => [key.toLowerCase(), process.env[`PERO_GITHUB_E2E_${key}`]]));
const out = resolve(root, 'test-results/github'); await mkdir(out, { recursive: true });
const temp = await mkdtemp(resolve(tmpdir(), 'pero-github-desktop-'));
const agents = resolve(temp, 'agents.json');
await writeFile(agents, JSON.stringify([{ id: 'fixture', name: 'ACP test fixture', command: process.execPath, args: [resolve(root, 'tests/fixtures/acp-agent.mjs')] }]));
await writeFile(resolve(temp, 'worker.json'), JSON.stringify({ workspaces: { default: temp }, agents_file: agents }));
const apps = [];
let worker;
const errors = [];
async function api(path, token = tokens.operator, method = 'GET', body) {
  const response = await fetch(base + path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, value: await response.json() };
}
async function launch(name, token, client = true) {
  const env = { ...process.env, PERO_CLOUD_URL: base, PERO_OPERATOR_TOKEN: tokens.operator, PERO_AGENTS_FILE: agents,
    PERO_SETTINGS_PATH: resolve(temp, `${name}-settings.json`), PERO_HISTORY_PATH: resolve(temp, `${name}-history.jsonl`),
    PERO_DESKTOP_DATA_DIR: resolve(temp, name), PERO_LOCALE: 'zh-CN' };
  delete env.ELECTRON_RUN_AS_NODE; delete env.PERO_CLIENT_TOKEN;
  // Deliberately retain the operator variable: client mode must never fall back to it.
  if (client) env.PERO_CLIENT_TOKEN = token;
  const app = await electron.launch({ args: [resolve(root, 'desktop')], cwd: root, env }); apps.push(app);
  const page = await app.firstWindow(); page.on('pageerror', e => errors.push(e.message));
  const state = () => page.evaluate(() => window.peroDiagnostics ? JSON.parse(window.peroDiagnostics.snapshot()) : { ready: false });
  await expect.poll(async () => (await state()).ready, { timeout: 60000 }).toBe(true);
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('remote-tasks').click());
  await expect.poll(async () => (await state()).remote.state.identity?.role).toBe(client ? 'client' : 'operator');
  expect((await state()).remote.state.error).toBe(null);
  const select = async taskID => {
    await page.evaluate(task_id => window.pero.remoteCommand({ action: 'remote_select', task_id }), taskID);
    await expect.poll(async () => (await state()).remote.state.detail?.task?.id).toBe(taskID);
  };
  return { app, page, state, select };
}
async function runWorker() {
  worker = spawn(resolve(root, 'target/debug/pero-worker'), ['--once'], { cwd: temp, env: { ...process.env,
    PERO_CLOUD_URL: base, PERO_WORKER_TOKEN: tokens.worker, PERO_WORKER_CONFIG: resolve(temp, 'worker.json'),
    PERO_WORKER_STATE: resolve(temp, 'worker-state.json') }, stdio: ['ignore', 'pipe', 'pipe'] });
  const processNow = worker;
  let output = ''; processNow.stderr.on('data', data => { output = (output + data).slice(-3000); });
  const code = await new Promise(done => processNow.once('exit', done));
  expect(code, output).toBe(0);
}
try {
  const operator = await launch('operator', tokens.operator, false);
  await expect.poll(async () => (await operator.state()).remote.state.github?.configured).toBe(true);
  await operator.page.screenshot({ path: resolve(out, 'operator-before-sync.png') });
  const width = await operator.page.evaluate(() => innerWidth);
  await operator.page.mouse.click(width - 200, 29);
  await expect.poll(async () => (await operator.state()).remote.state.tasks.filter(t => t.source).length, { timeout: 15000 }).toBe(2);
  const imported = (await operator.state()).remote.state.tasks;
  const automatic = imported.find(t => t.source?.issue_number === 1);
  const human = imported.find(t => t.source?.issue_number === 2);
  expect(automatic.state).toBe('queued'); expect(human.state).toBe('draft');
  await operator.select(automatic.id);
  await operator.page.screenshot({ path: resolve(out, 'automatic-policy.png') });
  await runWorker();
  await expect.poll(async () => (await api(`/api/v1/tasks/${automatic.id}`)).value.task.state).toBe('succeeded');
  const autoRun = (await api(`/api/v1/tasks/${automatic.id}`)).value.run.id;
  await operator.app.close(); apps.splice(apps.indexOf(operator.app), 1);

  const alice = await launch('alice', tokens.alice);
  const bob = await launch('bob', tokens.bob);
  expect((await alice.state()).remote.state.tasks.length).toBe(2);
  expect((await bob.state()).remote.state.tasks.length).toBe(2);
  const privateID = process.env.PERO_GITHUB_E2E_PRIVATE_TASK_ID;
  expect((await api(`/api/client/v1/tasks/${privateID}`, tokens.alice)).status).toBe(404);
  expect((await api('/api/v1/github/sync', tokens.bob, 'POST', {})).status).toBe(401);
  await alice.select(human.id); await bob.select(human.id);
  await focusPage(alice.page);
  await alice.page.screenshot({ path: resolve(out, 'available.png') });
  await alice.page.mouse.click(515, 217);
  await expect.poll(async () => (await alice.state()).remote.state.detail?.task?.claimed_by?.name).toBe('Alice');
  await expect.poll(async () => (await bob.state()).remote.state.detail?.task?.claimed_by?.name, { timeout: 10000 }).toBe('Alice');
  expect((await api(`/api/client/v1/tasks/${human.id}/claim`, tokens.bob, 'POST', {})).status).toBe(409);
  expect((await api(`/api/client/v1/tasks/${human.id}/dispatch`, tokens.bob, 'POST', {})).status).toBe(403);
  await alice.page.screenshot({ path: resolve(out, 'alice-claimed.png') });
  await alice.page.mouse.click(515, 217);
  await expect.poll(async () => (await alice.state()).remote.state.detail?.task?.claimed_by).toBe(undefined);
  await expect.poll(async () => (await bob.state()).remote.state.detail?.task?.claimed_by, { timeout: 10000 }).toBe(undefined);
  await focusPage(bob.page); await bob.page.mouse.click(515, 217);
  await expect.poll(async () => (await bob.state()).remote.state.detail?.task?.claimed_by?.name).toBe('Bob');
  await bob.page.mouse.click(590, 217);
  await expect.poll(async () => (await bob.state()).remote.state.detail?.task?.state).toBe('queued');
  await runWorker();
  await expect.poll(async () => (await bob.state()).remote.state.detail?.task?.state, { timeout: 15000 }).toBe('succeeded');
  await expect.poll(async () => (await alice.state()).remote.state.detail?.task?.state, { timeout: 10000 }).toBe('succeeded');
  await bob.page.screenshot({ path: resolve(out, 'bob-executed.png') });
  const sync = await api('/api/v1/github/sync', tokens.operator, 'POST', {});
  expect(sync.value.imported).toBe(0); expect(sync.value.dispatched).toBe(0);
  expect((await api(`/api/v1/tasks/${automatic.id}`)).value.run.id).toBe(autoRun);
  const original = (await api(`/api/v1/tasks/${human.id}`)).value;
  const sourceEvidence = { run_id: original.run.id, original_revision: original.task.source.revision };
  const observeSourcePhase = async phase => {
    const response = await fetch(process.env.PERO_GITHUB_E2E_CONTROL_URL, { method: 'POST',
      headers: { Authorization: `Bearer ${process.env.PERO_GITHUB_E2E_CONTROL_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ phase }) });
    expect(response.status).toBe(200);
    const beforeClick = (await response.json()).client_dispatch_requests;
    const synced = await api('/api/v1/github/sync', tokens.operator, 'POST', {});
    expect(synced.value.partial).toBe(false); expect(synced.value.dispatched).toBe(0);
    await expect.poll(async () => (await bob.state()).remote.state.detail?.task?.latest_source?.updated_at, { timeout: 10000 })
      .toBe(phase === 'changed' ? '2026-10-28T01:00:00Z' : '2026-10-28T02:00:00Z');
    const current = (await bob.state()).remote.state.detail;
    expect(current.task.latest_source.revision).not.toBe(original.task.source.revision);
    expect(current.task.latest_source.state).toBe(phase === 'closed' ? 'closed' : 'open');
    expect(current.task.source).toEqual(original.task.source);
    expect(current.task.prompt).toBe(original.task.prompt);
    expect(current.run).toEqual(original.run);
    await bob.page.screenshot({ path: resolve(out, `source-${phase}.png`) });
    // The warning adds one row above these controls. A disabled Execute must
    // produce neither an HTTP conflict banner nor another Run when clicked.
    await bob.page.mouse.click(590, 243);
    await bob.page.waitForTimeout(120);
    expect((await bob.state()).remote.state.error).toBe(null);
    expect((await api(`/api/v1/tasks/${human.id}`)).value.run.id).toBe(original.run.id);
    const metrics = await fetch(process.env.PERO_GITHUB_E2E_CONTROL_URL.replace(/\/human$/, '/metrics'), {
      headers: { Authorization: `Bearer ${process.env.PERO_GITHUB_E2E_CONTROL_TOKEN}` } });
    expect(metrics.status).toBe(200);
    const afterClick = (await metrics.json()).client_dispatch_requests;
    expect(afterClick).toBe(beforeClick);
    sourceEvidence[`${phase}_disabled_execute_dispatch_requests`] = afterClick - beforeClick;
    sourceEvidence[`${phase}_revision`] = current.task.latest_source.revision;
  };
  await observeSourcePhase('changed');
  await observeSourcePhase('closed');
  expect(sourceEvidence.closed_revision).not.toBe(sourceEvidence.changed_revision);
  await bob.page.emulateMedia({ colorScheme: 'dark' });
  await bob.page.reload();
  await expect.poll(async () => (await bob.state()).ready, { timeout: 60000 }).toBe(true);
  await bob.app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('remote-tasks').click());
  await expect.poll(async () => (await bob.state()).dark).toBe(true);
  await bob.select(human.id);
  await expect.poll(async () => (await bob.state()).remote.state.detail?.task?.claimed_by?.name).toBe('Bob');
  await bob.page.screenshot({ path: resolve(out, 'client-dark.png') });
  await bob.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 788));
  await expect.poll(async () => bob.page.evaluate(() => innerWidth)).toBe(1000);
  await expect.poll(async () => (await bob.state()).remote.state.detail?.task?.state).toBe('succeeded');
  await bob.page.screenshot({ path: resolve(out, 'client-narrow.png') });
  const final = (await bob.state()).remote.state;
  for (const token of Object.values(tokens)) expect(JSON.stringify(final)).not.toContain(token);
  expect(errors).toEqual([]);
  await writeFile(resolve(out, 'result.json'), JSON.stringify({ checks: ['GitHub sync via Desktop', 'project-scoped task visibility', 'automatic label dispatch once', 'atomic human claim', 'ownership conflict', 'release and claim handoff', 'independent Worker ACP execution', 'two clients observe same Run', 'changed and closed source gates retain frozen goal and Run', 'client dark and narrow layouts', 'credential exclusion'], sourceEvidence, state: final, errors }, null, 2));
  console.log(JSON.stringify({ checks: 'GitHub/Go/PostgreSQL/two Desktop clients/Worker', tasks: final.tasks.length, errors }));
} catch (error) {
  for (let i = 0; i < apps.length; i++) {
    const page = await apps[i].firstWindow();
    await page.screenshot({ path: resolve(out, `failure-${i}.png`) });
    console.error(await page.evaluate(() => window.peroDiagnostics?.snapshot()));
  }
  throw error;
} finally {
  for (const app of apps.reverse()) await app.close();
  if (worker?.exitCode === null) worker.kill('SIGTERM');
}

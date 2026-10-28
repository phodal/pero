// Opt-in public HTTPS acceptance. Only a dedicated project executes an ACP fixture.
import { _electron as electron, chromium, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { resolve } from 'node:path';

if (process.env.PERO_DEPLOYMENT_E2E !== '1') throw new Error('Opt in with PERO_DEPLOYMENT_E2E=1');
const root = resolve(import.meta.dirname, '../..');
const credentials = resolve(homedir(), '.config/openpero/task-center');
const operator = JSON.parse(await readFile(resolve(credentials, 'operator.json'), 'utf8'));
const client = JSON.parse(await readFile(resolve(credentials, 'client.json'), 'utf8'));
const base = 'https://app.openpero.com';
const out = resolve(root, 'test-results/deployment');
const temp = await mkdtemp(resolve(tmpdir(), 'pero-deployed-'));
await mkdir(out, { recursive: true });
const source = task => task.latest_source || task.source;
async function api(path, method = 'GET', body, token = operator.token) {
  const response = await fetch(base + path, {
    method, redirect: 'error', signal: AbortSignal.timeout(15000),
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  expect(response.ok, `API ${response.status}: ${path}`).toBe(true);
  return response.json();
}
async function allTasks() {
  const tasks = [];
  let cursor = '';
  for (let i = 0; i < 30; i++) {
    const page = await api(`/api/client/v1/tasks?limit=50${cursor ? `&cursor=${cursor}` : ''}`, 'GET', undefined, client.token);
    tasks.push(...page.tasks);
    if (!page.has_more) return tasks;
    cursor = page.next_cursor;
  }
  throw new Error('Task pagination exceeded acceptance bound');
}
let app, browser, worker;
const errors = [], checks = [], runs = [];
async function launch() {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('PERO_') && key !== 'ELECTRON_RUN_AS_NODE'));
  Object.assign(env, { PERO_DESKTOP_DATA_DIR: resolve(temp, 'desktop'), PERO_SETTINGS_PATH: resolve(temp, 'settings.json'),
    PERO_HISTORY_PATH: resolve(temp, 'history.jsonl'), PERO_LOCALE: 'zh-CN' });
  app = await electron.launch({ args: [resolve(root, 'desktop')], cwd: root, env });
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.show(); window.focus(); });
  await expect.poll(() => page.evaluate(() => document.hasFocus())).toBe(true);
  page.on('pageerror', error => errors.push(error.message));
  const state = () => page.evaluate(() => window.peroDiagnostics ? JSON.parse(window.peroDiagnostics.snapshot()) : { ready: false });
  await expect.poll(async () => (await state()).ready, { timeout: 60000 }).toBe(true);
  const command = value => page.evaluate(value => window.pero.remoteCommand(value), value);
  return { page, state, command };
}
async function stopWorker() {
  if (!worker || worker.exitCode !== null) return;
  const stopped = new Promise(done => worker.once('exit', done));
  worker.kill('SIGTERM');
  await stopped;
}
try {
  expect((await fetch(base + '/healthz')).status).toBe(200);
  expect((await fetch(base + '/api/v1/tasks')).status).toBe(401);
  const before = await allTasks();
  const roadmap = before.filter(task => source(task)?.kind === 'roadmap');
  const issues = before.filter(task => source(task)?.kind === 'github');
  expect(roadmap.length).toBeGreaterThan(0);
  const pinned = source(roadmap[0]);
  const github = await fetch(`https://api.github.com/repos/phodal/pero/contents/${pinned.path}?ref=${pinned.commit_sha}`, { signal: AbortSignal.timeout(15000) });
  expect(github.ok).toBe(true);
  const content = await github.json();
  const lines = Buffer.from(content.content, 'base64').toString('utf8').split('\n');
  const ledger = lines.flatMap((line, i) => /^\s*[-*+] \[[ xX]\] /.test(line) ? [i + 1] : []);
  expect(roadmap.map(task => source(task).line).sort((a, b) => a - b)).toEqual(ledger);
  expect(before.every(task => !task.current_run_id)).toBe(true);
  checks.push('valid HTTPS, unauthenticated API denied, all source pages match pinned checklist');

  const provisioned = await api('/api/v1/workers', 'POST', {
    name: 'Deployment acceptance fixture', projects: ['deployment-acceptance'], labels: ['fixture', 'no-model'],
  });
  const agents = resolve(temp, 'agents.json');
  await writeFile(agents, JSON.stringify([{ id: 'fixture', name: 'ACP acceptance fixture', command: process.execPath,
    args: [resolve(root, 'tests/fixtures/acp-agent.mjs')], env: {} }]));
  const workerConfig = resolve(temp, 'worker.json');
  await writeFile(workerConfig, JSON.stringify({ workspaces: { acceptance: temp }, agents_file: agents }));
  for (const cancel of [false, true]) {
    const task = await api('/api/v1/tasks', 'POST', { title: `Deployment fixture ${cancel ? 'cancellation' : 'completion'}`,
      prompt: cancel ? 'wait' : 'Return the scripted ACP fixture response. No repository work or model request.',
      acceptance: 'HTTPS dispatch protocol acceptance only; no business acceptance.',
      project_id: 'deployment-acceptance', workspace_key: 'acceptance', agent_id: 'fixture' });
    const run = await api(`/api/v1/tasks/${task.id}/dispatch`, 'POST', { worker_id: provisioned.worker.id });
    worker = spawn(resolve(root, 'target/debug/pero-worker'), ['--once'], { cwd: temp,
      env: { ...process.env, PERO_CLOUD_URL: base, PERO_WORKER_TOKEN: provisioned.token,
        PERO_WORKER_CONFIG: workerConfig, PERO_WORKER_STATE: resolve(temp, `worker-${cancel}.json`) },
      stdio: ['ignore', 'ignore', 'pipe'] });
    let log = '';
    worker.stderr.on('data', chunk => { log = (log + chunk).slice(-6000); });
    const finished = new Promise(done => worker.once('exit', done));
    if (cancel) {
      await expect.poll(async () => (await api(`/api/v1/tasks/${task.id}`)).task.state, { timeout: 45000 }).toBe('running');
      await api(`/api/v1/tasks/${task.id}/cancel`, 'POST', {});
    }
    await expect.poll(async () => (await api(`/api/v1/tasks/${task.id}`)).task.state, { timeout: 60000 }).toBe(cancel ? 'cancelled' : 'succeeded');
    expect(await finished, log.replaceAll(provisioned.token, '[redacted]')).toBe(0);
    const detail = await api(`/api/v1/tasks/${task.id}`);
    expect(detail.events.length).toBeGreaterThan(0);
    runs.push({ task_id: task.id, run_id: detail.run.id, outcome: detail.task.state, events: detail.events.length });
    expect((await fetch(`${base}/api/client/v1/tasks/${task.id}`, { headers: { Authorization: `Bearer ${client.token}` } })).status).toBe(404);
  }
  checks.push('public dispatch, Worker claim/events/completion and cancellation; acceptance project hidden from client');

  let ui = await launch();
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('remote-tasks').click());
  await expect.poll(async () => (await ui.state()).remote.state.connection.url).toBe(base);
  await ui.page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await ui.page.mouse.click(500, 289);
  await ui.page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await ui.page.keyboard.insertText(client.token);
  await ui.page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await ui.page.screenshot({ path: resolve(out, 'default-connection-masked.png') });
  await ui.page.mouse.click(255, 395);
  await expect.poll(async () => (await ui.state()).remote.state.identity?.role, { timeout: 30000 }).toBe('client');
  await expect.poll(async () => (await ui.state()).remote.state.loading, { timeout: 45000 }).toBe(false);
  expect((await ui.state()).remote.state.error).toBe(null);
  await ui.page.screenshot({ path: resolve(out, 'desktop-connected-light.png') });
  await app.close(); app = undefined;
  ui = await launch();
  await expect.poll(async () => (await ui.state()).navigation).toBe(3);
  await expect.poll(async () => (await ui.state()).remote.state.identity?.role, { timeout: 30000 }).toBe('client');
  await ui.command({ action: 'remote_filter', source_kind: 'roadmap', tag: '' });
  for (let i = 0; i < 20; i++) {
    await expect.poll(async () => (await ui.state()).remote.state.loading, { timeout: 45000 }).toBe(false);
    expect((await ui.state()).remote.state.error).toBe(null);
    if (!(await ui.state()).remote.state.has_more) break;
    await ui.command({ action: 'remote_more' });
  }
  expect((await ui.state()).remote.state.tasks.length).toBe(roadmap.length);
  await ui.page.screenshot({ path: resolve(out, 'desktop-roadmap.png') });
  await ui.page.emulateMedia({ colorScheme: 'dark' });
  await ui.page.reload();
  await expect.poll(async () => (await ui.state()).dark, { timeout: 30000 }).toBe(true);
  await expect.poll(async () => (await ui.state()).remote.state.identity?.role, { timeout: 30000 }).toBe('client');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 788));
  await ui.page.screenshot({ path: resolve(out, 'desktop-narrow-dark.png') });
  const state = JSON.stringify(await ui.state());
  expect(state).not.toContain(client.token);
  expect(state).not.toContain(operator.token);
  expect(errors).toEqual([]);
  const after = await allTasks();
  expect(after.map(task => task.id).sort()).toEqual(before.map(task => task.id).sort());
  expect(after.every(task => !task.current_run_id)).toBe(true);
  checks.push('default origin accepted from blank URL, actual masked form, encrypted restart, full ROADMAP pagination, dark/narrow Desktop, no source execution');

  browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(base);
  await expect(page.getByRole('heading', { name: '任务广场', exact: true })).toBeVisible();
  await page.screenshot({ path: resolve(out, 'web-light.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'dark' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: resolve(out, 'web-narrow-dark.png') });
  checks.push('public Web root redirect, empty/publication state and mobile dark layout');
  await writeFile(resolve(out, 'result.json'), JSON.stringify({ base, issue_count: issues.length,
    roadmap_count: roadmap.length, checked_count: roadmap.filter(task => source(task).state === 'closed').length,
    source_commit: pinned.commit_sha, runs, checks, errors }, null, 2));
  console.log(JSON.stringify({ base, issues: issues.length, roadmap: roadmap.length, runs, checks: checks.length, errors }));
} finally {
  await app?.close();
  await browser?.close();
  await stopWorker();
  await rm(temp, { recursive: true, force: true });
}

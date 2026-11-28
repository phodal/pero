import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { expect } from '@playwright/test';
import { electron } from './electron.mjs';

const root = resolve(import.meta.dirname, '../..');
const [binary, output] = process.argv.slice(2).map(path => resolve(path));
assert(binary && output && process.env.PERO_TEST_DATABASE_URL, 'Use an isolated PostgreSQL database and the Go server binary.');
const database = new URL(process.env.PERO_TEST_DATABASE_URL);
assert(['', '127.0.0.1', 'localhost', '[::1]'].includes(database.hostname), 'The fixture database must be local.');
assert(database.searchParams.getAll('host').every(host => host.startsWith('/')), 'A host override must be a local Unix socket.');
await mkdir(output, { recursive: true });
const profile = await mkdtemp(join(output, 'desktop-profile-'));
const operator = randomUUID();
const control = spawn(binary, [], {
  env: { ...process.env, PERO_DATABASE_URL: database.toString(), PERO_OPERATOR_TOKEN: operator, PERO_LISTEN: '127.0.0.1:0' },
  stdio: ['ignore', 'ignore', 'pipe'],
});
const controlExit = once(control, 'exit');
let log = '';
control.stderr.on('data', chunk => { log += chunk; });
let origin;
let app;
let page;
const snapshot = () => page.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()));

async function api(path, token, payload, key = '') {
  const result = await fetch(origin + path, {
    method: payload ? 'POST' : 'GET',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', ...(key && { 'Idempotency-Key': key }) },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  assert.ok(result.ok, `Request failed with status ${result.status} for ${path}`);
  return result.json();
}

async function bounds(key) {
  let hit;
  await expect.poll(async () => {
    hit = (await snapshot()).projectControls[key];
    return hit?.width ?? 0;
  }, { timeout: 30000, message: 'Visible Project control ' + key }).toBeGreaterThan(0);
  return hit;
}

async function click(key) {
  const hit = await bounds(key);
  await page.mouse.click(hit.x + hit.width / 2, hit.y + hit.height / 2);
}

try {
  await expect.poll(() => {
    assert.equal(control.exitCode, null, log);
    origin = log.match(/listening on (127\.0\.0\.1:\d+)/)?.[1];
    return origin;
  }, { timeout: 20000 }).toBeTruthy();
  origin = 'http://' + origin;
  const project = 'delivery-' + randomUUID().slice(0, 8);
  const account = await api('/api/v1/clients', operator, { name: 'Project collaborator', projects: [project] });
  const stages = {};
  for (const [stage, worker, agent] of [
    ['analysis', 'Mac Studio', 'dsh-go'],
    ['implementation', 'MacBook Pro', 'codex-acp'],
    ['verification', 'Verification runner', 'dsh-go'],
  ]) {
    const { worker: machine } = await api('/api/v1/workers', operator, { name: worker, projects: [project] });
    const task = await api('/api/v1/tasks', operator, {
      title: stage, prompt: 'Exercise delivery projection', acceptance: 'Retain exact Run',
      project_id: project, workspace_key: 'task-inbox', agent_id: agent,
    }, project + '-' + stage);
    const run = await api('/api/v1/tasks/' + task.id + '/dispatch', operator, { worker_id: machine.id }, task.id);
    stages[stage] = { task_id: task.id, run_id: run.id, generation: run.generation };
  }
  const endpoint = '/api/client/v1/projects/' + project + '/coding-deliveries';
  const delivery = await api(endpoint, account.token, {
    title: 'Archive and restore tasks', base_sha: '7f4425c9'.repeat(5), ...stages,
  }, 'archive-and-restore');
  app = await electron.launch({
    args: [...(process.platform === 'darwin' ? ['--use-mock-keychain'] : []), resolve(root, 'desktop')],
    cwd: root,
    env: { ...process.env, PERO_DESKTOP_DATA_DIR: profile, PERO_SETTINGS_PATH: join(profile, 'settings.json'),
      PERO_HISTORY_PATH: join(profile, 'history.jsonl'), PERO_CLOUD_URL: origin, PERO_CLIENT_TOKEN: account.token, PERO_LOCALE: 'en' },
  });
  page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1400, 900));
  await page.waitForFunction(() => window.peroDiagnostics &&
    (!document.getElementById('loading') || document.querySelector('#loading[role="alert"]')), undefined, { timeout: 90000 });
  assert.equal(await page.locator('#loading').count(), 0, 'Desktop Workbench failed to open');
  await click('sidebar:open:shared:' + project);
  const splitter = await bounds('agent:splitter');
  const x = splitter.x + splitter.width / 2;
  const y = splitter.y + splitter.height / 2;
  if (x > 800) {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(780, y, { steps: 8 });
    await page.mouse.up();
    await expect.poll(async () => (await bounds('agent:splitter')).x).toBeLessThan(800);
  }
  await click('tab:delivery.title');
  await click('delivery:record:' + delivery.id);
  for (const ref of Object.values(stages)) await bounds('delivery:run:' + ref.run_id);
  const runId = stages.analysis.run_id;
  await bounds(`delivery:status:${runId}:queued`);
  await api('/api/v1/tasks/' + stages.analysis.task_id + '/cancel', operator, {});
  await click('delivery:refresh');
  await bounds(`delivery:status:${runId}:cancelled`);
  await page.screenshot({ path: join(output, 'coding-delivery.png'), scale: 'css' });
  console.log('Desktop reopened three exact Runs and refreshed a changed status without replacing the original Run.');
} catch (error) {
  await page?.screenshot({ path: join(output, 'coding-delivery-failure.png'), scale: 'css' }).catch(() => {});
  throw error;
} finally {
  try {
    await app?.close();
  } finally {
    if (control.exitCode === null) control.kill();
    await controlExit;
    await rm(profile, { recursive: true, force: true, maxRetries: 3 });
  }
}

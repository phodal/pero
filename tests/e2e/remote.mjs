// Real Electron -> Go HTTP -> PostgreSQL -> independent Rust Worker -> ACP fixture.
// This does not contact model providers or deploy to a public host.
import { _electron as electron, expect } from '@playwright/test';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import Ajv2020 from 'ajv/dist/2020.js';
import schema from '../../protocol/generated/remote.schema.json' with { type: 'json' };

const database = process.env.PERO_TEST_DATABASE_URL;
if (!database) throw new Error('Set PERO_TEST_DATABASE_URL to an isolated PostgreSQL test database');
const root = resolve(import.meta.dirname, '../..');
const out = resolve(root, 'test-results/remote');
const temp = await mkdtemp(resolve(tmpdir(), 'pero-remote-e2e-'));
await mkdir(out, { recursive: true });
const namespace = `remote_${randomUUID().replaceAll('-', '')}`;
execFileSync('psql', [database, '-v', 'ON_ERROR_STOP=1', '-c', `CREATE SCHEMA "${namespace}"`], { stdio: 'pipe' });
const db = new URL(database); db.searchParams.set('search_path', namespace);
const port = await new Promise(done => {
  const socket = createServer(); socket.listen(0, '127.0.0.1', () => { const port = socket.address().port; socket.close(() => done(port)); });
});
const base = `http://127.0.0.1:${port}`;
const operator = randomUUID();
const serverBin = resolve(temp, 'pero-server');
execFileSync('go', ['build', '-o', serverBin, './cmd/server'], { cwd: resolve(root, 'server'), stdio: 'pipe' });
const agents = resolve(temp, 'agents.json');
await writeFile(agents, JSON.stringify([{ id: 'fixture', name: 'ACP test fixture', command: process.execPath, args: [resolve(root, 'tests/fixtures/remote-env-agent.mjs')] }]));
await writeFile(resolve(temp, 'worker.json'), JSON.stringify({ workspaces: { default: temp }, agents_file: agents }));
const ajv = new Ajv2020({ strict: false }); ajv.addSchema(schema);
const validate = (name, value) => {
  const valid = ajv.getSchema(`${schema.$id}#/$defs/${name}`);
  expect(valid(value), `${name}: ${ajv.errorsText(valid.errors)}`).toBe(true);
};
const request = async (path, method = 'GET', body, token = operator) => {
  const response = await fetch(base + path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const value = await response.json();
  expect(response.ok, JSON.stringify(value)).toBe(true);
  return value;
};
let logs = '';
let server;
let worker;
let app;
const errors = [];
const startServer = async () => {
  server = spawn(serverBin, [], { env: { ...process.env, PERO_DATABASE_URL: db.href, PERO_OPERATOR_TOKEN: operator, PERO_LISTEN: `127.0.0.1:${port}`, PERO_LEASE_SECONDS: '12' }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stderr.on('data', data => { logs = (logs + data).slice(-12000); });
  await expect.poll(async () => { try { return (await fetch(base + '/healthz')).status; } catch { return 0; } }, { timeout: 15000 }).toBe(200);
};
const stop = async (child) => {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([new Promise(done => child.once('exit', done)), new Promise(done => setTimeout(() => { child.kill('SIGKILL'); done(); }, 5000))]);
};
try {
  await startServer();
  const provisioned = await request('/api/v1/workers', 'POST', { name: 'Desktop acceptance Worker', projects: ['default'], labels: ['fixture'] });
  validate('WorkerCredential', provisioned);
  const startWorker = () => {
    worker = spawn(resolve(root, 'target/debug/pero-worker'), ['--once'], { cwd: temp, env: { ...process.env, PERO_CLOUD_URL: base, PERO_WORKER_TOKEN: provisioned.token, PERO_WORKER_CONFIG: resolve(temp, 'worker.json'), PERO_WORKER_STATE: resolve(temp, 'worker-state.json') }, stdio: ['ignore', 'pipe', 'pipe'] });
    worker.stderr.on('data', data => { logs = (logs + data).slice(-12000); });
    return worker;
  };
  const env = { ...process.env, PERO_CLOUD_URL: base, PERO_OPERATOR_TOKEN: operator, PERO_DATABASE_URL: db.href, FIXTURE_ENV_REPORT: resolve(temp, 'local-agent-env.json'), PERO_DESKTOP_DATA_DIR: resolve(temp, 'profile'), PERO_SETTINGS_PATH: resolve(temp, 'settings.json'), PERO_HISTORY_PATH: resolve(temp, 'history.jsonl'), PERO_AGENTS_FILE: agents, PERO_LOCALE: 'zh-CN' };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ args: [resolve(root, 'desktop')], cwd: root, env });
  const page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  const state = () => page.evaluate(() => window.peroDiagnostics ? JSON.parse(window.peroDiagnostics.snapshot()) : { ready: false });
  await expect.poll(async () => (await state()).ready, { timeout: 60000 }).toBe(true);
  await expect.poll(async () => (await state()).agents?.length).toBe(4);
  await page.evaluate(() => window.pero.sessionCommand({ action: 'new_session', thread_id: 'credential-probe', agent_id: 'fixture' }));
  await expect.poll(async () => (await state()).chats?.[0]?.state).toBe('idle');
  expect(JSON.parse(await readFile(resolve(temp, 'local-agent-env.json'), 'utf8')).leaked).toEqual([]);
  await page.evaluate(() => window.pero.sessionCommand({ action: 'close', thread_id: 'credential-probe' }));
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('remote-tasks').click());
  await expect.poll(async () => (await state()).navigation).toBe(3);
  await expect.poll(async () => (await state()).remote.state.workers?.length, { timeout: 15000 }).toBe(1);
  validate('RemoteState', (await state()).remote.state);
  await page.screenshot({ path: resolve(out, 'empty.png') });
  const create = async (title, prompt) => {
    await page.mouse.click(484, 32);
    await expect.poll(async () => (await state()).remote.creating).toBe(true);
    await page.keyboard.press('Meta+A'); await page.keyboard.insertText(title);
    await expect.poll(async () => (await state()).remote.title).toBe(title);
    await page.mouse.click(936, 228); await page.keyboard.press('Meta+A'); await page.keyboard.insertText(prompt);
    await expect.poll(async () => (await state()).remote.prompt).toBe(prompt);
    await page.mouse.click(936, 378); await page.keyboard.press('Meta+A'); await page.keyboard.insertText('返回测试回复，保留执行事件');
    await expect.poll(async () => (await state()).remote.acceptance).toBe('返回测试回复，保留执行事件');
    // Custom fixture is appended to the three built-in local Agent choices.
    await page.mouse.click(876, 539);
    await expect.poll(async () => (await state()).remote.agent).toBe('fixture');
    await page.screenshot({ path: resolve(out, 'create-form.png') });
    await page.mouse.click(609, 578);
    await expect.poll(async () => (await state()).remote.creating, { timeout: 15000 }).toBe(false);
    await expect.poll(async () => (await state()).remote.state.detail?.task?.title).toBe(title);
    expect((await state()).remote.state.detail.task.state).toBe('draft');
    await page.screenshot({ path: resolve(out, 'draft.png') });
  };
  await create('远程执行验收', '你好，请返回一条 fixture 回复');
  await page.mouse.click(622, 248);
  await expect.poll(async () => (await state()).remote.state.detail?.task?.state).toBe('queued');
  startWorker();
  await expect.poll(async () => (await state()).remote.state.detail?.task?.state, { timeout: 30000 }).toBe('succeeded');
  let detail = (await state()).remote.state.detail;
  validate('Detail', detail);
  expect(detail.events.some(event => event.kind === 'session_update')).toBe(true);
  expect(detail.run.worker_id).toBe(provisioned.worker.id);
  await page.screenshot({ path: resolve(out, 'completed.png') });
  await stop(worker);
  await create('停止远程任务', 'wait');
  await page.mouse.click(622, 248);
  await expect.poll(async () => (await state()).remote.state.detail?.task?.state).toBe('queued');
  startWorker();
  await expect.poll(async () => (await state()).remote.state.detail?.task?.state, { timeout: 20000 }).toBe('running');
  await page.screenshot({ path: resolve(out, 'running.png') });
  await page.mouse.click(611, 248);
  await expect.poll(async () => (await state()).remote.confirm_cancel !== null).toBe(true);
  await page.screenshot({ path: resolve(out, 'cancel-confirmation.png') });
  await page.mouse.click(882, 250);
  await expect.poll(async () => (await state()).remote.state.detail?.task?.state, { timeout: 30000 }).toBe('cancelled');
  await page.screenshot({ path: resolve(out, 'cancelled.png') });
  await stop(worker);
  await stop(server);
  await page.mouse.click(405, 32);
  await expect.poll(async () => !!(await state()).remote.state.error, { timeout: 15000 }).toBe(true);
  await page.screenshot({ path: resolve(out, 'connection-error.png') });
  await startServer();
  await page.mouse.click(405, 32);
  await expect.poll(async () => (await state()).remote.state.error, { timeout: 15000 }).toBe(null);
  expect((await state()).remote.state.tasks.length).toBe(2);
  for (let i = 0; i < 49; i++) {
    await request('/api/v1/tasks', 'POST', { title: `Pagination ${i}`, prompt: 'Fixture pagination draft', acceptance: 'No execution requested', project_id: 'default', workspace_key: 'default', agent_id: 'fixture' });
  }
  await page.mouse.click(405, 32);
  await expect.poll(async () => (await state()).remote.state.tasks.length).toBe(50);
  expect((await state()).remote.state.has_more).toBe(true);
  await page.mouse.click(372, await page.evaluate(() => innerHeight - 20));
  await expect.poll(async () => (await state()).remote.state.tasks.length).toBe(51);
  expect((await state()).remote.state.has_more).toBe(false);
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('locale-en').click());
  await expect.poll(async () => (await state()).locale).toBe('en');
  await page.screenshot({ path: resolve(out, 'english.png') });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.reload();
  await page.waitForFunction(() => window.peroDiagnostics, undefined, { timeout: 60000 });
  await expect.poll(async () => (await state()).ready).toBe(true);
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('remote-tasks').click());
  await expect.poll(async () => (await state()).navigation).toBe(3);
  await expect.poll(async () => (await state()).dark).toBe(true);
  await expect.poll(async () => (await state()).remote.state.tasks?.length).toBe(51);
  await page.screenshot({ path: resolve(out, 'dark.png') });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 788));
  await page.screenshot({ path: resolve(out, 'narrow.png') });
  const final = await state();
  validate('RemoteState', final.remote.state);
  expect(JSON.stringify(final)).not.toContain(provisioned.token);
  expect(JSON.stringify(final)).not.toContain(operator);
  expect(errors).toEqual([]);
  await writeFile(resolve(out, 'result.json'), JSON.stringify({ checks: ['Desktop create/dispatch', 'Rust ACP execution', 'PostgreSQL events', 'confirmed cancellation', 'server restart recovery', 'connection error', 'English', 'dark', 'narrow', 'credentials excluded'], state: final.remote, errors }, null, 2));
  console.log(JSON.stringify({ checks: 'remote Desktop/Go/PostgreSQL/Worker integration', tasks: final.remote.state.tasks.length, errors }));
  await app.close(); app = undefined;
  const unconfiguredEnv = { ...env, PERO_DESKTOP_DATA_DIR: resolve(temp, 'unconfigured-profile') };
  delete unconfiguredEnv.PERO_CLOUD_URL; delete unconfiguredEnv.PERO_OPERATOR_TOKEN;
  app = await electron.launch({ args: [resolve(root, 'desktop')], cwd: root, env: unconfiguredEnv });
  const unconfiguredPage = await app.firstWindow();
  await unconfiguredPage.waitForFunction(() => window.peroDiagnostics, undefined, { timeout: 60000 });
  await expect.poll(async () => (await unconfiguredPage.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()))).ready).toBe(true);
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('remote-tasks').click());
  await expect.poll(async () => (await unconfiguredPage.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()))).navigation).toBe(3);
  expect(await unconfiguredPage.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()).remote.state.configured)).toBe(false);
  await unconfiguredPage.screenshot({ path: resolve(out, 'unconfigured.png') });
} catch (error) {
  if (app) {
    const page = await app.firstWindow();
    await page.screenshot({ path: resolve(out, 'failure.png') });
    console.error(await page.evaluate(() => window.peroDiagnostics?.snapshot()));
  }
  console.error(logs);
  throw error;
} finally {
  if (app) await app.close();
  await stop(worker); await stop(server);
  execFileSync('psql', [database, '-v', 'ON_ERROR_STOP=1', '-c', `DROP SCHEMA "${namespace}" CASCADE`], { stdio: 'pipe' });
}

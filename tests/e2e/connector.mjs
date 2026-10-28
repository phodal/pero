// Actual Desktop form -> encrypted preferences -> Go HTTP -> PostgreSQL -> sources.
// Invoked by TestDesktopConnectorSources; never starts an Agent or writes GitHub.
import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

if (!process.env.PERO_CONNECTOR_E2E_CONFIG) throw new Error('Run through the Go connector acceptance harness');
const config = JSON.parse(await readFile(process.env.PERO_CONNECTOR_E2E_CONFIG, 'utf8'));
const root = resolve(import.meta.dirname, '../..');
const out = resolve(root, `test-results/connector/${config.live ? 'live' : 'fixture'}`);
const temp = await mkdtemp(resolve(tmpdir(), 'pero-connector-desktop-'));
const settings = resolve(temp, 'settings.json');
await mkdir(out, { recursive: true });
await Promise.all(['failure.json', 'failure.png'].map(name => rm(resolve(out, name), { force: true })));
const errors = [], checks = [];
let app, ui;
const redacted = value => String(value).replaceAll(config.client_token, '[redacted]').replaceAll(config.operator_token, '[redacted]');
const observed = task => task.latest_source || task.source;
const sorted = items => [...items].sort();
async function api(path, token = config.operator_token) {
  const response = await fetch(config.url + path, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000) });
  return { status: response.status, value: await response.json() };
}
async function apiTasks(token = config.operator_token, prefix = '/api/v1') {
  const tasks = [];
  let cursor = '';
  for (let page = 0; page < 50; page++) {
    const result = await api(`${prefix}/tasks?limit=50${cursor ? `&cursor=${cursor}` : ''}`, token);
    expect(result.status).toBe(200);
    tasks.push(...result.value.tasks);
    if (!result.value.has_more) return tasks;
    expect(result.value.next_cursor).toBeTruthy();
    cursor = result.value.next_cursor;
  }
  throw new Error('API task denominator exceeded bounded pagination');
}
async function launch() {
  // Credential and cloud variables cannot configure or authorize this app.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('PERO_') && key !== 'ELECTRON_RUN_AS_NODE'));
  Object.assign(env, { PERO_SETTINGS_PATH: settings, PERO_HISTORY_PATH: resolve(temp, 'history.jsonl'),
    PERO_DESKTOP_DATA_DIR: resolve(temp, 'profile'), PERO_LOCALE: 'zh-CN' });
  app = await electron.launch({ args: [resolve(root, 'desktop')], cwd: root, env });
  const page = await app.firstWindow();
  page.on('pageerror', error => errors.push(redacted(error.message)));
  const state = () => page.evaluate(() => window.peroDiagnostics ? JSON.parse(window.peroDiagnostics.snapshot()) : { ready: false });
  await expect.poll(async () => (await state()).ready, { timeout: 60000 }).toBe(true);
  const command = command => page.evaluate(command => window.pero.remoteCommand(command), command);
  const select = async task_id => {
    await command({ action: 'remote_select', task_id });
    await expect.poll(async () => (await state()).remote.state.detail?.task?.id).toBe(task_id);
  };
  ui = { page, state, command, select };
  return ui;
}
async function capture(name) {
  expect(JSON.stringify(await ui.state())).not.toContain(config.client_token);
  expect(JSON.stringify(await ui.state())).not.toContain(config.operator_token);
  await ui.page.screenshot({ path: resolve(out, `${name}.png`) });
}
async function sourceTab(kind) {
  await ui.page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await ui.page.mouse.click({ '': 335, github: 369, roadmap: 419 }[kind], 137);
  await expect.poll(async () => (await ui.state()).remote.state.source_kind).toBe(kind);
  await expect.poll(async () => (await ui.state()).remote.state.loading).toBe(false);
  expect((await ui.state()).remote.state.error).toBe(null);
}
async function allPages() {
  for (let page = 0; page < 50; page++) {
    const before = (await ui.state()).remote.state;
    if (!before.has_more) return before.tasks;
    // This existing read-only action is bounded; first-page controls are checked visually.
    await ui.command({ action: 'remote_more' });
    await expect.poll(async () => (await ui.state()).remote.state.loading).toBe(false);
    expect((await ui.state()).remote.state.error).toBe(null);
    expect((await ui.state()).remote.state.tasks.length).toBeGreaterThan(before.tasks.length);
  }
  throw new Error('Desktop task denominator exceeded bounded pagination');
}
try {
  const before = await apiTasks();
  const beforeIDs = sorted(before.map(task => task.id));
  expect(before.every(task => !task.current_run_id && !task.run)).toBe(true);
  expect((await api(`/api/client/v1/tasks/${config.private_task_id}`, config.client_token)).status).toBe(404);
  const scoped = await apiTasks(config.client_token, '/api/client/v1');
  expect(scoped.some(task => task.id === config.private_task_id)).toBe(false);
  expect(JSON.stringify(scoped)).not.toContain('PRIVATE_CONNECTOR_GOAL');
  checks.push('scoped API excludes private task and goal');

  await launch();
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('remote-tasks').click());
  await expect.poll(async () => (await ui.state()).navigation).toBe(3);
  expect((await ui.state()).remote.state.configured).toBe(false);
  await capture('unconfigured');
  await ui.page.mouse.click(255, 395);
  await ui.page.waitForTimeout(120);
  expect((await ui.state()).remote.state.configured).toBe(false);
  await capture('required-fields-error');
  await ui.page.mouse.click(500, 154);
  await ui.page.keyboard.press('Meta+A'); await ui.page.keyboard.insertText(config.url);
  await expect.poll(async () => (await ui.state()).remote.connection_url).toBe(config.url);
  await capture('url-entered');
  await ui.page.mouse.click(500, 289);
  await ui.page.waitForTimeout(120);
  await ui.page.keyboard.insertText(config.client_token);
  await capture('masked-connection-form');
  await ui.page.mouse.click(255, 434);
  await expect.poll(async () => (await ui.state()).remote.state.identity?.role, { timeout: 15000 }).toBe('client');
  await expect.poll(async () => (await ui.state()).remote.state.loading).toBe(false);
  expect((await ui.state()).remote.state.configured).toBe(true);
  expect((await ui.state()).remote.state.error).toBe(null);
  expect((await ui.state()).remote.state.github.repositories.map(repo => `${repo.owner}/${repo.repo}`)).toContain(config.repository);
  expect((await ui.state()).remote.state.identity.projects).toEqual(['default']);
  const stored = JSON.parse(await readFile(settings, 'utf8')).remote_connection;
  expect(stored).toMatchObject({ url: config.url, mode: 'client' });
  expect(stored.encrypted_token.length).toBeGreaterThan(0);
  expect(await readFile(settings, 'utf8')).not.toContain(config.client_token);
  if (process.platform !== 'win32') expect((await stat(settings)).mode & 0o777).toBe(0o600);
  expect(JSON.stringify(await ui.state())).not.toContain(stored.encrypted_token);
  checks.push('required-fields validation and actual masked form recovery save encrypted client connection');
  await capture('connected-light');
  await app.close(); app = undefined;

  await launch();
  await expect.poll(async () => (await ui.state()).navigation).toBe(3);
  // A fresh bootstrap obtains tasks from the saved vault credential, with no credential env.
  await expect.poll(async () => (await ui.state()).remote.state.identity?.role, { timeout: 15000 }).toBe('client');
  await expect.poll(async () => (await ui.state()).remote.state.tasks.length, { timeout: 15000 }).toBeGreaterThan(0);
  expect((await ui.state()).remote.state.error).toBe(null);
  expect((await ui.state()).remote.state.connection).toMatchObject({ url: config.url, mode: 'client', credential_configured: true });
  expect((await ui.state()).remote.state.tasks.some(task => task.id === config.private_task_id)).toBe(false);
  checks.push('restart restores client connection without cloud or token environment');
  await sourceTab('github');
  const issues = await allPages();
  expect(issues).toHaveLength(config.expected_issue_count);
  expect(issues.every(task => observed(task).kind === 'github')).toBe(true);
  await capture('issues');
  await sourceTab('roadmap');
  await capture('roadmap-first-page');
  const roadmap = await allPages();
  expect(roadmap).toHaveLength(config.expected_roadmap_count);
  expect(new Set(roadmap.map(task => task.id)).size).toBe(roadmap.length);
  expect(roadmap.map(task => observed(task).line).sort((a, b) => a - b)).toEqual(config.expected_lines);
  expect(roadmap.filter(task => observed(task).state === 'closed')).toHaveLength(config.expected_checked_count);
  expect(roadmap.every(task => observed(task).commit_sha === config.commit_sha && observed(task).path === config.path)).toBe(true);
  expect(roadmap.every(task => !task.current_run_id && !task.run)).toBe(true);
  // The ownership filter affects visibility only; All exposes imported checked items.
  await ui.page.mouse.click(295, 137);
  await expect.poll(async () => (await ui.state()).remote.filter).toBe(2);
  await capture('roadmap-all');
  checks.push(`all source pages match independent ledger (${roadmap.length} ROADMAP, ${issues.length} Issues)`);
  if (!config.live) {
    expect(config.path).toBe('ROADMAP.md');
    expect(roadmap.find(task => task.id === config.parent_task_id).title).toBe('Parent');
    const child = roadmap.find(task => task.id === config.child_task_id);
    expect(child.title).toBe('Child');
    expect(child.parent_task_id).toBe(config.parent_task_id);
    expect(observed(child).depth).toBe(1);
    expect(observed(child).headings).toEqual(['Project', 'Backend']);
    await ui.select(child.id);
    expect((await ui.state()).remote.state.detail.task.title).toBe('Child');
    expect((await ui.state()).remote.state.detail.task.prompt).toBe('Child. Child execution goal #desktop');
    await capture('roadmap-child');
    // The rendered #desktop chip takes the server-filter action.
    await ui.page.mouse.click(669, 362);
    await expect.poll(async () => (await ui.state()).remote.state.tag).toBe('desktop');
    await expect.poll(async () => (await ui.state()).remote.state.loading).toBe(false);
    expect((await ui.state()).remote.state.tasks.map(task => task.id)).toEqual([child.id]);
    expect((await ui.state()).remote.state.source_kind).toBe('roadmap');
    await capture('tag-filter');
    await sourceTab('roadmap');
    await ui.select(child.id);
    await ui.page.waitForTimeout(150);
    await capture('roadmap-child-return');
    await ui.page.mouse.click(606, 362);
    await expect.poll(async () => (await ui.state()).remote.state.detail?.task?.id).toBe(config.parent_task_id);
    await capture('roadmap-parent');
    checks.push('root checklist imports short titles and full goals; nested hierarchy, parent link and actual tag-chip server filter');
  }
  const checked = roadmap.find(task => observed(task).state === 'closed');
  expect(checked).toBeTruthy();
  await ui.select(checked.id);
  expect(observed((await ui.state()).remote.state.detail.task).state).toBe('closed');
  await capture('checked-disabled');
  await ui.page.mouse.click(558, 332);
  await ui.page.waitForTimeout(150);
  expect((await ui.state()).remote.state.error).toBe(null);
  expect((await ui.state()).remote.state.detail.task.current_run_id).toBeUndefined();
  checks.push('checked source shown as closed with execution disabled');
  await ui.page.mouse.click(64, await ui.page.evaluate(() => innerHeight - 30));
  await expect.poll(async () => (await ui.state()).dark).toBe(true);
  await capture('dark');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 788));
  await ui.page.waitForFunction(() => innerWidth === 1000);
  await capture('narrow');
  await ui.command({ action: 'remote_select', task_id: null });
  await capture('narrow-list');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1488, 1086));
  await sourceTab('');
  const finalTasks = await allPages();
  expect(sorted(finalTasks.map(task => task.id))).toEqual(sorted(scoped.map(task => task.id)));
  const after = await apiTasks();
  expect(sorted(after.map(task => task.id))).toEqual(beforeIDs);
  expect(after.every(task => !task.current_run_id && !task.run)).toBe(true);
  expect(errors).toEqual([]);
  const final = await ui.state();
  expect(JSON.stringify(final)).not.toContain('PRIVATE_CONNECTOR_GOAL');
  const result = { live: config.live, repository: config.repository, commit_sha: config.commit_sha, path: config.path,
    roadmap_count: roadmap.length, issue_count: issues.length, checked_count: config.expected_checked_count,
    lines: config.expected_lines, stable_task_ids: sorted(finalTasks.map(task => task.id)), checks,
    no_execution: true, errors };
  await writeFile(resolve(out, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ live: config.live, roadmap: roadmap.length, issues: issues.length, checked: config.expected_checked_count, no_execution: true, errors }));
} catch (error) {
  if (app && ui) {
    await capture('failure').catch(() => {});
    const state = await ui.state().catch(() => null);
    await writeFile(resolve(out, 'failure.json'), redacted(JSON.stringify({ error: String(error), state, errors }, null, 2)));
  }
  throw new Error(redacted(error.stack || error));
} finally {
  await app?.close();
  await rm(temp, { recursive: true, force: true });
}

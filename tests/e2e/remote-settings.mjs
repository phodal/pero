// Real Electron safeStorage and Host preference writes against a bounded HTTP fixture.
// Source/provider and Go/PostgreSQL acceptance belongs to the separate GitHub suite.
import { _electron as electron, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const temp = await mkdtemp(resolve(tmpdir(), 'pero-remote-settings-'));
const settings = resolve(temp, 'runtime-settings.json');
const out = resolve(root, 'test-results/remote-settings');
await mkdir(out, { recursive: true });
const clientToken = randomUUID(), operatorToken = randomUUID(), invalidToken = randomUUID();
const commit = 'a'.repeat(40);
const path = 'docs/路线 图 &+= roadmap.md';
const canonicalURL = `https://github.com/phodal/pero/blob/${commit}/docs/%E8%B7%AF%E7%BA%BF%20%E5%9B%BE%20&+=%20roadmap.md#L7`;
const source = { kind: 'roadmap', repository: 'phodal/pero', repository_id: 'repo-1', path,
  commit_sha: commit, blob_sha: 'b'.repeat(40), url: canonicalURL, line: 7,
  revision: 'roadmap-1', state: 'open', tags: ['desktop'] };
const task = { id: 'task_1', title: 'Cloud connector fixture', prompt: 'A source-backed task', acceptance: 'Fixture only',
  project_id: 'default', workspace_key: 'default', agent_id: 'fixture', state: 'draft', source };
let displayedSource = source;
const requests = [];
const server = createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  const operator = url.pathname.startsWith('/api/v1/');
  const authorized = request.headers.authorization === `Bearer ${operator ? operatorToken : clientToken}`;
  requests.push({ path: url.pathname, query: url.search, operator, authorized });
  response.setHeader('Content-Type', 'application/json');
  if (!authorized) { response.statusCode = 401; response.end(JSON.stringify({ error: 'invalid access token' })); return; }
  const suffix = url.pathname.replace(/^\/api\/(?:client\/)?v1/, '');
  let body;
  if (suffix === '/me') body = { id: operator ? 'operator' : 'client_1', name: operator ? 'Operator' : 'Client fixture', role: operator ? 'operator' : 'client', projects: ['default'] };
  else if (suffix === '/workers') body = { workers: [] };
  else if (suffix === '/github/status') body = { configured: true, running: false, errors: [], repositories: [
    { project_id: 'default', owner: 'phodal', repo: 'pero', auto_dispatch: false, required_label: 'pero', partial: false, roadmap_path: 'ROADMAP.md' },
  ] };
  else if (suffix === '/tasks') body = { tasks: [task], has_more: false, next_cursor: null };
  else if (suffix === '/tasks/task_1') body = { task: { ...task, latest_source: displayedSource }, run: null,
    events: [], events_truncated: false, events_first_seq: null, events_last_seq: null };
  else { response.statusCode = 404; body = { error: 'unknown fixture route' }; }
  response.end(JSON.stringify(body));
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const base = `http://127.0.0.1:${server.address().port}`;
const errors = [];
let app;
async function launch(withEnvironment = false) {
  const env = { ...process.env, PERO_DESKTOP_DATA_DIR: resolve(temp, 'profile'), PERO_SETTINGS_PATH: settings,
    PERO_HISTORY_PATH: resolve(temp, 'history.jsonl'), PERO_LOCALE: 'en' };
  for (const key of ['ELECTRON_RUN_AS_NODE', 'PERO_CLOUD_URL', 'PERO_CLIENT_TOKEN', 'PERO_OPERATOR_TOKEN']) delete env[key];
  if (withEnvironment) { env.PERO_CLOUD_URL = base; env.PERO_OPERATOR_TOKEN = operatorToken; }
  // Match npm's Desktop workspace launch, where the shell cwd is desktop/.
  app = await electron.launch({ args: [resolve(root, 'desktop')], cwd: resolve(root, 'desktop'), env });
  const page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  const state = () => page.evaluate(() => window.peroDiagnostics ? JSON.parse(window.peroDiagnostics.snapshot()) : { ready: false });
  await expect.poll(async () => (await state()).ready, { timeout: 60000 }).toBe(true);
  await expect.poll(async () => (await state()).agents?.find(agent => agent.id === 'codex')?.available).toBe(true);
  expect((await state()).workspace).toBe(root);
  await page.evaluate(() => window.pero.remoteCommand({ action: 'remote_refresh' }));
  return { page, state, command: value => page.evaluate(command => window.pero.remoteCommand(command), value) };
}
async function close() { await app.close(); app = undefined; }
const readSettings = async () => JSON.parse(await readFile(settings, 'utf8'));
const configure = async (ui, token = clientToken) => {
  await ui.command({ action: 'remote_configure', url: base, mode: 'client', token });
  await expect.poll(async () => (await ui.state()).remote.state.loading).toBe(false);
};
try {
  let ui = await launch();
  expect((await ui.state()).remote.state.connection).toMatchObject({ url: 'https://app.openpero.com', mode: 'client', credential_configured: false, persistence_available: true });
  await configure(ui);
  expect((await ui.state()).remote.state.identity.role).toBe('client');
  expect((await ui.state()).remote.state.error).toBe(null);
  expect((await ui.state()).remote.state.github.repositories[0].roadmap_path).toBe('ROADMAP.md');
  const saved = (await readSettings()).remote_connection;
  expect(saved).toMatchObject({ url: base, mode: 'client' });
  expect(saved.encrypted_token.length).toBeGreaterThan(0);
  expect(await readFile(settings, 'utf8')).not.toContain(clientToken);
  if (process.platform !== 'win32') expect((await stat(settings)).mode & 0o777).toBe(0o600);
  expect(await app.evaluate(async ({ safeStorage }, { saved, token }) => {
    const { result } = await safeStorage.decryptStringAsync(Buffer.from(saved.encrypted_token, 'base64'));
    const envelope = JSON.parse(result);
    return envelope.version === 1 && envelope.url === saved.url && envelope.mode === saved.mode && envelope.token === token;
  }, { saved, token: clientToken })).toBe(true);
  await ui.command({ action: 'remote_filter', source_kind: 'roadmap', tag: 'desktop' });
  const filteredQuery = requests.findLast(request => request.path.endsWith('/tasks')).query;
  expect(filteredQuery).toContain('source_kind=roadmap');
  expect(filteredQuery).toContain('tag=desktop');
  expect((await ui.state()).remote.state).toMatchObject({ source_kind: 'roadmap', tag: 'desktop', selected_task_id: null });
  await app.evaluate(({ shell }) => {
    globalThis.remoteSettingsOpened = [];
    shell.openExternal = async url => { globalThis.remoteSettingsOpened.push(url); };
  });
  await ui.command({ action: 'remote_open_source', task_id: task.id });
  expect(await app.evaluate(() => globalThis.remoteSettingsOpened)).toEqual([canonicalURL]);
  for (const url of ['https://example.com/steal', canonicalURL.replace('/docs/', '/docs%2F'), canonicalURL.replace(commit, 'main')]) {
    displayedSource = { ...source, url };
    await ui.command({ action: 'remote_open_source', task_id: task.id });
    expect((await ui.state()).remote.state.error).toContain('source URL');
    expect(await app.evaluate(() => globalThis.remoteSettingsOpened)).toEqual([canonicalURL]);
  }
  displayedSource = source;
  await ui.command({ action: 'remote_refresh' });
  await ui.page.screenshot({ path: resolve(out, 'connected.png') });
  await close();

  ui = await launch(true);
  expect((await ui.state()).remote.state.connection).toMatchObject({ url: base, mode: 'client', credential_configured: true });
  expect((await ui.state()).remote.state.identity.role).toBe('client');
  expect((await ui.state()).navigation).toBe(3);
  await configure(ui, invalidToken);
  expect((await ui.state()).remote.state.error).toContain('401');
  expect((await ui.state()).remote.state.connection.mode).toBe('client');
  await close();
  ui = await launch(true);
  expect((await ui.state()).remote.state.error).toContain('401');
  expect((await ui.state()).remote.state.connection.mode).toBe('client');
  expect(requests.some(request => request.operator)).toBe(false);
  await configure(ui);
  await close();

  // Changing nonsecret metadata must not redirect the encrypted credential to a different identity.
  const preferences = await readSettings();
  preferences.remote_connection.mode = 'operator';
  await writeFile(settings, JSON.stringify(preferences));
  ui = await launch(true);
  expect((await ui.state()).remote.state.configured).toBe(false);
  expect((await ui.state()).remote.state.error).toContain('Saved connection');
  expect(requests.some(request => request.operator)).toBe(false);
  await configure(ui);
  await app.evaluate(({ safeStorage }) => {
    globalThis.originalStorageAvailable = safeStorage.isAsyncEncryptionAvailable;
    safeStorage.isAsyncEncryptionAvailable = async () => false;
  });
  await configure(ui);
  expect((await ui.state()).remote.state.error).toContain('credential storage is unavailable');
  expect((await ui.state()).remote.state.connection.persistence_available).toBe(false);
  expect((await ui.state()).remote.state.configured).toBe(false);
  await app.evaluate(({ safeStorage }) => { safeStorage.isAsyncEncryptionAvailable = globalThis.originalStorageAvailable; });
  await configure(ui);
  expect((await ui.state()).remote.state.error).toBe(null);
  // A failed Host write must leave disconnect retryable until the tombstone is durable.
  const beforeDisconnect = await readFile(settings, 'utf8');
  await rm(settings); await mkdir(settings);
  await ui.command({ action: 'remote_disconnect' });
  expect((await ui.state()).remote.state.error).toBeTruthy();
  expect((await ui.state()).remote.state.configured).toBe(true);
  expect((await ui.state()).remote.state.connection.url).toBe(base);
  await rm(settings, { recursive: true }); await writeFile(settings, beforeDisconnect, { mode: 0o600 });
  await ui.command({ action: 'remote_disconnect' });
  expect((await readSettings()).remote_connection).toBe(null);
  expect((await ui.state()).remote.state.configured).toBe(false);
  await close();
  ui = await launch(true);
  expect((await ui.state()).remote.state.configured).toBe(false);
  expect((await ui.state()).remote.state.connection.mode).toBe('client');
  expect(requests.some(request => request.operator)).toBe(false);
  const final = await ui.state();
  for (const token of [clientToken, operatorToken, invalidToken]) expect(JSON.stringify(final)).not.toContain(token);
  expect(JSON.stringify(final)).not.toContain(saved.encrypted_token);
  expect(errors).toEqual([]);
  await writeFile(resolve(out, 'result.json'), JSON.stringify({ checks: [
    'project-local Codex available from Desktop workspace launch', 'OS safeStorage encrypted credential', 'Host-only 0600 preference write', 'client status and source/tag query',
    'pinned Unicode source URL validation', 'saved client identity after restart', 'invalid client never escalates',
    'credential metadata binding', 'storage unavailable recovery', 'failed disconnect remains retryable', 'persistent disconnect overrides environment',
    'renderer credentials excluded',
  ], errors }, null, 2));
  console.log(JSON.stringify({ checks: 'Desktop encrypted connection settings', errors }));
} finally {
  if (app) await app.close();
  await new Promise(done => server.close(done));
  await rm(temp, { recursive: true, force: true });
}

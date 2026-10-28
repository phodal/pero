// The renderer sends bounded task actions; endpoint and credentials stay here.
import { randomUUID } from 'node:crypto';
import { DesktopLogin } from './desktop-login';
import { safeStorage, shell } from 'electron';
import Ajv2020 from 'ajv/dist/2020.js';
import schema from '../../../protocol/generated/remote.schema.json';
import type { Detail, RemoteState, Task, TaskSpec, TaskPage, Worker, Identity, GitHubStatus, GitHubSyncResult } from '../../../protocol/generated/remote';

type Emit = (event: object) => void;
type Mode = 'client' | 'operator';
const defaultTaskCenter = 'https://app.openpero.com';
export type StoredRemoteConnection = { url: string; mode: Mode; encrypted_token: string };
export type RemotePreferences = { load(): unknown; save(connection: StoredRemoteConnection | null): Promise<void> };
const ajv = new Ajv2020({ strict: false, allErrors: true });
ajv.addSchema(schema);
function checked<T>(name: string, value: unknown): T {
  const valid = ajv.getSchema(`${schema.$id}#/$defs/${name}`);
  if (!valid || !valid(value)) throw new Error(`Invalid remote ${name} response`);
  return value as T;
}
function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.trim() || Array.from(value).length > max || /[\u0000\r\n]/.test(value) && max <= 2048) throw new Error('Invalid remote task field');
  return value.trim();
}
function id(value: unknown): string {
  const result = text(value, 128);
  if (!/^[a-zA-Z0-9_-]+$/.test(result)) throw new Error('Invalid task identifier');
  return result;
}
function endpoint(value: string | undefined): string | null {
  if (!value) return null;
  if (value.length > 2048) throw new Error('Connection URL is too long');
  const url = new URL(value);
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('Use an HTTPS service origin (loopback HTTP is allowed for development)');
  }
  return url.href.replace(/\/$/, '');
}
function mode(value: unknown): Mode {
  if (value !== 'client' && value !== 'operator') throw new Error('Choose client or operator access');
  return value;
}
function sourceURL(source: Detail['task']['source']): string {
  if (!source || !/^[\w-]+\/[\w.-]+$/.test(source.repository) || ['.', '..'].includes(source.repository.split('/')[1])) throw new Error('Invalid task source');
  if (source.kind === 'github') {
    if (!Number.isSafeInteger(source.issue_number) || (source.issue_number ?? 0) < 1) throw new Error('Invalid GitHub issue source');
    const expected = `https://github.com/${source.repository}/issues/${source.issue_number}`;
    if (source.url !== expected) throw new Error('Invalid canonical source URL');
  } else if (source.kind === 'roadmap') {
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(source.commit_sha || '') || !source.path || source.path.length > 1024 || /[\\\u0000-\u001f\u007f]/.test(source.path)) throw new Error('Invalid Roadmap source');
    const parts = source.path.split('/');
    if (parts.some(part => !part || part === '.' || part === '..')) throw new Error('Invalid Roadmap path');
    if (source.line !== undefined && (!Number.isSafeInteger(source.line) || source.line < 1)) throw new Error('Invalid Roadmap line');
    const url = new URL(source.url);
    const expected = [...source.repository.split('/'), 'blob', source.commit_sha, ...parts];
    const actual = url.pathname.slice(1).split('/').map(part => decodeURIComponent(part));
    // Compare individual segments: Go PathEscape and encodeURIComponent differ
    // for some valid filenames, while decoding the full path would accept %2F.
    if (url.origin !== 'https://github.com' || url.username || url.password || url.search || url.href !== source.url
      || url.hash !== (source.line ? `#L${source.line}` : '') || actual.length !== expected.length
      || actual.some((part, index) => part !== expected[index])) throw new Error('Invalid canonical source URL');
  } else throw new Error('Unsupported source kind');
  return source.url;
}

export class RemoteAdapter {
  private login = new DesktopLogin();
  private base: string | null = null;
  private configError: string | null = null;
  private clientMode = !!process.env.PERO_CLIENT_TOKEN || !process.env.PERO_OPERATOR_TOKEN;
  private token = process.env.PERO_CLIENT_TOKEN || process.env.PERO_OPERATOR_TOKEN || '';
  private api = this.clientMode ? '/api/client/v1' : '/api/v1';
  private timer?: ReturnType<typeof setTimeout>;
  private closed = false;
  private queue: Promise<void> = Promise.resolve();
  private initialization?: Promise<void>;
  private persistenceAvailable = false;
  private pages = 1;
  private state: RemoteState = {
    configured: false, loading: false, error: null, tasks: [], workers: [], has_more: false,
    selected_task_id: null, detail: null, identity: null, github: null,
    connection: { url: '', mode: 'client', credential_configured: false, persistence_available: false },
    source_kind: '', tag: '',
  };
  constructor(private emit: Emit, private preferences?: RemotePreferences) {
    try { this.base = endpoint(process.env.PERO_CLOUD_URL ?? defaultTaskCenter); }
    catch { this.configError = 'Invalid configured service URL. Edit the connection and retry.'; }
    this.connectionState();
  }
  private connectionState() {
    this.state.configured = !!this.base && !!this.token;
    this.state.connection = { url: this.base || defaultTaskCenter, mode: this.clientMode ? 'client' : 'operator',
      credential_configured: !!this.token, persistence_available: this.persistenceAvailable, authenticating: this.login.pending };
  }
  private async storageAvailable() {
    try {
      const available = await safeStorage.isAsyncEncryptionAvailable();
      // Never accept Linux's hard-coded/plaintext fallback as encrypted storage.
      const backend = process.platform === 'linux' ? safeStorage.getSelectedStorageBackend() : '';
      this.persistenceAvailable = !!this.preferences && available && backend !== 'basic_text' && backend !== 'unknown';
    } catch { this.persistenceAvailable = false; }
    this.connectionState();
    return this.persistenceAvailable;
  }
  initialize(): Promise<void> {
    return this.initialization ??= (async () => {
      await this.storageAvailable();
      try {
        const stored = this.preferences?.load();
        if (stored === undefined) return; // Existing environment-only setup remains supported.
        this.token = ''; this.base = null; this.clientMode = true; this.api = '/api/client/v1';
        if (stored === null) return; // Explicit disconnect takes precedence over environment defaults.
        if (!stored || typeof stored !== 'object') throw new Error('Invalid saved connection');
        const saved = stored as StoredRemoteConnection;
        this.base = endpoint(text(saved.url, 2048));
        this.clientMode = mode(saved.mode) === 'client'; this.api = this.clientMode ? '/api/client/v1' : '/api/v1';
        if (!this.persistenceAvailable) throw new Error('Credential storage unavailable');
        if (typeof saved.encrypted_token !== 'string' || saved.encrypted_token.length > 4096 || !/^[A-Za-z0-9+/]+={0,2}$/.test(saved.encrypted_token)) throw new Error('Invalid encrypted credential');
        const decrypted = await safeStorage.decryptStringAsync(Buffer.from(saved.encrypted_token, 'base64'));
        const envelope = JSON.parse(decrypted.result);
        if (envelope.version !== 1 || envelope.url !== this.base || envelope.mode !== saved.mode) throw new Error('Saved credential binding mismatch');
        const token = text(envelope.token, 512);
        if (decrypted.shouldReEncrypt) {
          const encrypted_token = (await safeStorage.encryptStringAsync(decrypted.result)).toString('base64');
          await this.preferences!.save({ url: this.base!, mode: saved.mode, encrypted_token });
        }
        this.token = token;
        this.configError = null;
      } catch {
        this.token = '';
        this.configError = this.persistenceAvailable
          ? 'Saved connection could not be opened. Enter the service URL and access token again.'
          : 'System credential storage is unavailable. Unlock or enable it, then reconnect.';
      } finally { this.connectionState(); this.publish(); }
    })();
  }
  close() { this.login.cancel(); this.closed = true; this.token = ''; clearTimeout(this.timer); }
  private publish() {
    this.connectionState();
    if (!this.closed) this.emit({ version: 1, kind: 'remote_state', request_id: null, text: '', data: this.state });
  }
  private error(error: unknown): string {
    const message = error instanceof Error ? error.message : 'Remote request failed';
    return (this.token ? message.replaceAll(this.token, '[redacted]') : message).slice(0, 500);
  }
  private async request(path: string, method = 'GET', body?: unknown): Promise<unknown> {
    const response = await fetch(`${this.base}${path}`, {
      method, redirect: 'error', signal: AbortSignal.timeout(8000),
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json',
        ...(method === 'POST' ? { 'Idempotency-Key': randomUUID() } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader) for (;;) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.length;
      if (size > 2_000_000) { await reader.cancel(); throw new Error('Remote response is too large'); }
      chunks.push(part.value);
    }
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!response.ok) throw new Error(`Remote ${response.status}: ${typeof value.error === 'string' ? value.error.slice(0, 300) : 'request failed'}`);
    return value;
  }
  private taskQuery(cursor?: string) {
    const query = new URLSearchParams({ limit: '50' });
    if (this.state.source_kind) query.set('source_kind', this.state.source_kind);
    if (this.state.tag) query.set('tag', this.state.tag);
    if (cursor) query.set('cursor', cursor);
    return `${this.api}/tasks?${query}`;
  }
  private async load() {
    const [first, workerData, identity, github] = await Promise.all([
      this.request(this.taskQuery()), this.request(`${this.api}/workers`) as Promise<{ workers: unknown[] }>,
      this.request(`${this.api}/me`), this.request(`${this.api}/github/status`),
    ]);
    this.state.identity = checked<Identity>('Identity', identity);
    this.state.github = checked<GitHubStatus>('GitHubStatus', github);
    let page = checked<TaskPage>('TaskPage', first);
    const tasks = [...page.tasks];
    for (let i = 1; i < this.pages && page.has_more && page.next_cursor; i++) {
      page = checked<TaskPage>('TaskPage', await this.request(this.taskQuery(page.next_cursor)));
      tasks.push(...page.tasks);
    }
    if (!Array.isArray(workerData.workers)) throw new Error('Invalid remote Worker list');
    this.state.tasks = tasks; this.state.has_more = page.has_more;
    this.state.workers = workerData.workers.map(value => checked<Worker>('Worker', value));
    if (this.state.selected_task_id) this.state.detail = checked<Detail>('Detail', await this.request(`${this.api}/tasks/${id(this.state.selected_task_id)}`));
  }
  private clearTasks() {
    this.pages = 1;
    Object.assign(this.state, { tasks: [], workers: [], has_more: false, selected_task_id: null, detail: null, identity: null, github: null });
  }
  private async configure(command: Record<string, unknown>) {
    if (Object.keys(command).some(key => !['action', 'url', 'token', 'mode'].includes(key))) throw new Error('Invalid connection fields');
    const url = endpoint(text(command.url, 2048))!;
    const selectedMode = mode(command.mode);
    const token = text(command.token, 512); delete command.token;
    this.token = ''; this.base = url; this.clientMode = selectedMode === 'client'; this.api = this.clientMode ? '/api/client/v1' : '/api/v1';
    this.clearTasks();
    if (!await this.storageAvailable()) throw new Error('System credential storage is unavailable. Unlock or enable it and retry.');
    let encrypted_token: string;
    try { encrypted_token = (await safeStorage.encryptStringAsync(JSON.stringify({ version: 1, url, mode: selectedMode, token }))).toString('base64'); }
    catch { throw new Error('System credential storage could not save the access token. Unlock or enable it and retry.'); }
    if (encrypted_token.length > 4096) throw new Error('Encrypted credential is too large to save');
    // Save only the explicit new identity. An invalid client credential never falls back to an operator token.
    await this.preferences!.save({ url, mode: selectedMode, encrypted_token });
    this.token = token; this.configError = null;
    this.state.source_kind = ''; this.state.tag = '';
    await this.load();
    this.state.error = null;
  }
  acceptDeepLink(value: string): Promise<void> {
    const pending = this.queue.then(async () => {
      await this.initialize();
      if (this.login.isCompletedCallback(value)) return;
      this.state.loading = true; this.state.error = null; this.publish();
      try {
        const connection = await this.login.complete(value);
        await this.configure({ ...connection, mode: 'client' });
      } catch { this.state.error = 'GitHub sign-in could not complete. Return to the connection page and sign in again.'; }
      finally { this.state.loading = false; this.publish(); this.schedulePoll(); }
    });
    this.queue = pending.catch(() => {});
    return pending;
  }
  command(input: unknown): Promise<void> {
    const pending = this.queue.then(() => this.perform(input));
    this.queue = pending.catch(() => {});
    return pending;
  }
  private async perform(input: unknown): Promise<void> {
    await this.initialize();
    if (this.closed) return;
    const command = input as Record<string, unknown>;
    if (!command || typeof command !== 'object' || JSON.stringify(command).length > 260_000) throw new Error('Invalid remote command');
    const action = String(command.action);
    if (!['remote_refresh', 'remote_more', 'remote_select', 'remote_create', 'remote_dispatch', 'remote_cancel', 'remote_claim', 'remote_release', 'remote_sync_issues', 'remote_open_source', 'remote_configure', 'remote_disconnect', 'remote_filter', 'remote_login', 'remote_login_cancel'].includes(action)) throw new Error('Unknown remote action');
    clearTimeout(this.timer);
    this.state.loading = true;
    if (action !== 'remote_configure') this.state.error = null;
    this.publish();
    try {
      if (action === 'remote_login') {
        if (!await this.storageAvailable()) throw new Error('System credential storage is unavailable. Unlock or enable it and retry.');
        const base = endpoint(text(command.url || this.base || defaultTaskCenter, 2048))!;
        const loginURL = this.login.begin(base, () => { this.state.error = 'GitHub sign-in expired. Sign in again from the connection page.'; this.publish(); });
        try { await shell.openExternal(loginURL); } catch { this.login.cancel(); throw new Error('Could not open the browser. Retry GitHub sign-in.'); }
        return;
      }
      if (action === 'remote_login_cancel') { this.login.cancel(); return; }
      if (action === 'remote_configure') { this.login.cancel(); await this.configure(command); return; }
      if (action === 'remote_disconnect') {
        this.login.cancel();
        if (!this.preferences) throw new Error('Local runtime preferences are unavailable. Retry disconnecting.');
        await this.preferences.save(null);
        this.token = ''; this.base = null; this.clientMode = true; this.api = '/api/client/v1'; this.configError = null;
        this.clearTasks(); this.state.source_kind = ''; this.state.tag = '';
        return;
      }
      await this.storageAvailable();
      if (!this.state.configured) { this.state.error = this.configError; return; }
      if (action === 'remote_filter') {
        if (!['', 'github', 'roadmap'].includes(String(command.source_kind))) throw new Error('Invalid task source filter');
        this.state.source_kind = command.source_kind as '' | 'github' | 'roadmap';
        this.state.tag = command.tag === undefined || command.tag === '' ? '' : text(command.tag, 128);
        this.clearTasks();
      }
      if (action === 'remote_more') this.pages += 1;
      if (action === 'remote_select') {
        this.state.selected_task_id = command.task_id === null ? null : id(command.task_id); this.state.detail = null;
      } else if (action === 'remote_create') {
        if (this.clientMode) throw new Error('Only the operator can create manual tasks');
        const spec: TaskSpec = {
          title: text(command.title, 240), prompt: text(command.prompt, 64000), acceptance: text(command.acceptance, 16000),
          project_id: text(command.project_id, 128), workspace_key: text(command.workspace_key, 128), agent_id: text(command.agent_id, 128),
        };
        if (command.parent_task_id !== undefined) spec.parent_task_id = id(command.parent_task_id);
        if (command.tags !== undefined) {
          if (!Array.isArray(command.tags) || command.tags.length > 32) throw new Error('Invalid task tags');
          spec.tags = command.tags.map(tag => text(tag, 128));
        }
        const task = checked<Task>('Task', await this.request('/api/v1/tasks', 'POST', spec)); this.state.selected_task_id = task.id;
      } else if (['remote_dispatch', 'remote_cancel', 'remote_claim', 'remote_release'].includes(action)) {
        const taskID = id(command.task_id);
        const body = action === 'remote_dispatch' && command.worker_id ? { worker_id: id(command.worker_id) } : {};
        await this.request(`${this.api}/tasks/${taskID}/${action.slice('remote_'.length)}`, 'POST', body); this.state.selected_task_id = taskID;
      } else if (action === 'remote_sync_issues') {
        if (this.clientMode) throw new Error('Only the operator can sync GitHub sources');
        const synced = checked<GitHubSyncResult>('GitHubSyncResult', await this.request('/api/v1/github/sync', 'POST', {}));
        if (synced.partial) this.state.error = synced.errors.join('; ').slice(0, 500) || 'Source synchronization is incomplete';
      } else if (action === 'remote_open_source') {
        const detail = checked<Detail>('Detail', await this.request(`${this.api}/tasks/${id(command.task_id)}`));
        await shell.openExternal(sourceURL(detail.task.latest_source || detail.task.source));
      }
      await this.load();
    } catch (error) { this.state.error = this.error(error); }
    finally { this.state.loading = false; this.publish(); this.schedulePoll(); }
  }
  private schedulePoll() {
    clearTimeout(this.timer);
    if (!this.closed && this.state.configured) this.timer = setTimeout(() => {
      this.queue = this.queue.then(() => this.poll()).catch(() => {});
    }, 2000);
  }
  private async poll() {
    if (this.closed || !this.state.configured) return;
    try { await this.load(); this.state.error = null; }
    catch (error) { this.state.error = this.error(error); }
    finally { this.publish(); this.schedulePoll(); }
  }
}

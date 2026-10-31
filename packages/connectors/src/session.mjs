import { isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { NativeServiceChannel } from './io/channel.mjs';
import { validateMCPServiceConfig } from './service-config.mjs';
import { readPortableRegistry } from './portable-registry.mjs';
import { launchPortableChannel } from './portable-channel.mjs';

const failure = code => Object.assign(new Error(code), { code });
const transportCodes = {
  XPC_ARGUMENT: 'MCP_ARGUMENT',
  XPC_REQUEST_LIMIT: 'MCP_REQUEST_LIMIT', XPC_REPLY_LIMIT: 'MCP_REPLY_LIMIT',
  XPC_PROTOCOL: 'MCP_PROTOCOL', XPC_TIMEOUT: 'MCP_TIMEOUT', XPC_IO: 'MCP_IO',
  XPC_DISCONNECTED: 'MCP_SESSION_RETIRED', XPC_LAUNCH_FAILED: 'MCP_CLIENT_EXIT',
  XPC_CHANNEL_CLOSED: 'MCP_SESSION_RETIRED', XPC_CHANNEL_RETIRED: 'MCP_SESSION_RETIRED',
};
const domainFailure = error => error.nativeReply ? error : failure(transportCodes[error.code] ?? error.code ?? 'MCP_CLIENT_EXIT');
const recoverable = new Set([
  'MCP_AUTH_REQUIRED', 'MCP_AUTH_CALLBACK', 'MCP_TOOL_DENIED', 'MCP_ARGUMENT',
  'GITHUB_AUTH_REQUIRED', 'GITHUB_PERMISSION_DENIED', 'GITHUB_RATE_LIMITED', 'GITHUB_NOT_FOUND', 'GITHUB_CONFLICT',
  'GITHUB_INVALID_ARGUMENT', 'GITHUB_TEMPORARY', 'GITHUB_API_FAILED',
  'GITLAB_AUTH_REQUIRED', 'GITLAB_PERMISSION_DENIED', 'GITLAB_RATE_LIMITED', 'GITLAB_NOT_FOUND', 'GITLAB_CONFLICT',
  'GITLAB_INVALID_ARGUMENT', 'GITLAB_TEMPORARY', 'GITLAB_API_FAILED',
  'GMAIL_PERMISSION_DENIED', 'GMAIL_RATE_LIMITED', 'GMAIL_API_FAILED',
  'M365_PERMISSION_DENIED', 'M365_RATE_LIMITED', 'M365_GRAPH_FAILED',
]);
/** Trusted host API. Each instance owns one authenticated XPC connection and one connector. */
export class MCPSession {
  #registrySnapshot; #credentialAuthority; #expectedRevision;
  constructor({ executable, backend = 'portable', registry, expectedRevision, connectorId = 'point.table', leaseMs = 300000, apps = false, credentialAuthority, channelExecutable, channelSha256 }) {
    if (!isAbsolute(executable) || !Number.isSafeInteger(leaseMs) || leaseMs < 1 || leaseMs > 300000) throw failure('MCP_CONFIG');
    // Existing XPC clients keep their launch behavior. Portable config is only
    // accepted on a platform with verified ownership and shutdown semantics.
    this.service = validateMCPServiceConfig({ executable, backend, registry, ...(channelExecutable ? { channelExecutable, ...(channelSha256 ? { channelSha256 } : {}) } : {}) });
    this.#credentialAuthority = credentialAuthority;
    this.#expectedRevision = expectedRevision;
    this.transport = backend === 'portable' ? 'stdio' : 'xpc';
    this.executable = executable; this.connectorId = connectorId; this.sessionId = randomUUID(); this.leaseMs = leaseMs;
    this.pending = null; this.closed = false;
    this.lifetime = new AbortController();
    this.apps = apps === true;
    this.cleanup = 'not-started'; this.retiring = false;
    this.channel = new NativeServiceChannel({
      launch: () => launchPortableChannel({ ...this.service, snapshot: this.#registrySnapshot, connectorId: this.connectorId, credentialAuthority }),
      timeoutMs: 59000, maxRequestBytes: 131072, maxReplyBytes: 2097152,
    });
    this.channel.retired.then(error => this.close(domainFailure(error).code));
  }
  get child() { return this.channel.child; }
  #armLease() { clearTimeout(this.lease); this.lease = setTimeout(() => this.close('MCP_LEASE_EXPIRED'), this.leaseMs); this.lease.unref(); }
  async open({ signal, callback } = {}) {
    if (this.channel.state !== 'new' || this.closed || this.opening) throw failure('MCP_SESSION_RETIRED');
    this.opening = true;
    try {
      if (signal?.aborted) throw failure('ABORT_ERR');
      if (this.service.backend === 'portable') {
        this.#registrySnapshot = await readPortableRegistry(this.service.registry, { connectorId: this.connectorId, credentials: !!this.#credentialAuthority });
        if (this.#expectedRevision && this.#registrySnapshot.revision !== this.#expectedRevision) throw failure('MCP_CONFIG_CHANGED');
        if (!Object.hasOwn(this.#registrySnapshot.connectors, this.connectorId)) throw failure('MCP_CONNECTOR_DENIED');
        if (signal?.aborted) throw failure('ABORT_ERR');
        if (this.closed) throw failure('MCP_SESSION_RETIRED');
      }
      this.channel.start(); this.cleanup = 'pending'; this.#armLease();
      return await this.request('mcp.session.open', { apps: this.apps, ...(callback ? { callback } : {}) }, { signal });
    }
    catch (error) { this.close(); throw error; }
  }
  request(method, options = {}, { signal } = {}) {
    if (this.closed || this.retiring || this.channel.state !== 'open') return Promise.reject(failure('MCP_SESSION_RETIRED'));
    if (this.pending) return Promise.reject(failure('MCP_BUSY'));
    if (signal?.aborted) return Promise.reject(failure('ABORT_ERR'));
    const id = randomUUID();
    let bytes;
    try { bytes = this.channel.encodeRequest(method, [{ ...options, leaseMs: this.leaseMs, requestId: id, sessionId: this.sessionId, connectorId: this.connectorId }]); }
    catch (error) { return Promise.reject(domainFailure(error)); }
    // Domain admission remains single-flight. The idle lease pauses while an
    // admitted operation is governed by the channel deadline.
    clearTimeout(this.lease);
    let settled; const done = new Promise(resolve => { settled = resolve; });
    this.pending = { id, method, done };
    if (['stdio', 'builtin'].includes(this.connectorTransport) && ['mcp.tools.list', 'mcp.tools.call', 'mcp.resources.read', 'mcp.apps.call'].includes(method)) this.serverMayExist = true;
    return this.channel.sendRequest(bytes, { signal }).then(v => {
      if (this.closed) throw failure(this.closeReason);
      if (!v || v.requestId !== id || v.sessionId !== this.sessionId || v.connectorId !== this.connectorId || v.transport !== this.transport) throw failure('MCP_IDENTITY');
      if (!v.result || typeof v.result !== 'object') throw failure('MCP_PROTOCOL');
      this.evidence = { transport: v.transport, sessionId: v.sessionId, workerPid: v.workerPid, serverPid: v.serverPid, servicePid: v.servicePid, protocolVersion: v.protocolVersion };
      if (method === 'mcp.session.open') this.connectorTransport = v.result.transport;
      return v.result;
    }).catch(error => {
      error = domainFailure(error);
      if (!error.nativeReply || !recoverable.has(error.code)) this.close(error.code);
      throw error;
    }).finally(() => {
      this.pending = null;
      if (!this.closed) this.#armLease();
      settled();
    });
  }
  list(options) { return this.request('mcp.tools.list', {}, options); }
  call(name, args, options) { return this.request('mcp.tools.call', { name, arguments: args, ...(options?.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }) }, options); }
  readUI(uri, options) { return this.request('mcp.resources.read', { arguments: { uri } }, options); }
  callFromApp(name, args, options) { return this.request('mcp.apps.call', { name, arguments: args, ...(options?.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }) }, options); }
  renew(options) { return this.request('mcp.session.renew', {}, options); }
  async retire() {
    this.retiring = true;
    await this.pending?.done;
    this.close();
    return this.whenClosed;
  }
  status() { return { sessionId: this.sessionId, state: this.closed ? 'closed' : this.retiring ? 'retiring' : this.pending ? 'running' : 'idle', cleanup: this.cleanup, reason: this.closeReason }; }
  /** User-facing host workflow only; native Keychain persistence is connector-opt-in. */
  async authorize({ openURL, signal } = {}) {
    if (typeof openURL !== 'function') throw failure('MCP_AUTH_UI_REQUIRED');
    signal = AbortSignal.any([this.lifetime.signal, ...(signal ? [signal] : [])]);
    const { authorizationUrl, redirectUri, authorizationClientId } = await this.request('mcp.oauth.begin', {}, { signal });
    const redirect = new URL(redirectUri), auth = new URL(authorizationUrl);
    if (redirect.hostname !== '127.0.0.1' || redirect.protocol !== 'http:' || !redirect.port) throw failure('MCP_AUTH_REDIRECT');
    const expectedState = auth.searchParams.get('state');
    if (!expectedState || expectedState.length < 16) throw failure('MCP_AUTH_STATE');
    const server = createServer();
    let cleanup = () => {};
    try {
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(Number(redirect.port), '127.0.0.1', resolve); });
      const done = new Promise((resolve, reject) => {
        const timer = setTimeout(() => { cleanup(); reject(failure('MCP_AUTH_TIMEOUT')); this.close('MCP_AUTH_TIMEOUT'); }, 120000);
        const abort = () => { cleanup(); this.close('ABORT_ERR'); reject(failure('ABORT_ERR')); };
        cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); };
        signal?.addEventListener('abort', abort, { once: true });
        let completing = false;
        server.on('request', async (req, res) => {
          let callback;
          try { callback = new URL(req.url, redirect); } catch { res.writeHead(400).end('Invalid callback'); return; }
          if (req.method !== 'GET' || callback.pathname !== redirect.pathname || callback.searchParams.get('state') !== expectedState || completing) { res.writeHead(400).end('Invalid callback'); return; }
          completing = true;
          try {
            const code = callback.searchParams.get('code'); if (!code) throw failure('MCP_AUTH_CALLBACK');
            await this.request('mcp.oauth.complete', { callback: { code, state: expectedState, iss: callback.searchParams.get('iss') } }, { signal });
            res.end('Authorization completed. You may close this window.'); resolve({ authorized: true });
          } catch (error) { res.writeHead(400).end('Authorization failed'); reject(error); }
          finally { cleanup(); }
        });
        if (signal.aborted) { abort(); return; }
        Promise.resolve().then(() => { signal.throwIfAborted(); return openURL(authorizationUrl, authorizationClientId); }).catch(error => { cleanup(); reject(error); });
      });
      return await done;
    } finally { cleanup(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  }
  close(code = 'MCP_SESSION_RETIRED') {
    if (this.closed) return;
    this.closed = true; clearTimeout(this.lease);
    this.closeReason = code;
    this.lifetime.abort();
    this.channel.close(failure(code));
    this.whenClosed = (async () => {
      const exit = await this.channel.whenClosed;
      if (exit?.error?.code === 'MCP_CREDENTIAL_RELEASE_FAILED') {
        this.cleanup = 'unknown'; this.closeReason = exit.error.code; return this.status();
      }
      const pids = [this.channel.pid, this.evidence?.workerPid, this.evidence?.serverPid].filter(Number.isInteger);
      const gone = pid => { try { process.kill(pid, 0); return false; } catch (error) { return error.code === 'ESRCH'; } };
      for (let i = 0; i < 100; i++) {
        if (pids.every(gone)) {
          const missingEvidence = this.cleanup === 'pending' && !this.evidence?.workerPid || this.serverMayExist && !Number.isInteger(this.evidence?.serverPid);
          this.cleanup = missingEvidence ? 'unknown' : 'reaped'; return this.status();
        }
        await new Promise(resolve => setTimeout(resolve, 30));
      }
      this.cleanup = 'unknown'; return this.status();
    })();
  }
}

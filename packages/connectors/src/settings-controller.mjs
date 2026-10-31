const fail = code => Object.assign(new Error(code), { code });
const fields = {
  list: [], snapshot: [], cancel: [], put: ['connectorId', 'definition', 'expectedRevision'],
  enable: ['connectorId', 'enabled', 'expectedRevision'], remove: ['connectorId', 'expectedRevision'],
  logout: ['connectorId', 'expectedRevision'], verify: ['connectorId'], disconnect: ['connectorId'],
  'authorization.refresh': ['connectorId'],
  'connect.begin': ['connectorId', 'intent'], 'connect.cancel': ['connectorId', 'attemptId'],
  'connect.observe': ['connectorId', 'attemptId'], link: ['providerId', 'kind'],
  'tools.set': ['connectorId', 'tools', 'expectedRevision'],
  'secret.set': ['reference', 'value'], 'secret.delete': ['reference'],
};
// Operations that start or end an authorization transaction return fast and
// are observed by polling, so they are not fenced behind the mutation lock: a
// user must always be able to cancel the connect they are waiting on.
const unfenced = new Set(['snapshot', 'cancel', 'connect.cancel', 'connect.observe', 'authorization.refresh']);
// The Channel page polls `snapshot`/`list` on a ~1.5-3s timer for as long as a
// connect attempt or a live connection is up (channel-page.tsx's poll loop),
// so logging every request/ok line here — as every other operation does —
// floods the terminal with routine polling rather than the events someone
// debugging a stuck connect actually needs. A poll that fails still logs.
const quietWhenOk = new Set(['snapshot', 'list', 'cancel', 'connect.observe', 'authorization.refresh']);

/**
 * A tool the server offered but the allowlist does not admit has to reach the
 * renderer by name: choosing which tools to admit is impossible otherwise. The
 * name is bounded remote text, not trusted input — the worker caps length and
 * count, this caps them again, the page renders them as text, and the native
 * allowlist stays the only thing that admits a call.
 */
const MAX_TOOL_NAME = 128;
const MAX_TOOLS = 512;
function redact(view) {
  const blocked = view.tools.blocked.slice(0, MAX_TOOLS).map(item => ({ ...item, name: String(item.name).slice(0, MAX_TOOL_NAME) }));
  return { ...view, tools: { ...view.tools, blocked, undeclared: blocked.filter(item => item.reason === 'not-host-allowed').length } };
}

/** Trusted settings adapter, not an Agent API. Native manager remains authority. */
export class MCPSettingsController {
  /**
   * openLink receives a URL the host resolved from its own catalog, never one
   * the renderer supplied: a settings page may ask to open a provider's docs or
   * revocation page, but it may not choose the destination.
   */
  constructor(manager, { openLink = null } = {}) { this.manager = manager; this.openLink = openLink; this.closed = false; this.pending = null; }
  /** Log only a fixed operation name and outcome. Definitions, credential
   * references, OAuth parameters and malformed inputs can contain secrets;
   * validation failures must never copy those bytes to diagnostics. */
  async request(input) {
    const startedAt = Date.now();
    const op = Object.hasOwn(fields, input?.operation) ? input.operation : 'unknown';
    const logTag = `[connector:${op}]`;
    const quiet = quietWhenOk.has(op);
    if (!quiet) console.log(`${logTag} ->`);
    const reply = await this.#dispatch(input);
    const elapsedMs = Date.now() - startedAt;
    if (reply.ok) { if (!quiet) console.log(`${logTag} ok (${elapsedMs}ms)`); }
    else console.warn(`${logTag} FAILED code=${reply.code} (${elapsedMs}ms)`);
    return reply;
  }
  async #dispatch(input) {
    try {
      if (this.closed) throw fail('MCP_CONTROL_DISPOSED');
      if (!input || !Object.hasOwn(fields, input.operation) || Buffer.byteLength(JSON.stringify(input)) > 131072 ||
          Object.keys(input).some(k => k !== 'operation' && !fields[input.operation].includes(k))) throw fail('MCP_ARGUMENT');
      const op = input.operation;
      if (op === 'cancel') {
        if (this.pending?.operation !== 'verify') return { ok: true, cancellation: 'no-active-probe' };
        this.pending.abort.abort(); return { ok: true, cancellation: 'requested' };
      }
      if (op === 'snapshot') {
        const snapshot = await this.manager.snapshot();
        if (this.closed) throw fail('MCP_CONTROL_DISPOSED');
        return { ok: true, directory: snapshot.directory, providers: snapshot.providers ?? snapshot.directory, connections: snapshot.connections.map(redact), pending: this.pending?.operation ?? null };
      }
      if (op === 'connect.cancel') return { ok: true, result: this.manager.cancelConnect(input.connectorId, input.attemptId) };
      if (op === 'connect.observe') return { ok: true, result: this.manager.observeConnect(input.connectorId, input.attemptId) };
      if (op === 'authorization.refresh') return { ok: true, result: await this.manager.refreshAuthorization(input.connectorId) };
      if (op === 'link') {
        if (!['docs', 'revoke'].includes(input.kind) || typeof this.openLink !== 'function') throw fail('MCP_ARGUMENT');
        await this.openLink(this.manager.providerLink(input.providerId, input.kind), input.kind);
        return { ok: true, result: { opened: true } };
      }
      if (this.pending && !unfenced.has(op)) throw fail('MCP_CONTROL_BUSY');
      const pending = { operation: op, abort: new AbortController() }; this.pending = pending;
      try {
        const { connectorId, definition, expectedRevision, enabled, reference, value, intent } = input;
        if (['enable', 'remove', 'logout', 'tools.set'].includes(op) && (typeof expectedRevision !== 'string' || !expectedRevision)) throw fail('MCP_ARGUMENT');
        if (op === 'tools.set' && (!Array.isArray(input.tools) || input.tools.some(name => typeof name !== 'string'))) throw fail('MCP_ARGUMENT');
        if (op === 'enable' && typeof enabled !== 'boolean') throw fail('MCP_ARGUMENT');
        if (op === 'connect.begin' && intent !== undefined && !['first-connect', 'reauthorize'].includes(intent)) throw fail('MCP_ARGUMENT');
        let result;
        switch (op) {
          case 'list': result = await this.manager.list(); break;
          case 'put': result = await this.manager.put(connectorId, definition, expectedRevision); break;
          case 'enable': result = await this.manager.enable(connectorId, enabled, expectedRevision); break;
          case 'remove': result = await this.manager.remove(connectorId, expectedRevision); break;
          case 'logout': result = await this.manager.logout(connectorId, expectedRevision); break;
          case 'disconnect': result = await this.manager.disconnectRuntime(connectorId); break;
          case 'tools.set': result = await this.manager.setTools(connectorId, input.tools, expectedRevision); break;
          case 'connect.begin': result = await this.manager.beginConnect(connectorId, { intent: intent ?? 'first-connect' }); break;
          case 'verify': {
            const catalog = await this.manager.verify(connectorId, { signal: pending.abort.signal });
            if (pending.abort.signal.aborted) throw fail(this.closed ? 'MCP_CONTROL_DISPOSED' : 'ABORT_ERR');
            result = { toolCount: catalog.tools.length }; break; // Never forward remote descriptions/HTML to settings.
          }
          case 'secret.set': await this.manager.setSecret(reference, value); result = { stored: true }; break;
          case 'secret.delete': await this.manager.deleteSecret(reference); result = { deleted: true }; break;
        }
        if (this.closed) throw fail('MCP_CONTROL_DISPOSED');
        return { ok: true, result };
      } finally { if (this.pending === pending) this.pending = null; }
    } catch (error) {
      // No native errors, OAuth URLs, secret bytes or remote text in renderer errors.
      return { ok: false, code: /^(MCP_[A-Z0-9_]+|ABORT_ERR)$/.test(error.code ?? '') ? error.code : 'MCP_OPERATION_FAILED' };
    }
  }
  async dispose() { this.closed = true; this.pending?.abort.abort(); await this.manager.dispose(); }
}

import { validateConnector } from './connectors/validation.mjs';
export { validateConnector, GMAIL_SCOPE, GMAIL_TOOLS } from './connectors/validation.mjs';
import { MCPSession } from './session.mjs';
import { botChannelId } from './connectors/channels/bot-definition.mjs';
import { pointCatalog, providerIdForDefinition, suppliedKeys, connectionOrigin } from './connectors/catalog.mjs';
import { ConnectWorkflow } from './connectors/workflow.mjs';
import { deriveConnectionViews, mutationSucceeded, requiresAuthorization } from './connectors/model.mjs';
import { projectConnectorObservations, unavailableConnectorObservations } from './connectors/observations.mjs';

const fail = code => Object.assign(new Error(code), { code });
const id = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value);
const clone = value => JSON.parse(JSON.stringify(value));
const channelTransports = new Set(['ilink-long-poll', 'websocket', 'lark-long-connection']);

// A probe result, a grant status and a lifecycle phase are three different
// facts about one connection, written at three different moments. Keeping them
// in one record per connection — rather than one flattened "status" string —
// is what lets the card say "authorized but offline" instead of asking a
// signed-in user to log in again.
const initialFacts = () => ({ grant: null, grantFailure: '', runtime: { phase: 'stopped', lastProbe: { outcome: 'never' } }, discovered: null, lastMutation: null, revision: '' });
// A start that never produced a working client is a runtime failure; anything
// else that ends a probe is a capability failure. The distinction decides
// whether the card offers "retry" against the process or against the service.
const startFailures = new Set(['MCP_CLIENT_EXIT', 'MCP_SESSION_RETIRED', 'MCP_IO', 'MCP_LAUNCH_FAILED', 'MCP_INTEGRITY']);
// Enable and disable are one native operation but two user-visible verbs, and
// a partially applied one has to name the verb the user actually pressed.
const pendingKind = request => request.operation === 'put' ? 'configure' : request.operation === 'enable' ? (request.enabled ? 'enable' : 'disable') : request.operation;

/** Shared transport selection for trusted native and portable Hosts. */
export const createConnectorSession = options => new MCPSession(options);

/** Trusted settings/Host API, deliberately NOT registered as Agent or App tools. */
export class ConnectorManager {
  #call; #approve; #sessions = new Map(); #facts = new Map(); #operation; #disposed = false;
  #connects = new Map(); #pending = null; #now; #createSession; #channelInbound; #channelCursors; #channelMediaRoot; #validateDefinition;
  constructor({ executable, approve, call, openAuthorizationURL, catalog = pointCatalog(), now = Date.now, createSession, validateDefinition, channelInbound, channelCursors = null, channelMediaRoot = null }) {
    this.executable = executable; this.#approve = approve; this.openAuthorizationURL = openAuthorizationURL;
    this.catalog = catalog; this.#now = now; this.workflow = new ConnectWorkflow({ now });
    this.#validateDefinition = validateDefinition ?? ((_connectorId, definition) => validateConnector(definition));
    this.#channelInbound = channelInbound;
    this.#channelCursors = channelCursors;
    this.#channelMediaRoot = channelMediaRoot;
    // Injected so the probe state machine — grant observation, runtime phases,
    // discovery — is reachable without a signed native service.
    this.#createSession = createSession ?? createConnectorSession;
    if (typeof call !== 'function') throw fail('MCP_CONFIG');
    this.#call = call;
  }
  async list() { if (this.#disposed) throw fail('MCP_CONTROL_DISPOSED'); return this.#call('mcp.control', [{ operation: 'list' }]); }

  /**
   * Reconciles persisted QR authorization metadata with the native Keychain
   * without returning secret bytes or starting an interactive login. This is
   * deliberately separate from verify(): opening the Channel page may refresh
   * local history, but must never create a QR transaction by itself.
   */
  async refreshAuthorization(connectorId) {
    if (this.#disposed) throw fail('MCP_CONTROL_DISPOSED');
    if (!id(connectorId)) throw fail('MCP_CONFIG');
    const entry = (await this.list()).find(candidate => candidate.connectorId === connectorId);
    if (!entry || entry.definition?.transport !== 'ilink-long-poll') throw fail('MCP_CONFIG');
    let state = this.#factsFor(connectorId);
    if (state.revision && state.revision !== entry.revision) {
      state = initialFacts(); this.#facts.set(connectorId, state);
    }
    state.revision = entry.revision;
    const reference = entry.definition?.token?.secretRef;
    if (!entry.definition?.accountId || !id(reference)) {
      state.grant = 'absent'; state.grantFailure = '';
      return { grant: 'absent' };
    }
    try {
      const result = await this.#call('mcp.control', [{ operation: 'credential.status', connectorId, expectedRevision: entry.revision }]);
      state.grant = result?.present === true ? 'present' : 'absent'; state.grantFailure = '';
      return { grant: state.grant };
    } catch (error) {
      // A failed Keychain lookup is unknown, never proof that the user logged
      // out. Keep the historical record visible and let the bounded code cross.
      state.grant = 'indeterminate'; state.grantFailure = '';
      throw error;
    }
  }

  #factsFor(connectorId) {
    let state = this.#facts.get(connectorId);
    if (!state) { state = initialFacts(); this.#facts.set(connectorId, state); }
    return state;
  }
  /**
   * The management surface consumes grant status; the execution side uses the
   * credential. Nothing below ever reads a token, so "present" here only means
   * the native service accepted a stored grant during the last probe.
   */
  #authorizationFor(entry, provider, state) {
    // A session that actually initialized is the only local evidence that a
    // stored grant still works. A persisted QR account + secretRef is still a
    // real historical record, though, so project it as indeterminate until the
    // native Keychain presence check above refreshes it; never call it absent.
    const storedQRRecord = entry.definition?.transport === 'ilink-long-poll' &&
      typeof entry.definition?.accountId === 'string' && !!entry.definition.accountId && id(entry.definition?.token?.secretRef);
    const observed = state.grant ?? (state.runtime?.lastProbe?.outcome === 'verified' ? 'present' : storedQRRecord ? 'indeterminate' : 'absent');
    return {
      grant: observed, mode: provider?.auth?.mode ?? 'none', failure: state.grantFailure || '',
      scopes: requiresAuthorization(provider) ? (entry.definition?.oauth?.scopes ?? []) : [],
      holder: provider?.auth?.credentialHolder ?? '',
    };
  }
  /**
   * Assembles one connection's independent facts. Facts recorded against an
   * older revision are dropped: a probe proves nothing about a configuration
   * that has since changed.
   */
  #connectionFacts(entry) {
    const providerId = providerIdForDefinition(entry.definition, entry.source);
    const provider = this.catalog.provider(providerId);
    let state = this.#factsFor(entry.connectorId);
    if (state.revision && state.revision !== entry.revision) { state = initialFacts(); this.#facts.set(entry.connectorId, state); }
    const hostAllowed = Array.isArray(entry.definition?.tools) ? entry.definition.tools : [];
    return {
      connection: {
        connectionId: entry.connectorId, providerId, owner: 'device', enabled: entry.enabled !== false,
        revision: entry.revision, sealed: entry.source === 'sealed', supplied: suppliedKeys(entry.definition),
        origin: connectionOrigin(entry.definition),
        accountLabel: typeof entry.definition?.accountId === 'string' ? entry.definition.accountId.slice(0, 128) : '',
      },
      authorization: entry.unavailableCode ? { ...this.#authorizationFor(entry, provider, state), grant: 'indeterminate', failure: '' } : this.#authorizationFor(entry, provider, state),
      runtime: entry.unavailableCode ? { phase: 'start-failed', holdsLease: false, code: entry.unavailableCode, lastProbe: { outcome: 'never' } } : state.runtime,
      // Every tool call still passes host approval, so a connected connector is
      // never the same thing as an unattended one.
      policy: { discovered: entry.unavailableCode ? [] : state.discovered ?? [], hostAllowed, grantScoped: null, needsApproval: hostAllowed },
      pending: { kind: this.#pending?.connectorId === entry.connectorId ? this.#pending.kind : '' },
      attempt: this.workflow.active(entry.connectorId),
      lastMutation: state.lastMutation,
    };
  }
  /** The product-level projection: a directory plus one card per connection. */
  async snapshot() {
    const entries = await this.list();
    const live = new Set(entries.map(entry => entry.connectorId));
    for (const connectorId of [...this.#facts.keys()]) if (!live.has(connectorId)) this.#facts.delete(connectorId);
    return {
      directory: this.catalog.visibleProviders(),
      providers: this.catalog.providers(),
      connections: deriveConnectionViews(this.catalog, entries.map(entry => this.#connectionFacts(entry)), this.#now()),
    };
  }
  /** Read-only Host observation. Never opens a session, probes a provider,
   * refreshes authorization or creates a second manager. A list failure is
   * unknown, not an empty successful catalog. Recheck disposal after I/O. */
  async observationSnapshot() {
    if (this.#disposed) return unavailableConnectorObservations('native-connector-owner-retired');
    let entries;
    try { entries = await this.list(); }
    catch { return unavailableConnectorObservations(this.#disposed ? 'native-connector-owner-retired' : 'native-connector-read-failed', this.#disposed ? 'unavailable' : 'unknown'); }
    if (this.#disposed) return unavailableConnectorObservations('native-connector-owner-retired');
    return projectConnectorObservations(entries.map(entry => {
      const facts = this.#connectionFacts(entry);
      return { facts, provider: this.catalog.provider(facts.connection.providerId), unavailable: !!entry.unavailableCode };
    }));
  }
  async #exclusive(fn) {
    if (this.#disposed) throw fail('MCP_CONTROL_DISPOSED');
    if (this.#operation) throw fail('MCP_CONTROL_BUSY');
    let done; this.#operation = new Promise(resolve => { done = resolve; });
    try { return await fn(); } finally { done(); this.#operation = undefined; }
  }
  async #change(request) {
    return this.#exclusive(async () => {
    request = clone(request);
    const summary = { ...request }; delete summary.value;
    this.#pending = request.connectorId ? { connectorId: request.connectorId, kind: pendingKind(request) } : null;
    try {
      if (typeof this.#approve !== 'function' || await this.#approve(summary) !== 'allowed-once') throw fail('MCP_CONTROL_APPROVAL_REQUIRED');
      if (this.#disposed) throw fail('MCP_CONTROL_DISPOSED');
      const value = await this.#call('mcp.control', [request]);
      // The stored change has landed. Whether the live runtime followed is a
      // separate question, and conflating them is what makes a UI either
      // restore the button on a change that already applied, or replay a whole
      // connect flow for work that only the runtime still owes.
      if (request.connectorId) await this.#settleRuntime(request);
      if (request.reference && this.#sessions.size > 0) {
        // Secret rotation also retires any dependent live bot immediately.
        // Native generation checks fence other hosts on their next lease renewal.
        for (const entry of await this.list()) {
          if (botChannelId(entry.definition?.transport) && Object.values(entry.definition).some(value => value?.secretRef === request.reference)) {
            await this.#settleRuntime({ operation: 'put', connectorId: entry.connectorId });
          }
        }
      }
      return value;
    } finally { this.#pending = null; }
    });
  }
  async #settleRuntime(request) {
    const state = this.#factsFor(request.connectorId);
    const session = this.#sessions.get(request.connectorId);
    const outcome = {
      operation: pendingKind(request),
      configurationApplied: true, authorizationApplied: ['logout', 'remove'].includes(request.operation),
      runtimeTouched: !!session, runtimeApplied: !session && !['unknown', 'pending'].includes(state.runtime.cleanup),
    };
    // Native retire may resolve with unknown cleanup. Resolution alone is
    // not evidence that the runtime stopped; retain that partial outcome.
    let cleanup = state.runtime.cleanup;
    if (session) {
      try { const retired = await session.retire(); cleanup = retired?.cleanup; outcome.runtimeApplied = !['unknown', 'pending'].includes(cleanup); }
      catch (error) { cleanup = 'unknown'; outcome.code = error.code ?? 'MCP_ERROR'; }
      this.#sessions.delete(request.connectorId);
    }
    if (request.operation === 'remove') { this.#facts.delete(request.connectorId); return; }
    state.runtime = { phase: 'stopped', cleanup, lastProbe: { outcome: 'never' } };
    state.discovered = null; state.revision = '';
    // A successful probe only proves the exact stored definition that was
    // opened. Reconfiguration (including a token/OAuth mode change or secret
    // rotation) must not carry that authorization evidence into the new one.
    if (request.operation === 'put') { state.grant = null; state.grantFailure = ''; }
    // A logout clears the local record; it does not revoke anything upstream.
    if (request.operation === 'logout') { state.grant = 'absent'; state.grantFailure = ''; }
    state.lastMutation = mutationSucceeded(outcome) ? null : outcome;
  }
  async put(connectorId, definition, expectedRevision) {
    if (!id(connectorId)) throw fail('MCP_CONFIG');
    return this.#change({ operation: 'put', connectorId, definition: await this.#validateDefinition(connectorId, definition), expectedRevision });
  }
  enable(connectorId, enabled, expectedRevision) { return this.#change({ operation: 'enable', connectorId, enabled, expectedRevision }); }
  remove(connectorId, expectedRevision) { return this.#change({ operation: 'remove', connectorId, expectedRevision }); }
  logout(connectorId, expectedRevision) { return this.#change({ operation: 'logout', connectorId, expectedRevision }); }
  setSecret(reference, value) { return this.#change({ operation: 'secret.set', reference, value }); }
  deleteSecret(reference) { return this.#change({ operation: 'secret.delete', reference }); }
  /**
   * Opens a real session, discovers tools and hands the session straight back.
   * The result is a capability verification, not a live connection: nothing
   * below leaves a login lease that would block an Agent, so the facts it
   * records say "verified and released" rather than "online".
   */
  async verify(connectorId, { signal, attemptId, revision, intent, interactive = true } = {}) {
    if (!id(connectorId)) throw fail('MCP_CONFIG');
    return this.#exclusive(async () => {
    // The card is busy from the moment the confirmation dialog appears, not
    // only once the session starts: a user waiting on a system prompt should
    // not see a resting state that invites a second click.
    this.#pending = { connectorId, kind: attemptId ? 'connect' : 'probe' };
    try {
    let entry = (await this.list()).find(candidate => candidate.connectorId === connectorId);
    if (!entry) throw fail('MCP_CONFIG');
    const providerId = providerIdForDefinition(entry.definition, entry.source);
    if (!this.#approve || await this.#approve({ operation: 'connect', connectorId, providerId }) !== 'allowed-once') throw fail('MCP_CONTROL_APPROVAL_REQUIRED');
    signal?.throwIfAborted();
    await this.#sessions.get(connectorId)?.retire();
    if (this.#disposed) throw fail('MCP_CONTROL_DISPOSED');
    const state = this.#factsFor(connectorId);
    const session = this.#createSession({
      executable: this.executable, connectorId, definition: entry.definition,
      operations: this.catalog.provider(providerId)?.operations ?? [],
      // Bypasses setSecret()'s own mutex: verify() already holds it.
      secrets: { set: (reference, value) => this.#call('mcp.control', [{ operation: 'secret.set', reference, value }]) },
      // Only QRSession reads this: it resumes a stored WeChat login's receive
      // loop. The native side returns nothing but that connection's own token,
      // and only at the exact revision this verify() is looking at.
      readStoredToken: async () => (await this.#call('mcp.control', [{ operation: 'channel.credential', connectorId, expectedRevision: entry.revision }]))?.token,
      // Only QRSession reads this (MCPSession ignores unknown options): a
      // channel's receive loop can keep failing long after verify() itself
      // returned, and there is nowhere else for that failure to go yet.
      onInbound: this.#channelInbound,
      cursorStore: this.#channelCursors,
      mediaInboxRoot: this.#channelMediaRoot,
      onRuntimeError: error => {
        const code = error?.code ?? 'CHANNEL_RUNTIME_FAILED';
        const peer = typeof error?.userId === 'string' && error.userId
          ? ` userId=${JSON.stringify(error.userId.slice(0, 256))}` : '';
        const status = Number.isInteger(error?.status) ? ` status=${error.status}` : '';
        // Transport messages carry only HTTP status / iLink errcode+errmsg,
        // never tokens, and are what distinguishes a dropped reply or upload.
        const text = typeof error?.detail === 'string' ? error.detail : code === 'MCP_WEIXIN' ? String(error?.message ?? '') : '';
        const detail = text ? ` detail=${JSON.stringify(text.slice(0, 200))}` : '';
        console.warn(`[connector:${connectorId}] channel runtime error:`, `${code}${status}${peer}${detail}`);
      },
      onRuntimeState: snapshot => {
        if (this.#sessions.get(connectorId) !== session || state.runtime.generation !== snapshot.sessionId) return;
        state.runtime = { ...state.runtime, phase: snapshot.phase === 'ready' ? 'ready' : snapshot.phase === 'stopped' ? 'stopped' : 'starting',
          holdsLease: snapshot.phase !== 'stopped', reachability: snapshot.phase === 'ready' ? 'reachable' : 'unknown',
          code: snapshot.phase === 'stopped' ? snapshot.code : snapshot.lastError || '', channelCode: snapshot.code, lastError: snapshot.lastError, deliveryMode: snapshot.deliveryMode ?? state.runtime.deliveryMode,
          ...(snapshot.phase === 'stopped' ? { lastProbe: { outcome: 'failed', code: snapshot.code, atMs: this.#now() } } : {}) };
        // The stored login still exists locally but the provider rejected it:
        // that is a rejected grant (offer re-scan), not a missing one.
        if (snapshot.code === 'MCP_AUTH_EXPIRED') {
          state.grantFailure = 'session_expired';
          console.warn(`[connector:${connectorId}] channel session expired; a new QR login is required`);
        }
      },
    });
    this.#sessions.set(connectorId, session);
    state.revision = revision ?? entry.revision;
    state.runtime = { phase: 'starting', generation: session.sessionId, lastProbe: state.runtime.lastProbe };
    try {
      await session.open({ signal });
      let tools;
      // "重新扫码" means a new QR even when a stored login still looks usable;
      // without this the stored record short-circuits list() and no code shows.
      const forceQR = intent === 'reauthorize' && entry.definition?.transport === 'ilink-long-poll' && typeof session.authorize === 'function';
      try {
        if (forceQR) throw fail('MCP_AUTH_REQUIRED');
        tools = await session.list({ signal });
      } catch (error) {
        if (error.code !== 'MCP_AUTH_REQUIRED' || !interactive || (!this.openAuthorizationURL && typeof session.authorize !== 'function')) throw error;
        // No local grant was usable. The card must say that, and the attempt
        // must move to waiting-for-approval before a browser window appears
        // — or, for a QR channel, before the scan code itself is shown.
        // A forced re-scan still has the old login until the new one lands.
        if (!forceQR) { state.grant = 'absent'; state.grantFailure = ''; }
        if (attemptId) { try { this.workflow.awaitApproval(connectorId, attemptId); } catch { /* the attempt may already have been cancelled */ } }
        await session.authorize({
          openURL: (url, authorizationClientId) => this.openAuthorizationURL(url, connectorId, signal, authorizationClientId), signal,
          onQR: qr => { if (attemptId) try { this.workflow.attachDetail(connectorId, attemptId, { qr }); } catch { /* the attempt may already have been cancelled */ } },
        });
        // A QR session that just authorized carries the account/token it
        // obtained on itself; persist it onto the stored definition so the
        // next connect does not need a fresh scan. This bypasses put()'s own
        // mutex because verify() already holds it.
        if (session.credentialPatch) {
          const patched = await this.#validateDefinition(connectorId, { ...entry.definition, ...session.credentialPatch });
          await this.#call('mcp.control', [{ operation: 'put', connectorId, definition: patched, expectedRevision: session.credentialRevision ?? entry.revision }]);
          entry = (await this.list()).find(candidate => candidate.connectorId === connectorId) ?? entry;
          state.revision = entry.revision;
          await session.rebind?.({ definition: entry.definition, revision: entry.revision });
        }
        tools = await session.list({ signal });
      }
      const admitted = (tools?.tools ?? []).map(tool => tool?.name).filter(name => typeof name === 'string');
      // `available` is every name the server offered; `tools` is the subset the
      // allowlist admits. Discovery has to see the whole list, or a settings
      // page could only ever offer tools it had already allowed. An older
      // worker that does not send it degrades to the admitted subset.
      const offered = Array.isArray(tools?.available)
        ? tools.available.filter(name => typeof name === 'string' && name && name.length <= 128).slice(0, 512)
        : admitted;
      state.discovered = [...new Set([...offered, ...admitted])];
      if (session.running) {
        // A channel that just started its receive loop is not "verified and
        // released" like every other transport's probe — it is actually
        // online, so the card should say `connected`, and the session stays
        // in #sessions so disable/disconnect/logout/remove can stop it later
        // (see #settleRuntime, which already calls session.retire() there).
        state.runtime = { phase: session.runtimeState && session.runtimeState.phase !== 'ready' ? 'starting' : 'ready', holdsLease: true, reachability: session.runtimeState && session.runtimeState.phase !== 'ready' ? 'unknown' : 'reachable', generation: session.sessionId, deliveryMode: session.deliveryMode ?? session.runtimeState?.deliveryMode, code: session.runtimeState?.lastError || '',
          lastProbe: { outcome: 'verified', atMs: this.#now(), toolCount: admitted.length, generation: session.sessionId } };
      } else {
        const retired = await session.retire(); this.#sessions.delete(connectorId);
        state.runtime = { phase: 'retired', holdsLease: false, reachability: 'reachable', generation: session.sessionId,
          lastProbe: { outcome: 'verified', atMs: this.#now(), toolCount: admitted.length, generation: session.sessionId }, cleanup: retired.cleanup };
      }
      state.grant = 'present'; state.grantFailure = ''; state.lastMutation = null;
      return tools;
    } catch (error) {
      const code = error.code ?? 'MCP_ERROR';
      const cancelled = code === 'ABORT_ERR';
      state.runtime = {
        phase: startFailures.has(code) ? 'start-failed' : 'stopped', generation: session.sessionId,
        reachability: startFailures.has(code) ? 'unreachable' : 'unknown', code: cancelled ? '' : code,
        lastProbe: { outcome: cancelled ? 'cancelled' : 'failed', atMs: this.#now(), code: cancelled ? '' : code, generation: session.sessionId },
      };
      // A Keychain that would not answer is not a missing grant. Saying
      // "absent" here would send a signed-in user through a pointless login.
      if (code === 'MCP_KEYCHAIN_UNAVAILABLE') state.grant = 'indeterminate';
      else if (code === 'MCP_AUTH_REQUIRED') { state.grant = 'absent'; state.grantFailure = ''; }
      else if (code === 'MCP_AUTH_DENIED') { state.grant = 'absent'; state.grantFailure = 'consent_revoked'; }
      session.close(); throw error;
    }
    } finally { this.#pending = null; }
    });
  }
  /**
   * Restarts the receive loop of every enabled WeChat connection that has a
   * stored login, and of every enabled WeCom/Feishu bot whose secret is
   * configured, without ever showing a QR code. Called once by the desktop
   * host at startup so a restart does not silently stop answering messages.
   * A connection whose login is gone is left as needs-authorization.
   */
  async resumeChannels() {
    const results = [];
    for (const entry of await this.list()) {
      const definition = entry.definition ?? {};
      const storedLogin = definition.transport === 'ilink-long-poll' && definition.accountId && id(definition.token?.secretRef);
      // WeCom/Feishu carry a configured bot secret instead of a scanned login.
      const configuredBot = (definition.transport === 'websocket' && id(definition.secret?.secretRef)) ||
        (definition.transport === 'lark-long-connection' && id(definition.appSecret?.secretRef));
      const nativeBot = !!this.#channelInbound && !!botChannelId(definition.transport);
      if (entry.enabled === false || !(storedLogin || configuredBot || nativeBot)) continue;
      if (this.#sessions.get(entry.connectorId)?.running) continue;
      try { await this.verify(entry.connectorId, { interactive: false }); results.push({ connectorId: entry.connectorId, resumed: true }); }
      catch (error) { results.push({ connectorId: entry.connectorId, resumed: false, code: error.code ?? 'MCP_ERROR' }); }
    }
    return results;
  }
  /** Retained name for the settings probe; the semantics are verification. */
  retry(connectorId, options) { return this.verify(connectorId, options); }
  /**
   * Closes the live runtime and nothing else: the configuration stays, the
   * grant stays, and the provider is not told anything. It is one of five
   * distinct verbs, not a synonym for logout or remove.
   */
  async disconnectRuntime(connectorId) {
    if (this.#disposed) throw fail('MCP_CONTROL_DISPOSED');
    if (!id(connectorId)) throw fail('MCP_CONFIG');
    const state = this.#factsFor(connectorId);
    const session = this.#sessions.get(connectorId);
    const outcome = { operation: 'disconnect-runtime', runtimeTouched: !!session, runtimeApplied: !session && !['unknown', 'pending'].includes(state.runtime.cleanup) };
    let cleanup = state.runtime.cleanup;
    if (session) {
      try { const retired = await session.retire(); cleanup = retired?.cleanup; outcome.runtimeApplied = !['unknown', 'pending'].includes(cleanup); }
      catch (error) { cleanup = 'unknown'; outcome.code = error.code ?? 'MCP_ERROR'; }
      this.#sessions.delete(connectorId);
    }
    state.runtime = { ...state.runtime, phase: 'retired', holdsLease: false, cleanup, sessionId: undefined };
    state.lastMutation = mutationSucceeded(outcome) ? null : outcome;
    return outcome;
  }
  /**
   * Admits a set of discovered tools. This is the second half of the flow a
   * connection goes through: it exists with an empty allowlist, discovery
   * finds what the server offers, and the user admits a subset. The write
   * still goes through put, so the native validator and the CAS revision
   * remain the authority.
   */
  async setTools(connectorId, tools, expectedRevision) {
    if (!id(connectorId) || !Array.isArray(tools)) throw fail('MCP_CONFIG');
    const entry = (await this.list()).find(candidate => candidate.connectorId === connectorId);
    if (!entry) throw fail('MCP_CONFIG');
    if (entry.revision !== expectedRevision) throw fail('MCP_CONFIG_CONFLICT');
    if (entry.source === 'sealed') throw fail('MCP_CONNECTOR_DENIED');
    // Only names this connection actually discovered may be admitted, so a
    // renderer cannot widen the allowlist to something never seen on the wire.
    // A renderer may admit what this connection discovered, and may keep what
    // the allowlist already held — a tool the server did not offer this time is
    // not evidence the user meant to drop it. It may not invent a name.
    const discovered = this.#factsFor(connectorId).discovered ?? [];
    const admissible = new Set([...discovered, ...(entry.definition?.tools ?? [])]);
    if (tools.some(name => !admissible.has(name))) throw fail('MCP_TOOL_DENIED');
    const result = await this.put(connectorId, { ...entry.definition, tools }, expectedRevision);
    // Admitting tools is the one configuration change that cannot alter what
    // the server offers, so the discovery it was chosen from survives it. Any
    // other edit drops it, because a probe describes the revision it ran on.
    this.#factsFor(connectorId).discovered = discovered;
    return result;
  }
  /** The directory's own link for a provider, resolved host-side by id. */
  providerLink(providerId, kind) {
    const entry = this.catalog.provider(providerId);
    const url = kind === 'revoke' ? entry?.auth?.revokeUrl : kind === 'docs' ? entry?.docsUrl : null;
    if (!url) throw fail('MCP_DIRECTORY');
    return url;
  }

  /**
   * beginConnect / cancelConnect / observeConnect are the transaction the
   * single Connect button hides. The host keeps the deadline, the callback and
   * the cleanup, so dismissing the window is only a UI event.
   */
  async beginConnect(connectorId, { intent = 'first-connect', revision } = {}) {
    if (this.#disposed) throw fail('MCP_CONTROL_DISPOSED');
    if (!id(connectorId)) throw fail('MCP_CONFIG');
    const attempt = this.workflow.begin(connectorId, { intent });
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), Math.max(0, attempt.expiresAtMs - this.#now()));
    timer.unref?.();
    const run = this.verify(connectorId, { signal: abort.signal, attemptId: attempt.attemptId, revision, intent })
      .then(tools => { this.#finish(connectorId, attempt.attemptId, null); return tools; },
        error => { this.#finish(connectorId, attempt.attemptId, error); throw error; })
      .finally(() => clearTimeout(timer));
    run.catch(() => {}); // Observed through observeConnect, never as an unhandled rejection.
    this.#connects.set(connectorId, { attempt, abort, run });
    return attempt;
  }
  #finish(connectorId, attemptId, error) {
    // The attempt runs detached from the request that started it, so this is
    // the only place its failure can reach the trusted log.
    if (error && error.code !== 'ABORT_ERR') console.warn(`[connector:${connectorId}] connect attempt failed: ${error.code ?? 'MCP_ERROR'}`);
    try {
      if (!error) this.workflow.succeed(connectorId, attemptId);
      else if (error.code === 'ABORT_ERR') this.workflow.cancel(connectorId, attemptId);
      else this.workflow.fail(connectorId, attemptId, error.code ?? 'MCP_ERROR');
    } catch { /* the attempt was already settled by a cancel or a timeout */ }
  }
  /** Ends the transaction. Rollback of a first connect stays the caller's call. */
  cancelConnect(connectorId, attemptId) {
    const record = this.#connects.get(connectorId);
    if (!record || record.attempt.attemptId !== attemptId) throw fail('MCP_NO_ATTEMPT');
    record.abort.abort();
    try { this.workflow.cancel(connectorId, attemptId); } catch { /* already terminal */ }
    return this.workflow.observe(connectorId, attemptId);
  }
  observeConnect(connectorId, attemptId) { return this.workflow.observe(connectorId, attemptId); }
  async dispose() {
    this.#disposed = true;
    // Abort an interactive authorization too, rather than waiting for its
    // callback. A transaction the host started is the host's to end.
    for (const { abort } of this.#connects.values()) abort.abort();
    this.workflow.abandon();
    for (const session of this.#sessions.values()) session.close();
    await this.#operation;
    await Promise.allSettled([...this.#connects.values()].map(record => record.run));
    await Promise.all([...this.#sessions.values()].map(s => s.retire()));
    this.#sessions.clear(); this.#facts.clear(); this.#connects.clear();
  }
}

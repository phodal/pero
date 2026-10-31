import { mkdir, writeFile } from 'node:fs/promises';
import { mkdirSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ConnectorManager } from './control.mjs';
import { MCPSession } from './session.mjs';
import { MCPSettingsController } from './settings-controller.mjs';
import { createCatalog, pointDirectory } from './connectors/catalog.mjs';
import { createPortableControl } from './portable-control.mjs';
import { createPortableCredentialAuthority } from './portable-credentials.mjs';
import { readPortableRegistry, validatePortableManagedDefinition } from './portable-registry.mjs';
import { discoverProvider, findExecutables } from './connectors/discovery.mjs';
import { installPlan, installCommand, managedBin, resolveRelease } from './connectors/installer.mjs';
import { InstallJobs } from './connectors/install-jobs.mjs';
import { InstallRecords } from './connectors/install-records.mjs';
import { FeishuAuthorization } from './connectors/feishu-workspace/authorization.mjs';

const fail = code => Object.assign(new Error(code), { code });
const setup = new Set(['discover', 'install.records', 'install.verify', 'install.run', 'install.status', 'install.cancel', 'install.command']);
const transports = new Set(['stdio', 'http', 'github', 'gitlab', 'linear', 'gmail', 'microsoft365']);

/** One trusted Host owner. The App receives projections, never this authority. */
export class HostConnectors {
  constructor({ root, executable, store, authorize, openURL, nodeExecutable, helpers }) {
    if (typeof authorize !== 'function' || typeof openURL !== 'function') throw fail('MCP_CONFIG');
    mkdirSync(resolve(root), { recursive: true, mode: 0o700 });
    this.root = realpathSync(root);
    this.registry = join(this.root, 'connectors.json');
    this.executable = executable;
    this.authorize = authorize;
    this.openURL = openURL;
    this.nodeExecutable = nodeExecutable;
    this.helpers = helpers;
    this.engineeringRoot = join(this.root, 'engineering-tools');
    this.records = new InstallRecords(join(this.root, 'install-records.json'));
    this.jobs = new InstallJobs({ onDone: async providerId => {
      const provider = this.catalog.provider(providerId);
      const [file] = await findExecutables(provider.discovery.executables, {
        prefix: !!provider.discovery.prefix, dirs: [managedBin(this.engineeringRoot)],
      });
      if (file?.executable) await this.records.record(providerId, file.path);
    } });
    this.catalog = createCatalog(pointDirectory().filter(provider => !provider.channel).map(provider => ({
      ...provider,
      ...Object.fromEntries(['displayName', 'summary', 'summaryEn', 'prerequisiteCopy', 'prerequisiteEn', 'gotchaCopy', 'gotchaEn'].filter(key => typeof provider[key] === 'string').map(key => [key, provider[key].replaceAll('Point', 'Pero').replaceAll('Keychain', key.endsWith('En') ? 'system credential storage' : '系统凭据存储')])),
    })));
    this.credentials = createPortableCredentialAuthority({ registry: this.registry, store });
    this.manager = new ConnectorManager({
      executable, catalog: this.catalog,
      approve: async () => { await this.authorize(); return 'allowed-once'; },
      call: createPortableControl({ registry: this.registry, credentialAuthority: this.credentials }),
      validateDefinition: async (id, definition) => {
        if (!transports.has(definition?.transport)) throw fail('MCP_TRANSPORT_UNSUPPORTED');
        return validatePortableManagedDefinition(id, definition, { credentials: true });
      },
      createSession: options => new MCPSession({ ...options, backend: 'portable', registry: this.registry, credentialAuthority: this.credentials }),
      openAuthorizationURL: async (url, _connector, signal) => {
        signal?.throwIfAborted();
        await this.authorize();
        signal?.throwIfAborted();
        await this.openURL(url);
      },
    });
    this.controller = new MCPSettingsController(this.manager, { openLink: url => this.openURL(url) });
    this.feishuAuthorization = new FeishuAuthorization({ root: join(this.root, 'feishu-authorization'),
      definition: id => this.feishuDefinition(id), openExternal: url => this.openURL(url) });
    this.sessions = new Map();
    this.operations = new Set();
    this.lifetime = new AbortController();
    this.closed = false;
  }

  async start() {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    await writeFile(this.registry, JSON.stringify({ 'point.table': { transport: 'builtin', tools: ['table_summary'] } }) + '\n', { flag: 'wx', mode: 0o600 })
      .catch(error => { if (error.code !== 'EEXIST') throw error; });
    await readPortableRegistry(this.registry, { metadataOnly: true, credentials: true });
  }

  /** Management is admitted by the enabled App grant, separately from Agent tools. */
  request(input) {
    const work = this.handleRequest(input);
    this.operations.add(work);
    work.then(() => this.operations.delete(work), () => this.operations.delete(work));
    return work;
  }

  async handleRequest(input) {
    if (this.closed) return { ok: false, code: 'MCP_CONTROL_DISPOSED' };
    if (input?.operation === 'feishu.authorization' || input?.operation === 'feishu.workspace') {
      try {
        if (Object.keys(input).some(key => !(input.operation === 'feishu.authorization'
          ? ['operation', 'connectorId', 'action', 'capabilities', 'attemptId'] : ['operation', 'connectorId', 'input']).includes(key))) throw fail('MCP_ARGUMENT');
        await this.authorize();
        await this.feishuDefinition(input.connectorId);
        if (input.operation === 'feishu.authorization') {
          const auth = this.feishuAuthorization;
          const result = input.action === 'begin' ? await auth.begin(input.connectorId, input.capabilities)
            : input.action === 'finish' ? await auth.finish(input.connectorId, input.attemptId)
            : input.action === 'cancel' ? auth.cancel(input.connectorId)
            : input.action === 'status' ? auth.status(input.connectorId) : null;
          return result ? { ok: true, result } : { ok: false, code: 'MCP_ARGUMENT' };
        }
        if (input.input?.action !== 'account' || Object.keys(input.input).length !== 1) throw fail('MCP_ARGUMENT');
        const session = new MCPSession({ executable: this.executable, backend: 'portable', registry: this.registry, connectorId: input.connectorId, credentialAuthority: this.credentials });
        try {
          await session.open({ signal: this.lifetime.signal });
          const result = await session.call('feishu_account_get', {}, { signal: this.lifetime.signal });
          if (result.isError) throw fail('FEISHU_REQUEST');
          return { ok: true, result: result.structuredContent ?? JSON.parse(result.content.find(item => item.type === 'text').text) };
        } finally { session.close(); await session.retire(); }
      } catch (error) { return { ok: false, code: /^(FEISHU|MCP)_[A-Z0-9_]+$/.test(error.code ?? '') ? error.code : 'FEISHU_REQUEST' }; }
    }
    if (!setup.has(input?.operation)) return this.controller.request(input);
    if (!input || typeof input !== 'object' || Array.isArray(input) || Buffer.byteLength(JSON.stringify(input)) > 4096 ||
        Object.keys(input).some(key => !['operation', 'providerId'].includes(key))) return { ok: false, code: 'MCP_ARGUMENT' };
    if (input.operation === 'install.records') {
      return { ok: true, records: (await this.records.list()).map(({ providerId, installedAt }) => ({ providerId, installedAt })), running: this.jobs.running() };
    }
    const provider = this.catalog.provider(input.providerId);
    if (!provider?.discovery) return { ok: false, code: 'MCP_ARGUMENT' };
    try {
      if (input.operation === 'discover') {
        const plan = await installPlan(provider, { root: this.engineeringRoot });
        const discovery = await discoverProvider(provider, {
          extraDirs: [managedBin(this.engineeringRoot)], nodeExecutable: this.nodeExecutable,
          ...(this.helpers ? { feishuBundles: [join(this.helpers, 'point-feishu-workspace.mjs')], scienceBundles: [join(this.helpers, 'point-science-connector.mjs')] } : {}),
        });
        if (discovery.definition?.command === this.nodeExecutable) {
          discovery.definition.env = { ...discovery.definition.env, ELECTRON_RUN_AS_NODE: '1' };
        }
        return { ok: true,
          ...discovery,
          installable: !!plan && plan.kind !== 'unavailable', installSummary: plan?.summary ?? null,
          install: this.jobs.snapshot(provider.providerId),
        };
      }
      if (!provider.install) throw fail('MCP_ARGUMENT');
      if (input.operation === 'install.verify') return { ok: true, state: await this.records.verify(provider.providerId) };
      if (input.operation === 'install.status') return { ok: true, job: this.jobs.snapshot(provider.providerId) };
      if (input.operation === 'install.cancel') return { ok: true, job: this.jobs.cancel(provider.providerId) };
      await this.authorize();
      const plan = await installPlan(provider, { root: this.engineeringRoot });
      if (!plan || plan.kind === 'unavailable') throw fail(plan?.reason ?? 'MCP_ARGUMENT');
      const release = plan.kind === 'github-release' ? await resolveRelease(plan) : undefined;
      const command = installCommand(plan, { root: this.engineeringRoot, release });
      if (input.operation === 'install.command') return { ok: true, command, summary: plan.summary, version: release?.version ?? null };
      return { ok: true, job: this.jobs.start(provider.providerId, command) };
    } catch (error) {
      return { ok: false, code: /^MCP_[A-Z0-9_]+$/.test(error.code ?? '') ? error.code : 'MCP_OPERATION_FAILED' };
    }
  }

  async feishuDefinition(id) {
    const connection = (await this.manager.snapshot()).connections.find(item => item.connectionId === id && item.providerId === 'feishu-workspace');
    const stored = connection && (await this.manager.list()).find(item => item.connectorId === id);
    if (this.closed || !stored?.definition?.env?.POINT_FEISHU_CLI) throw fail('FEISHU_CONFIG');
    return stored.definition;
  }

  /** Freeze the enabled connection revision once for one real Host conversation. */
  async admit(thread) {
    if (this.closed || typeof thread !== 'string' || !thread || thread.length > 128) throw fail('MCP_IDENTITY');
    if (!this.sessions.has(thread)) {
      const ready = readPortableRegistry(this.registry, { metadataOnly: true, credentials: true });
      ready.catch(() => {});
      this.sessions.set(thread, { ready, clients: new Map() });
    }
    const state = this.sessions.get(thread);
    if (state.retiring) throw fail('MCP_SESSION_RETIRED');
    state.snapshot = await state.ready;
    if (this.closed || state.retiring || this.sessions.get(thread) !== state) throw fail('MCP_SESSION_RETIRED');
    return state;
  }

  async tools(thread) {
    const { snapshot } = await this.admit(thread);
    return Object.entries(snapshot.entries).filter(([, entry]) => entry.enabled).map(([id, entry]) => ({
      connectorId: id, tools: [...entry.definition.tools], transport: entry.definition.transport,
    }));
  }

  async call(thread, connectorId, name, args, signal) {
    const state = await this.admit(thread);
    const entry = state.snapshot.entries[connectorId];
    if (!entry?.enabled || !entry.definition.tools.includes(name)) throw fail('MCP_TOOL_DENIED');
    await readPortableRegistry(this.registry, { revision: state.snapshot.revision });
    let client = state.clients.get(connectorId);
    if (!client) {
      const session = new MCPSession({ executable: this.executable, backend: 'portable', registry: this.registry, expectedRevision: state.snapshot.revision, connectorId, credentialAuthority: this.credentials });
      const opening = session.open({ signal });
      opening.catch(() => {});
      client = { session, opening };
      state.clients.set(connectorId, client);
    }
    await client.opening;
    return client.session.call(name, args, { signal });
  }

  async forget(thread) {
    const state = this.sessions.get(thread);
    if (!state) return;
    state.retiring ??= Promise.all([...state.clients.values()].map(async ({ session }) => {
      session.close(); await session.retire();
    }));
    await state.retiring;
    this.sessions.delete(thread);
  }

  async close() {
    this.closed = true;
    this.lifetime.abort();
    this.feishuAuthorization.dispose();
    await Promise.all([this.controller.dispose(), this.jobs.close(), ...[...this.sessions.keys()].map(thread => this.forget(thread))]);
    await Promise.allSettled([...this.operations]);
  }
}

import { PassThrough, Writable } from 'node:stream';
import { readPortableRegistry } from './portable-registry.mjs';
import { launchPortableWorker } from './portable-process.mjs';
import { botChannelId } from './connectors/channels/bot-definition.mjs';

const fail = code => Object.assign(new Error(code), { code });
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const METHODS = new Set(['mcp.session.open', 'mcp.session.renew', 'mcp.tools.list', 'mcp.tools.call', 'mcp.oauth.begin', 'mcp.oauth.complete', 'mcp.resources.read', 'mcp.apps.call']);
const FIELDS = new Set(['sessionId', 'requestId', 'connectorId', 'name', 'arguments', 'callback', 'apps', 'timeoutMs', 'leaseMs']);
const APP_METHODS = new Set(['mcp.resources.read', 'mcp.apps.call']);
const LIMIT = 2097152;

/** Private, host-owned translation of the native channel contract. Secrets and
 * refresh snapshots exist only on this private pipe. A renderer cannot supply
 * authority, a definition, a credential, an executable or a new Apps grant.
 */
export function launchPortableChannel({ executable, registry, snapshot, connectorId, credentialAuthority, channelExecutable, channelSha256 }) {
  if (credentialAuthority && credentialAuthority.registry !== registry) throw fail('MCP_CONFIG');
  const channel = !!botChannelId(snapshot.connectors[connectorId]?.transport);
  if (channel && (!credentialAuthority || !channelExecutable)) throw fail('MCP_CHANNEL_UNAVAILABLE');
  const endpoint = launchPortableWorker({ executable: channel ? channelExecutable : executable, registry, channel });
  const child = endpoint.child;
  const output = new PassThrough();
  let pending, binding, lease, releaseError, stopped = false, processing = false, buffer = Buffer.alloc(0);
  const active = new Set();
  const track = promise => { active.add(promise); promise.finally(() => active.delete(promise)).catch(() => {}); return promise; };
  const stop = () => { if (!stopped) { stopped = true; endpoint.terminate(); } };
  const reject = code => {
    if (stopped) return;
    output.write(JSON.stringify({ ok: false, error: { code, message: code } }) + '\n');
    stop();
  };
  const input = new Writable({ write(bytes, _encoding, done) {
    track((async () => {
      if (stopped) throw fail('MCP_SESSION_RETIRED');
      if (pending || bytes.length > 131072) throw fail('MCP_PROTOCOL');
      let request;
      try { request = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { throw fail('MCP_ARGUMENT'); }
      const { action, args } = request ?? {};
      if (!record(request) || Object.keys(request).some(key => !['action', 'args'].includes(key)) || !METHODS.has(action) || !Array.isArray(args) || args.length !== 1 || !record(args[0])) throw fail('MCP_METHOD_DENIED');
      const r = args[0];
      if (connectorId !== undefined && r.connectorId !== connectorId || Object.keys(r).some(key => !FIELDS.has(key)) || typeof r.sessionId !== 'string' || r.sessionId.length < 16 || r.sessionId.length > 128 ||
          typeof r.requestId !== 'string' || !r.requestId || r.requestId.length > 128 || typeof r.connectorId !== 'string' || !Object.hasOwn(snapshot.connectors, r.connectorId)) throw fail('MCP_ARGUMENT');
      if (!binding) {
        if (action !== 'mcp.session.open') throw fail('MCP_NOT_OPEN');
        if (r.apps !== undefined && typeof r.apps !== 'boolean') throw fail('MCP_ARGUMENT');
        binding = { sessionId: r.sessionId, connectorId: r.connectorId, apps: r.apps === true };
        if (credentialAuthority) lease = await credentialAuthority.open({ snapshot, ...binding });
      } else {
        if (binding.sessionId !== r.sessionId || binding.connectorId !== r.connectorId || action === 'mcp.session.open') throw fail('MCP_IDENTITY');
        if (Object.hasOwn(r, 'apps')) throw fail('MCP_ARGUMENT');
      }
      if (APP_METHODS.has(action) && !binding.apps) throw fail('MCP_METHOD_DENIED');
      if (channel && !['mcp.session.open', 'mcp.session.renew', 'mcp.tools.list'].includes(action)) throw fail('MCP_METHOD_DENIED');
      if (action.startsWith('mcp.oauth.') && !credentialAuthority) throw fail('MCP_CREDENTIAL_STORE_UNAVAILABLE');
      await readPortableRegistry(registry, { revision: snapshot.revision });
      if (lease) await lease.check();
      if (stopped) throw fail('MCP_SESSION_RETIRED');
      pending = { sessionId: binding.sessionId, connectorId: binding.connectorId, requestId: r.requestId };
      const wire = JSON.stringify({ ...r, method: action, ...(action === 'mcp.session.open' ? { definition: snapshot.connectors[r.connectorId], ...lease?.initial } : {}) }) + '\n';
      if (Buffer.byteLength(wire) > 131072) throw fail('MCP_REQUEST_LIMIT');
      child.stdin.write(wire);
    })()).then(() => done(), error => { reject(error.code ?? 'MCP_CONFIG'); done(); });
  } });
  child.stdin.on('error', () => reject('MCP_IO'));
  child.stdout.on('error', () => reject('MCP_IO'));
  child.stdout.on('data', chunk => {
    if (stopped) return;
    if (!pending || processing) { reject('MCP_PROTOCOL'); return; }
    if (buffer.length + chunk.length > LIMIT) { reject('MCP_REPLY_LIMIT'); return; }
    buffer = Buffer.concat([buffer, chunk]);
    const end = buffer.indexOf(10);
    if (end < 0) return;
    if (end !== buffer.length - 1) { reject('MCP_PROTOCOL'); return; }
    let reply;
    try { reply = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, end))); } catch { reject('MCP_PROTOCOL'); return; }
    buffer.fill(0); buffer = Buffer.alloc(0);
    if (!record(reply) || Object.keys(reply).some(key => !['ok', 'value', 'error', 'credentialsSnapshot'].includes(key)) || (reply.ok === true ? !Object.hasOwn(reply, 'value') || Object.hasOwn(reply, 'error') : reply.ok !== false || Object.hasOwn(reply, 'value') || typeof reply.error?.code !== 'string' || !reply.error.code)) { reject('MCP_PROTOCOL'); return; }
    if (reply.ok && (!record(reply.value) || reply.value.workerPid !== child.pid || ['sessionId', 'connectorId', 'requestId'].some(key => reply.value[key] !== pending[key]))) { reject('MCP_IDENTITY'); return; }
    processing = true;
    track((async () => {
      if (Object.hasOwn(reply, 'credentialsSnapshot')) {
        if (!lease) throw fail('MCP_CREDENTIAL_SAVE_FAILED_NO_REPLAY');
        // The save happens even on an auth error: refresh rotation may already
        // have happened. Stale generation or failed persistence retires without
        // replaying the business operation or reporting a false success.
        await lease.save(reply.credentialsSnapshot);
      }
      if (stopped) return;
      const publicReply = reply.ok ? { ok: true, value: { ...reply.value, transport: 'stdio' } }
        : { ok: false, error: { code: reply.error.code } };
      pending = null; processing = false;
      output.write(JSON.stringify(publicReply) + '\n');
    })()).catch(error => reject(error.code ?? 'MCP_CREDENTIAL_SAVE_FAILED_NO_REPLAY'));
  });
  const closed = endpoint.closed.then(async result => {
    stopped = true;
    await Promise.allSettled([...active]);
    try { await lease?.close(); }
    catch { releaseError = fail('MCP_CREDENTIAL_RELEASE_FAILED'); }
    finally { buffer.fill(0); output.end(); }
    return releaseError ? { ...result, error: releaseError } : result;
  });
  return { input, output, diagnostics: child.stderr, pid: child.pid, child,
    closed, get error() { return releaseError ?? endpoint.error; }, terminate: stop };
}

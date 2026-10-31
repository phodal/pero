import { createHash, randomUUID } from 'node:crypto';
import { botChannelId } from './connectors/channels/bot-definition.mjs';
import { readPortableRegistry } from './portable-registry.mjs';
import { acquirePortableLock, credentialAccount, entryRevision, fail, secretReferences, validId, withPortableCatalogLock, writePortableCatalog } from './portable-store.mjs';

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fields = {
  'secret.set': ['reference', 'value'], 'secret.delete': ['reference'],
  'credential.status': ['connectorId', 'expectedRevision'],
  'channel.credential': ['connectorId', 'expectedRevision'], logout: ['connectorId', 'expectedRevision'],
};
const channelFields = { 'ilink-long-poll': 'token', websocket: 'secret', 'lark-long-connection': 'appSecret' };

/** Private host capability, never a serialized profile or renderer handle.
 * The same registry lock serializes control mutations and credential saves.
 * OAuth leases span a complete worker lifetime, including failed refreshes.
 */
export function createPortableCredentialAuthority({ registry, store }) {
  if (!store || ['read', 'write', 'remove'].some(method => typeof store[method] !== 'function')) throw fail('MCP_CONFIG');
  const read = () => readPortableRegistry(registry, { metadataOnly: true, credentials: true });
  const locked = (fn, options) => withPortableCatalogLock(registry, fn, options);
  const revoke = (connectorId, entry) => store.remove(credentialAccount(connectorId, entry));
  async function open({ snapshot, connectorId, sessionId }) {
    if (!validId(connectorId) || typeof sessionId !== 'string' || sessionId.length < 16 || sessionId.length > 128) throw fail('MCP_IDENTITY');
    const entry = snapshot.entries[connectorId];
    if (!entry || !entry.enabled) throw fail('MCP_CONNECTOR_DENIED');
    let release, channelRelease, closed = false;
    const account = credentialAccount(connectorId, entry);
    if (entry.definition.oauth?.persist === true) release = await acquirePortableLock(registry, '.' + account.slice(6) + '.lease');
    if (botChannelId(entry.definition.transport)) channelRelease = await acquirePortableLock(registry, '.channel.' + connectorId + '.lease');
    const check = async () => {
      if (closed) throw fail('MCP_SESSION_RETIRED');
      await readPortableRegistry(registry, { revision: snapshot.revision });
    };
    const close = async () => { if (!closed) { closed = true; try { await release?.(); } finally { await channelRelease?.(); } } };
    try {
      const initial = await locked(async () => {
        await check();
        const secrets = Object.create(null);
        for (const ref of secretReferences(entry.definition)) {
          const value = await store.read('secret:' + ref);
          if (typeof value !== 'string' || !value) throw fail('MCP_SECRET_REQUIRED');
          secrets[ref] = value;
        }
        const initial = { secrets };
        if (release) {
          const value = await store.read(account);
          if (value !== null) {
            try { initial.credentials = JSON.parse(value); } catch { throw fail('MCP_CREDENTIAL_STORE_CORRUPT'); }
            if (!record(initial.credentials)) throw fail('MCP_CREDENTIAL_STORE_CORRUPT');
          }
        }
        return initial;
      });
      return Object.freeze({ initial, check, close,
        async save(snapshotValue) {
          if (!release) throw fail('MCP_CREDENTIAL_SAVE_FAILED_NO_REPLAY');
          try {
            if (snapshotValue !== null && !record(snapshotValue)) throw fail('MCP_PROTOCOL');
            const text = JSON.stringify(snapshotValue);
            if (Buffer.byteLength(text) > 131072) throw fail('MCP_SECRET_LIMIT');
            await locked(async () => {
              await check();
              if (snapshotValue === null) await store.remove(account);
              else await store.write(account, text);
            // Persist an already-produced snapshot once. Ordinary contention
            // with another connector is not a refresh failure. The wait fits
            // the outer 59-second request budget (45s worker + 3s wait + 10s
            // store), and generation is rechecked only after owning the lock.
            // No OAuth request or business operation is repeated here.
            }, { waitMs: 3000 });
          } catch { throw fail('MCP_CREDENTIAL_SAVE_FAILED_NO_REPLAY'); }
        },
      });
    } catch (error) { await close(); throw error; }
  }
  async function control(request, binding) {
    const allowed = fields[request.operation];
    if (!allowed || Object.keys(request).some(key => key !== 'operation' && !allowed.includes(key))) throw fail('MCP_ARGUMENT');
    return locked(async () => {
      const snapshot = await read();
      const entries = structuredClone(snapshot.entries);
      if (binding && (binding.closed || !snapshot.entries[binding.connectorId]?.enabled || entryRevision(snapshot.entries[binding.connectorId]) !== binding.revision)) throw fail('MCP_CONFIG_CHANGED');
      if (request.operation.startsWith('secret.')) {
        if (!validId(request.reference) || request.operation === 'secret.set' && (typeof request.value !== 'string' || !request.value || request.value.includes('\0') || Buffer.byteLength(request.value) > 16384)) throw fail('MCP_ARGUMENT');
        const old = [];
        for (const [id, entry] of Object.entries(entries)) if (secretReferences(entry.definition).includes(request.reference)) {
          old.push([id, snapshot.entries[id]]); entry.generation = randomUUID();
        }
        // Fence old sessions first. Any subsequent store failure is explicit
        // applied-but-incomplete and must be reconciled rather than replayed.
        if (old.length) await writePortableCatalog(registry, snapshot, entries);
        try {
          for (const [id, entry] of old) if (entry.definition.oauth?.persist === true) await revoke(id, entry);
          if (request.operation === 'secret.set') await store.write('secret:' + request.reference, request.value);
          else await store.remove('secret:' + request.reference);
        } catch (error) { if (old.length) throw fail('MCP_CREDENTIAL_CHANGE_APPLIED_INCOMPLETE'); throw error; }
        if (binding) binding.revision = entryRevision(entries[binding.connectorId]);
        return { updated: true };
      }
      if (!validId(request.connectorId) || typeof request.expectedRevision !== 'string') throw fail('MCP_ARGUMENT');
      const entry = entries[request.connectorId];
      if (!entry) throw fail('MCP_CONFIG');
      if (entryRevision(entry) !== request.expectedRevision) throw fail('MCP_CONFIG_CONFLICT');
      if (request.operation === 'credential.status') {
        const refs = secretReferences(entry.definition);
        for (const ref of refs) if (await store.read('secret:' + ref) === null) return { present: false };
        if (entry.definition.oauth?.persist === true) return { present: await store.read(credentialAccount(request.connectorId, entry)) !== null };
        return { present: refs.length > 0 };
      }
      if (request.operation === 'channel.credential') {
        const field = channelFields[entry.definition.transport];
        const ref = entry.definition[field]?.secretRef;
        if (!entry.enabled || !field || !validId(ref)) throw fail('MCP_CONFIG');
        const token = await store.read('secret:' + ref);
        if (typeof token !== 'string' || !token) throw fail('MCP_SECRET_REQUIRED');
        return { token };
      }
      entry.generation = randomUUID();
      await writePortableCatalog(registry, snapshot, entries);
      try { if (entry.definition.oauth?.persist === true) await revoke(request.connectorId, snapshot.entries[request.connectorId]); }
      catch { throw fail('MCP_CREDENTIAL_CHANGE_APPLIED_INCOMPLETE'); }
      return { updated: true };
    });
  }
  async function openHostChannel({ connectorId, definition }) {
    if (!validId(connectorId) || !Object.hasOwn(channelFields, definition?.transport)) throw fail('MCP_CONFIG');
    const release = await acquirePortableLock(registry, '.channel.' + connectorId + '.lease');
    const binding = { connectorId, revision: '', definition, closed: false };
    let pending;
    try {
      const snapshot = await read();
      const entry = snapshot.entries[connectorId];
      if (!entry?.enabled || JSON.stringify(entry.definition) !== JSON.stringify(definition)) throw fail('MCP_CONFIG_CHANGED');
      binding.revision = entryRevision(entry);
    } catch (error) { await release(); throw error; }
    return Object.freeze({
      get revision() { return binding.revision; },
      async check() {
        await pending;
        if (binding.closed) throw fail('MCP_SESSION_RETIRED');
        const entry = (await read()).entries[connectorId];
        if (binding.closed) throw fail('MCP_SESSION_RETIRED');
        if (!entry?.enabled || entryRevision(entry) !== binding.revision) throw fail('MCP_CONFIG_CHANGED');
      },
      async setSecret(reference, value) {
        if (binding.closed || pending) throw fail('MCP_SESSION_RETIRED');
        if (definition.transport !== 'ilink-long-poll' || reference !== `wechat.${createHash('sha256').update(connectorId).digest('hex')}.token`) throw fail('MCP_CONFIG');
        pending = control({ operation: 'secret.set', reference, value }, binding);
        try { return await pending; } finally { pending = undefined; }
      },
      async rebind({ definition: updated, revision }) {
        if (binding.closed) throw fail('MCP_SESSION_RETIRED');
        const entry = (await read()).entries[connectorId];
        // A manager may adopt only the exact QR credential patch it persisted.
        // Tool/sender/transport authority cannot expand through rebind.
        const policy = definition => Object.fromEntries(Object.entries(definition).filter(([key]) => !['accountId', 'token', 'baseUrl'].includes(key)));
        if (definition.transport !== 'ilink-long-poll' || !entry?.enabled || entryRevision(entry) !== revision || JSON.stringify(entry.definition) !== JSON.stringify(updated) || JSON.stringify(policy(updated)) !== JSON.stringify(policy(definition))) throw fail('MCP_CONFIG_CHANGED');
        binding.revision = revision; binding.definition = updated;
      },
      async close() { if (!binding.closed) { binding.closed = true; await pending?.catch(() => {}); await release(); } },
    });
  }
  return Object.freeze({ open, openHostChannel, control: request => control(request), revoke, registry });
}

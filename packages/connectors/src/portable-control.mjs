import { randomUUID } from 'node:crypto';
import { PORTABLE_REGISTRY_LIMIT, readPortableRegistry, requiresPortableCredentials, validatePortableManagedDefinition } from './portable-registry.mjs';
import { entryRevision as revision, fail, validId, trustedDirectory, withPortableCatalogLock, writePortableCatalog } from './portable-store.mjs';

const sealed = entry => entry.definition.transport === 'builtin';
const fields = { list: [], put: ['connectorId', 'definition', 'expectedRevision'], enable: ['connectorId', 'enabled', 'expectedRevision'], remove: ['connectorId', 'expectedRevision'] };
const credentials = new Set(['secret.set', 'secret.delete', 'credential.status', 'channel.credential', 'logout']);

/** Trusted Host control authority. Never an Agent tool or a network endpoint.
 * Credentials require a private authority; a registry alone grants no access.
 */
export function createPortableControl({ registry, credentialAuthority }) {
  if (credentialAuthority && credentialAuthority.registry !== registry) throw fail('MCP_CONFIG');
  return async function call(action, args) {
    if (action !== 'mcp.control' || !Array.isArray(args) || args.length !== 1 || !args[0] || typeof args[0] !== 'object' || Array.isArray(args[0])) throw fail('MCP_ARGUMENT');
    const request = structuredClone(args[0]);
    if (Buffer.byteLength(JSON.stringify(request)) > PORTABLE_REGISTRY_LIMIT) throw fail('MCP_ARGUMENT');
    if (credentials.has(request.operation)) {
      if (!credentialAuthority) throw fail('MCP_CREDENTIAL_STORE_UNAVAILABLE');
      return credentialAuthority.control(request);
    }
    if (!Object.hasOwn(fields, request.operation) || Object.keys(request).some(key => key !== 'operation' && !fields[request.operation].includes(key))) throw fail('MCP_ARGUMENT');
    await trustedDirectory(registry);
    if (request.operation === 'list') {
      const snapshot = await readPortableRegistry(registry, { metadataOnly: true, credentialMetadata: true, credentials: !!credentialAuthority });
      return Object.entries(snapshot.entries).map(([connectorId, entry]) => ({ connectorId, definition: entry.definition, enabled: entry.enabled, revision: revision(entry), source: sealed(entry) ? 'sealed' : 'managed', ...(!credentialAuthority && requiresPortableCredentials(entry.definition) ? { unavailableCode: 'MCP_CREDENTIAL_STORE_UNAVAILABLE' } : {}) }));
    }
    if (!validId(request.connectorId)) throw fail('MCP_ARGUMENT');
    return withPortableCatalogLock(registry, async () => {
      const snapshot = await readPortableRegistry(registry, { metadataOnly: true, credentialMetadata: true, credentials: !!credentialAuthority });
      const previous = snapshot.entries[request.connectorId];
      if (request.expectedRevision !== (previous ? revision(previous) : undefined)) throw fail('MCP_CONFIG_CONFLICT');
      if (previous && sealed(previous)) throw fail('MCP_CONFIG');
      if (previous && !credentialAuthority && requiresPortableCredentials(previous.definition)) throw fail('MCP_CREDENTIAL_STORE_UNAVAILABLE');
      const entries = structuredClone(snapshot.entries);
      if (request.operation === 'put') {
        // Managed bindings are references only, never plaintext passwords or
        // bearer headers. Static operator maps retain their original contract.
        await validatePortableManagedDefinition(request.connectorId, request.definition, { credentials: !!credentialAuthority });
        if (request.definition.transport === 'builtin') throw fail('MCP_CONFIG');
        entries[request.connectorId] = { definition: request.definition, enabled: true, generation: randomUUID() };
      } else if (request.operation === 'enable') {
        if (!previous || typeof request.enabled !== 'boolean') throw fail('MCP_ARGUMENT');
        entries[request.connectorId] = { ...previous, enabled: request.enabled, generation: randomUUID() };
      } else {
        if (!previous) throw fail('MCP_CONFIG');
        delete entries[request.connectorId];
      }
      await writePortableCatalog(registry, snapshot, entries);
      if (previous?.definition.oauth?.persist === true && credentialAuthority) {
        try { await credentialAuthority.revoke(request.connectorId, previous); }
        catch { throw fail('MCP_CREDENTIAL_CHANGE_APPLIED_INCOMPLETE'); }
      }
      return { updated: true };
    });
  };
}

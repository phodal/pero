import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { validateConnector } from './connectors/validation.mjs';
import { botChannelId } from './connectors/channels/bot-definition.mjs';

const fail = code => Object.assign(new Error(code), { code });
const freeze = value => { if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; };
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const PORTABLE_REGISTRY_LIMIT = 131072;
export const PORTABLE_CATALOG_FORMAT = 'point.mcp.catalog.v1';
export const requiresPortableCredentials = definition => !['builtin', 'stdio', 'http'].includes(definition.transport) || definition.oauth !== undefined ||
  Object.values(definition).some(value => record(value) && typeof value.secretRef === 'string') ||
  ['env', 'headers'].some(field => Object.values(definition[field] ?? {}).some(value => typeof value !== 'string'));

const commonFields = ['transport', 'tools', 'callTimeoutMs', 'initializeTimeoutMs'];
const transportFields = {
  stdio: ['command', 'sha256', 'cwd', 'args', 'files', 'env'],
  http: ['url', 'oauth', 'allowLoopbackHttp', 'headers'],
  gmail: ['url', 'oauth', 'appSecret'], microsoft365: ['url', 'oauth'],
  github: ['url', 'headers'], gitlab: ['url', 'headers'], linear: ['url', 'headers'],
  'ilink-long-poll': ['accountId', 'token', 'allowedUserIds', 'baseUrl'],
  websocket: ['botId', 'secret', 'allowedUserIds'],
  'lark-long-connection': ['appId', 'appSecret', 'allowedOpenIds', 'mentionOwnerOpenId', 'mentionChatIds', 'mentionVoice'],
};
function validatePortableFields(definition) {
  // The shared cross-platform validator historically accepts some irrelevant
  // globally known keys. They must not become a plaintext storage side door
  // when portable credentials are enabled. Bot schemas already enumerate their
  // transport-specific fields and require secretRef values for credentials.
  if (botChannelId(definition.transport)) return;
  const fields = transportFields[definition.transport];
  if (!fields) throw fail('MCP_TRANSPORT_UNSUPPORTED');
  const allowed = new Set([...commonFields, ...fields]);
  if (Object.keys(definition).some(key => !allowed.has(key))) throw fail('MCP_CONFIG');
  if (definition.transport === 'stdio' && definition.files !== undefined && (!Array.isArray(definition.files) || definition.files.some(pin => !record(pin) || Object.keys(pin).some(key => !['path', 'sha256'].includes(key))))) throw fail('MCP_CONFIG');
}

export async function validatePortableDefinition(id, definition, { verifyFiles = true, credentials = false } = {}) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(id) || !record(definition)) throw fail('MCP_CONFIG');
  if (definition.transport === 'builtin') {
    if (id !== 'point.table' || JSON.stringify(Object.keys(definition).sort()) !== '["tools","transport"]' || JSON.stringify(definition.tools) !== '["table_summary"]') throw fail('MCP_CONFIG');
  } else {
    if (!credentials && !['stdio', 'http'].includes(definition.transport)) throw fail('MCP_TRANSPORT_UNSUPPORTED');
    if (!credentials && (['oauth', 'token', 'secret', 'appSecret', 'accountId', 'botId', 'appId', 'allowedOpenIds', 'allowedUserIds', 'baseUrl'].some(field => definition[field] !== undefined) || ['env', 'headers'].some(field => Object.values(definition[field] ?? {}).some(value => typeof value !== 'string')))) throw fail('MCP_CREDENTIAL_STORE_UNAVAILABLE');
    if (credentials) validatePortableFields(definition);
    await validateConnector(definition, { verifyFiles });
  }
}

/** The settings entry point must call this before diagnostics or approval, and
 * the persistence authority repeats it. Valid credential fields are references;
 * any literal binding or irrelevant credential-shaped key is rejected. */
export async function validatePortableManagedDefinition(id, definition, { credentials = false, verifyFiles = true } = {}) {
  if (!record(definition)) throw fail('MCP_CONFIG');
  const value = structuredClone(definition);
  if (['env', 'headers'].some(field => Object.entries(value[field] ?? {}).some(([key, binding]) =>
    !credentials || typeof binding === 'string' && /authorization|api[-_]?key|token|secret|password|credential/i.test(key) && !key.endsWith('_SECRET_REF')))) throw fail('MCP_CREDENTIAL_STORE_UNAVAILABLE');
  await validatePortableDefinition(id, value, { credentials, verifyFiles });
  return value;
}

/** Operator-owned configuration with no managed credentials. This is not an Agent mutation API.
 * Changes retire a live connection; an uncertain call is never replayed. */
export async function readPortableRegistry(path, { revision, metadataOnly = false, credentials = false, credentialMetadata = false, connectorId } = {}) {
  if (!isAbsolute(path) || await realpath(path) !== path) throw fail('MCP_CONFIG');
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  let bytes;
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > PORTABLE_REGISTRY_LIMIT || stat.mode & 0o022 || process.getuid && stat.uid !== process.getuid()) throw fail('MCP_REGISTRY_UNTRUSTED');
    bytes = Buffer.alloc(PORTABLE_REGISTRY_LIMIT + 1);
    let size = 0;
    while (size < bytes.length) {
      const { bytesRead } = await file.read(bytes, size, bytes.length - size, size);
      if (!bytesRead) break;
      size += bytesRead;
    }
    bytes = bytes.subarray(0, size);
    if (bytes.length > PORTABLE_REGISTRY_LIMIT) throw fail('MCP_REQUEST_LIMIT');
  } finally { await file.close(); }
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (revision && revision !== digest) throw fail('MCP_CONFIG_CHANGED');
  if (revision) return { revision: digest };
  let registry;
  try { registry = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { throw fail('MCP_CONFIG'); }
  if (!record(registry)) throw fail('MCP_CONFIG');
  const managed = registry.format === PORTABLE_CATALOG_FORMAT;
  if (managed && (Object.keys(registry).some(key => !['format', 'entries'].includes(key)) || !record(registry.entries))) throw fail('MCP_CONFIG');
  const definitions = managed ? registry.entries : registry;
  if (Object.keys(definitions).length > 128) throw fail('MCP_CONFIG');
  const connectors = Object.create(null);
  const entries = Object.create(null);
  for (const [id, value] of Object.entries(definitions)) {
    if (managed && (!record(value) || Object.keys(value).some(key => !['definition', 'enabled', 'generation'].includes(key)) || typeof value.enabled !== 'boolean' || value.generation !== 'static' && !/^[a-f0-9-]{36}$/.test(value.generation ?? ''))) throw fail('MCP_CONFIG');
    const definition = managed ? value.definition : value;
    const entry = managed ? value : { definition, enabled: true, generation: 'static' };
    const selected = connectorId === undefined || connectorId === id;
    await validatePortableDefinition(id, definition, { verifyFiles: !metadataOnly && entry.enabled && selected, credentials: credentials || !selected || metadataOnly && credentialMetadata });
    entries[id] = entry;
    if (entry.enabled && selected && (credentials || !requiresPortableCredentials(definition))) connectors[id] = definition;
  }
  return freeze({ revision: digest, connectors, entries, managed });
}

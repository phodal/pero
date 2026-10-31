import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath, rename, rmdir, unlink } from 'node:fs/promises';
import { dirname, isAbsolute } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { PORTABLE_CATALOG_FORMAT, PORTABLE_REGISTRY_LIMIT, readPortableRegistry } from './portable-registry.mjs';

export const fail = code => Object.assign(new Error(code), { code });
export const validId = id => typeof id === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(id);
export const entryRevision = entry => createHash('sha256').update(JSON.stringify(entry)).digest('hex');
export const credentialAccount = (id, entry) => 'oauth:' + createHash('sha256').update(JSON.stringify([id, entryRevision(entry)])).digest('hex');
export function secretReferences(definition) {
  const values = [...Object.values(definition), ...Object.values(definition.env ?? {}), ...Object.values(definition.headers ?? {})];
  return [...new Set(values.filter(value => value && typeof value === 'object' && validId(value.secretRef)).map(value => value.secretRef))];
}
export async function trustedDirectory(registry) {
  const directory = dirname(registry);
  if (!isAbsolute(registry) || await realpath(directory) !== directory) throw fail('MCP_STORE_PERMISSIONS');
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.mode & 0o077 || process.getuid && stat.uid !== process.getuid()) throw fail('MCP_STORE_PERMISSIONS');
}
// Abandoned locks intentionally fail closed. Never recover based on age or PID.
export async function acquirePortableLock(registry, suffix = '.lock', { waitMs = 0 } = {}) {
  if (!Number.isSafeInteger(waitMs) || waitMs < 0 || waitMs > 3000) throw fail('MCP_ARGUMENT');
  const path = registry + suffix;
  const deadline = performance.now() + waitMs;
  for (;;) {
    await trustedDirectory(registry);
    try { await mkdir(path, { mode: 0o700 }); break; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const remaining = deadline - performance.now();
      if (remaining <= 0) throw fail('MCP_CONTROL_BUSY');
      // Wait only for a cooperating owner to release its lock. Do not remove,
      // reclaim or infer ownership of an abandoned lock from its PID or age.
      await new Promise(resolve => setTimeout(resolve, Math.min(25, remaining)));
    }
  }
  let closed = false;
  return async () => { if (!closed) { await rmdir(path); closed = true; } };
}
export async function withPortableCatalogLock(registry, operation, options) {
  const release = await acquirePortableLock(registry, '.lock', options);
  try { return await operation(); }
  finally { try { await release(); } catch { throw fail('MCP_CONTROL_RELEASE_UNCERTAIN'); } }
}
export async function writePortableCatalog(registry, snapshot, entries) {
  let temporary, applied = false;
  try {
    // Unchanged legacy entries keep their original generation/credential slot
    // when the raw map first becomes a managed catalog. Actual mutations assign
    // a new UUID at the control boundary. The changed whole-file revision still
    // fences every already-open session, including an untouched static entry.
    if (Object.keys(entries).length > 128) throw fail('MCP_CONFIG');
    const bytes = JSON.stringify({ format: PORTABLE_CATALOG_FORMAT, entries }) + '\n';
    if (Buffer.byteLength(bytes) > PORTABLE_REGISTRY_LIMIT) throw fail('MCP_REQUEST_LIMIT');
    temporary = registry + '.' + randomUUID() + '.tmp';
    const file = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
    await readPortableRegistry(registry, { revision: snapshot.revision });
    await rename(temporary, registry); temporary = undefined; applied = true;
    const parent = await open(dirname(registry), constants.O_RDONLY | constants.O_DIRECTORY);
    try { await parent.sync(); } finally { await parent.close(); }
  } catch (error) {
    if (applied) throw fail('MCP_CONTROL_APPLIED_DURABILITY_UNKNOWN');
    throw error;
  } finally { if (temporary) await unlink(temporary).catch(() => {}); }
}

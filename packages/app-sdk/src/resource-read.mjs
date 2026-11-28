export const PAPER_EVIDENCE = 'pero-paper-evidence-v1';
export const PAPER_DIGEST = '34ad712113ddbb4f4c4dc5f46380924a5ff69f53e0e5bc1b63e03c5bb6d44f90';
export const DOMAIN_PROVENANCE = 'domain:paper';

const forbidden = ['path', 'url', 'token', 'backend', 'workerToken', 'operatorToken', 'absolutePath'];

function fail(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function containsForbidden(value) {
  return Boolean(value) && typeof value === 'object' && forbidden.some(key => Object.prototype.hasOwnProperty.call(value, key));
}

function bytes(value) {
  if (typeof value !== 'string') return value instanceof Uint8Array ? value : new Uint8Array(value ?? []);
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

async function sha256(body) {
  const digest = await crypto.subtle.digest('SHA-256', body);
  return [...new Uint8Array(digest)].map(part => part.toString(16).padStart(2, '0')).join('');
}

/**
 * Read one Paper revision through the caller's transport.
 * A response from any other owner, or one that carries a path or credential, is refused.
 * This function has no second transport and does not upload the object.
 */
export async function readPaperResource(transport, request) {
  const resource = request?.resource;
  if (!transport || typeof transport.read !== 'function' || !resource) throw fail('missing');
  if (containsForbidden(request) || containsForbidden(resource)) throw fail('spoofed');
  if (resource.class !== 'immutable' || resource.app !== 'paper-agent' || resource.kind !== 'paper') throw fail('unsupported');
  let value;
  try {
    value = await transport.read(request);
  } catch (error) {
    if (error && typeof error === 'object' && error.code) throw error;
    throw fail('owner_unavailable');
  }
  if (!value || value.ownerHost !== resource.ownerHost) throw fail('owner_unavailable');
  if (value.digest !== resource.revision || value.provenance !== DOMAIN_PROVENANCE) throw fail('stale');
  if (containsForbidden(value)) throw fail('spoofed');
  const body = bytes(value.body);
  if (await sha256(body) !== value.digest) throw fail('stale');
  return { ownerHost: value.ownerHost, revision: value.revision, digest: value.digest, mediaType: value.mediaType, body, provenance: value.provenance };
}

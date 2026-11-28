import inventory from '../../../protocol/inventory/capabilities.json' with { type: 'json' };

// One inventory owns the route table. Electron and Native each apply these
// rules; neither shell invents a second family map. The JSON import is inlined
// by the desktop bundle, so the packaged shell does not read the repo at runtime.
const families = new Map(inventory.families.map(family => [family.id, family]));
const operationsByRoute = new Map();
for (const family of inventory.families) {
  for (const operation of family.operations) {
    const names = operationsByRoute.get(operation.route) ?? new Set();
    names.add(operation.name);
    operationsByRoute.set(operation.route, names);
  }
}

function reject(code, capability, operation) {
  const error = { code, message: 'Host capability unavailable' };
  if (typeof capability === 'string') error.capability = capability;
  if (typeof operation === 'string') error.operation = operation;
  return { ok: false, error };
}

function envelopeCarrier(operation) {
  return typeof operation.carrier === 'string' && operation.carrier.includes('envelope');
}

/** Route a legacy {capability, operation, input} envelope. A route is not a grant. */
export function dispatchEnvelope(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return reject('invalid_input');
  const capability = value.capability;
  const operation = value.operation;
  const input = value.input;
  const capabilityName = typeof capability === 'string' ? capability : undefined;
  const operationName = typeof operation === 'string' ? operation : undefined;
  const family = typeof capability === 'string' ? families.get(capability) : undefined;
  if (!family) return reject('unknown_operation', capabilityName, operationName);
  if (typeof operation !== 'string' || operation.length === 0 || !input || typeof input !== 'object' || Array.isArray(input)) {
    return reject('invalid_input', capabilityName, operationName);
  }
  if (family.id === 'automation') {
    if (Object.hasOwn(input, 'operation')) return reject('invalid_input', capability, operation);
    return { ok: true, route: family.route, body: { ...input }, owner: family.owner, injectOperation: false };
  }
  if (family.operations.length === 0) {
    return { ok: true, route: family.route, body: { ...input, operation }, owner: family.owner, injectOperation: true };
  }
  const matches = family.operations.filter(item => item.name === operation);
  if (matches.length === 0) return reject('unknown_operation', capability, operation);
  const selected = family.id === 'agent' ? matches.find(envelopeCarrier) : matches[0];
  if (!selected) return reject('unknown_operation', capability, operation);
  return { ok: true, route: selected.route, body: { ...input, operation }, owner: selected.owner, injectOperation: true };
}

/**
 * Direct family routes use the same operation names as the envelope.
 * Insights stays unnamed. Automation keeps method/path/body and rejects an injected operation.
 * Deferred routes are not passed here.
 */
export function directOperation(path, body) {
  if (path === '/host/insights') return { ok: true };
  if (path === '/host/automation') {
    if (body && typeof body === 'object' && !Array.isArray(body) && Object.hasOwn(body, 'operation')) {
      return reject('invalid_input', 'automation', typeof body.operation === 'string' ? body.operation : undefined);
    }
    return { ok: true };
  }
  const allowed = operationsByRoute.get(path);
  if (!allowed) return { ok: true };
  if (!body || typeof body !== 'object' || Array.isArray(body)) return reject('invalid_input');
  const operation = body.operation;
  if (typeof operation !== 'string' || !allowed.has(operation)) return reject('unknown_operation', undefined, typeof operation === 'string' ? operation : undefined);
  return { ok: true };
}

export function capabilityErrorBody(error) {
  return {
    code: error.code,
    message: error.message,
    ...(error.capability ? { capability: error.capability } : {}),
    ...(error.operation ? { operation: error.operation } : {}),
  };
}

export function capabilityErrorResponse(error) {
  return Response.json(capabilityErrorBody(error), { status: 403, headers: { 'Cache-Control': 'no-store' } });
}

import { METHOD_IDS, readInspection } from './model.mjs';

/** This operation observes existing software; it cannot install, launch or approve. */
export async function inspectEnvironment(target, { signal, fetchFn = globalThis.fetch } = {}) {
  if (!METHOD_IDS.includes(target)) throw new Error('Unknown scientific method');
  const response = await fetchFn('/host/environment', {
    method: 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target }), signal,
  });
  if (!response.ok) {
    const detail = (await response.text()).trim().slice(0, 600);
    if (response.status === 404 || response.status === 405) throw new Error('Environment inspection is unavailable in this Host. Update Pero and retry.');
    throw new Error(detail || `Environment inspection failed (${response.status})`);
  }
  const raw = await response.text();
  if (raw.length > 131072) throw new Error('Environment observation is too large');
  let value;
  try { value = JSON.parse(raw); } catch { throw new Error('The Host did not return an environment observation'); }
  return readInspection(value, target);
}

/** A view-local request owner. Closing a view never pretends to stop a Host process. */
export function createInspectionSession({ inspect = inspectEnvironment, changed = () => {} } = {}) {
  const records = Object.create(null), requests = new Map();
  let disposed = false;
  async function check(target) {
    if (disposed) return;
    if (!METHOD_IDS.includes(target)) throw new Error('Unknown scientific method');
    if (requests.has(target)) return requests.get(target).promise;
    const controller = new AbortController();
    const request = { controller, promise: null };
    requests.set(target, request);
    records[target] = { state: 'loading' };
    changed(records);
    request.promise = Promise.resolve().then(() => inspect(target, { signal: controller.signal })).then(report => {
      if (!disposed && requests.get(target) === request) records[target] = { state: 'observed', report };
    }).catch(error => {
      if (!disposed && requests.get(target) === request) records[target] = { state: 'error', error: error instanceof Error ? error.message : String(error) };
    }).finally(() => {
      if (requests.get(target) === request) requests.delete(target);
      if (!disposed) changed(records);
    });
    return request.promise;
  }
  return {
    records, check,
    dispose() { disposed = true; for (const request of requests.values()) request.controller.abort(); requests.clear(); },
  };
}

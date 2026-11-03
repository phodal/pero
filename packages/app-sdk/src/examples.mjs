/** Per-panel example bridge. The host owns selection; the App owns import. */
export function createAppExamples({ entries = [], read, requestId = () => crypto.randomUUID() } = {}) {
  let adapter, active = false, disposed = false, attempted = false, pending, failed;
  let state = Object.freeze({ ready: false, busy: false, error: '', selected: null });
  const listeners = new Set();
  const cache = new Map(); let observing;
  const observe = () => {
    const id = adapter?.currentExampleId;
    if (observing && observing.id !== id) { observing.abort.abort(); observing = null; }
    if (state.selected?.id === id || (observing && observing.id === id)) return;
    observing?.abort.abort(); observing = null;
    emit({ selected: cache.get(id) || null });
    const entry = entries.find(e => e.id === id);
    if (!entry || cache.has(id)) return;
    const token = { id, abort: new AbortController() }; observing = token;
    void read(entry, token.abort.signal).then(document => {
      if (!disposed && observing === token && adapter?.currentExampleId === id) { cache.set(id, document); emit({ selected: document }); }
    }).catch(() => { /* Explicit loading reports read errors; observation is read-only. */ });
  };
  const emit = patch => { state = Object.freeze({ ...state, ...patch }); for (const fn of listeners) fn(); };
  const available = () => !disposed && active && adapter?.ready && !adapter.busy;
  const reconcile = () => {
    if (disposed) return;
    emit({ ready: !!available() });
    if (active && adapter?.ready && !pending) observe();
    if (!attempted && available() && adapter.empty && !pending) {
      const entry = entries.find(e => e.default);
      if (entry) { attempted = true; void load(entry.id, false, true); }
    }
  };
  async function load(id, retry = false, onlyEmpty = false) {
    if (!available() || pending) return;
    const entry = entries.find(e => e.id === id);
    if (!entry) throw new Error('Unknown example');
    attempted = true;
    const token = { id, requestId: retry && failed?.id === id ? failed.requestId : requestId(), abort: new AbortController() };
    pending = token; failed = null; emit({ busy: true, error: '' });
    try {
      const document = await read(entry, token.abort.signal);
      if (pending !== token || token.abort.signal.aborted) return;
      cache.set(id, document);
      // Recheck after reading: an ordinary import/run may have started meanwhile.
      if (!available()) throw new Error('App is busy');
      if (onlyEmpty && !adapter.empty) return;
      await adapter.load(document, { requestId: token.requestId, signal: token.abort.signal });
      if (pending === token && !token.abort.signal.aborted) emit({ selected: document });
    } catch (error) {
      if (pending === token && !token.abort.signal.aborted) { failed = token; emit({ error: error?.message || String(error) }); }
    } finally {
      if (pending === token) { pending = null; emit({ busy: false }); }
    }
  }
  return Object.freeze({
    getSnapshot: () => state,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    register(value) {
      if (disposed || adapter) throw new Error('Only one example adapter is allowed per panel');
      adapter = value; reconcile();
      return { update(next) { if (adapter === value) { adapter = next; value = next; reconcile(); } }, dispose() { if (adapter === value) { adapter = null; pending?.abort.abort(); emit({ ready: false }); } } };
    },
    setActive(value) { active = value; if (!value) pending?.abort.abort(); reconcile(); },
    load,
    retry() { if (failed) return load(failed.id, true); },
    dispose() { disposed = true; pending?.abort.abort(); observing?.abort.abort(); pending = null; adapter = null; listeners.clear(); },
  });
}

export async function readAppExample(response, entry, cryptoProvider = globalThis.crypto) {
  if (!response.ok) throw new Error(`Example: HTTP ${response.status}`);
  const reader = response.body.getReader(); let size = 0; const chunks = [];
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 4 * 1024 * 1024) throw new Error('Example exceeds 4 MiB'); chunks.push(value); }
  } finally { await reader.cancel(); reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const hash = async value => [...new Uint8Array(await cryptoProvider.subtle.digest('SHA-256', value))].map(b => b.toString(16).padStart(2, '0')).join('');
  if (await hash(bytes) !== entry.sha256) throw new Error('Example digest differs');
  const document = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (document.schema !== 'pero.app.example.v1' || document.id !== entry.id || !Array.isArray(document.files) || !document.files.length || document.files.length > 16) throw new Error('Invalid example document');
  const object = value => value && typeof value === 'object' && !Array.isArray(value);
  if (document.parameters !== undefined && !object(document.parameters)) throw new Error('Invalid example parameters');
  if (document.source !== undefined) {
    if (!object(document.source)) throw new Error('Invalid example source');
    for (const key of ['source','sourceUrl','license','licenseUrl','citation','retrievedAt']) if (document.source[key] !== undefined && typeof document.source[key] !== 'string') throw new Error('Invalid example source');
    for (const key of ['title','description','transformations','notes']) if (document.source[key] !== undefined && (!object(document.source[key]) || Object.values(document.source[key]).some(v => typeof v !== 'string'))) throw new Error('Invalid example source');
  }
  const names = new Set();
  for (const file of document.files) {
    if (!object(file) || typeof file.name !== 'string' || !file.name || /[\\/:]/.test(file.name) || file.name === '.' || file.name === '..' || names.has(file.name) || typeof file.content !== 'string' || !file.content || typeof file.mediaType !== 'string' || !file.mediaType || await hash(new TextEncoder().encode(file.content)) !== file.sha256) throw new Error('Invalid example file');
    names.add(file.name);
  }
  return document;
}

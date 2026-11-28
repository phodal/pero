// Typed capability client. A snapshot is a hint. It is not a grant, and a
// negative outcome is decided before any transport call.

const READY = 'ready';
// Same bound as requestAppShell. This does not change that timeout.
const FRAME_REPLY_MS = 125000;
const SETTLED_IDS = 64;

export function createCapabilitySnapshot({
  protocolVersion = 1,
  providerGeneration,
  availability = 'advertised',
  authorization = 'declared',
  operations,
}) {
  if (typeof providerGeneration !== 'string' || providerGeneration.length === 0) {
    throw new TypeError('providerGeneration is required');
  }
  return Object.freeze({
    protocolVersion,
    providerGeneration,
    availability,
    authorization,
    operations: Object.freeze({ ...operations }),
  });
}

export function capabilityOutcome(snapshot, capability, operation) {
  if (!snapshot || snapshot.protocolVersion !== 1) return 'incompatible';
  if (snapshot.availability !== 'advertised') return 'offline';
  if (snapshot.authorization === 'denied') return 'denied';
  if (snapshot.authorization === 'consent') return 'requires-consent';
  if (snapshot.operations[`${capability}/${operation}`]?.version !== 1) return 'unsupported';
  return READY;
}

function failed(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

export function createCorrelation() {
  const waiters = new Map();
  const settled = [];
  function remember(id) {
    settled.push(id);
    if (settled.length > SETTLED_IDS) settled.shift();
  }
  return {
    request(id, send, options = {}) {
      if (waiters.has(id) || settled.includes(id)) throw failed('duplicate');
      return new Promise((resolve, reject) => {
        const waiter = { resolve, reject, done: false, generation: options.generation, timer: null };
        const close = () => {
          if (waiter.done) return false;
          waiter.done = true;
          if (waiter.timer) clearTimeout(waiter.timer);
          waiters.delete(id);
          return true;
        };
        waiters.set(id, waiter);
        if (typeof options.timeoutMs === 'number') {
          waiter.timer = setTimeout(() => {
            if (!close()) return;
            remember(id);
            reject(failed('timeout'));
          }, options.timeoutMs);
        }
        try {
          send();
        } catch (error) {
          if (close()) reject(error);
        }
      });
    },
    receive(message) {
      if (!message || typeof message !== 'object' || typeof message.id !== 'string') return 'late';
      if (settled.includes(message.id)) return 'duplicate';
      const waiter = waiters.get(message.id);
      if (!waiter) return 'late';
      waiter.done = true;
      if (waiter.timer) clearTimeout(waiter.timer);
      waiters.delete(message.id);
      remember(message.id);
      if (message.ok === true) waiter.resolve(message.value);
      else if (message.ok === false) waiter.reject(failed(message.code || 'failed'));
      else waiter.reject(failed('malformed'));
      return 'accepted';
    },
    revoke(generation) {
      for (const [id, waiter] of [...waiters]) {
        if (waiter.generation !== generation || waiter.done) continue;
        waiter.done = true;
        if (waiter.timer) clearTimeout(waiter.timer);
        waiters.delete(id);
        remember(id);
        waiter.reject(failed('revoked'));
      }
    },
    dispose() {
      for (const [id, waiter] of [...waiters]) {
        if (waiter.done) continue;
        waiter.done = true;
        if (waiter.timer) clearTimeout(waiter.timer);
        waiters.delete(id);
        remember(id);
        waiter.reject(failed('disposed'));
      }
    },
    pending() { return waiters.size; },
  };
}

export function createFrameTransport({
  postMessage,
  targetOrigin,
  source,
  addEventListener,
  removeEventListener,
  timeoutMs = FRAME_REPLY_MS,
  correlation = createCorrelation(),
}) {
  if (typeof targetOrigin !== 'string' || targetOrigin.length === 0 || targetOrigin === '*') {
    throw new TypeError('targetOrigin is required');
  }
  if (typeof addEventListener === 'function' && source == null) throw new TypeError('source is required');
  const onMessage = event => {
    if (!event || event.origin !== targetOrigin) return;
    if (source != null && event.source !== source) return;
    const data = event.data;
    if (!data || data.type !== 'pero:capability-result') return;
    correlation.receive(data);
  };
  if (typeof addEventListener === 'function') addEventListener('message', onMessage);
  let disposed = false;
  return {
    correlation,
    call(capability, operation, input, { correlationId, generation } = {}) {
      if (disposed) return Promise.reject(failed('disposed'));
      return correlation.request(correlationId, () => {
        postMessage({ type: 'pero:capability', capability, operation, input, correlationId }, targetOrigin);
      }, { timeoutMs, generation });
    },
    revoke(generation) { correlation.revoke(generation); },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (typeof removeEventListener === 'function') removeEventListener('message', onMessage);
      correlation.dispose();
    },
  };
}

/** Same-origin /host/capability. The frame's fetch carries no Desktop credential. */
export function createLocalCapabilityTransport(fetchImpl = globalThis.fetch) {
  return {
    async call(capability, operation, input) {
      const response = await fetchImpl('/host/capability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ capability, operation, input }),
      });
      if (!response.ok) throw failed(`transport-${response.status}`);
      return response.json();
    },
  };
}

export function createCapabilityClient({ transport, snapshot }) {
  let current = snapshot;
  let disposed = false;
  let sequence = 0;
  const clientId = globalThis.crypto?.randomUUID?.() ?? `client-${sequence}`;
  const subscribers = new Set();
  const inflight = new Set();
  const calls = [];
  function publish(event) {
    for (const subscriber of subscribers) subscriber(event);
  }
  function cancelGeneration(generation, code) {
    for (const token of inflight) {
      if (token.generation === generation) token.reject(failed(code));
    }
    transport.revoke?.(generation);
  }
  const client = {
    snapshot() { return current; },
    outcome(capability, operation) { return capabilityOutcome(current, capability, operation); },
    handle() {
      const generation = current.providerGeneration;
      return Object.freeze({
        generation,
        call(capability, operation, input) {
          if (disposed || current.providerGeneration !== generation) throw failed('revoked');
          return client.call(capability, operation, input);
        },
      });
    },
    async call(capability, operation, input = {}) {
      if (disposed) throw failed('disposed');
      const code = capabilityOutcome(current, capability, operation);
      if (code !== READY) throw failed(code);
      const generation = current.providerGeneration;
      const correlationId = `${clientId}:${generation}:${++sequence}`;
      calls.push({ capability, operation, correlationId });
      let rejectInflight;
      const cancelled = new Promise((_, reject) => { rejectInflight = reject; });
      const token = { generation, reject: rejectInflight };
      inflight.add(token);
      try {
        const value = await Promise.race([
          transport.call(capability, operation, input, { correlationId, generation }),
          cancelled,
        ]);
        if (disposed) throw failed('disposed');
        if (current.providerGeneration !== generation) throw failed('revoked');
        return value;
      } catch (error) {
        if (disposed) throw failed('disposed');
        if (error?.code === 'revoked' || current.providerGeneration !== generation) throw failed('revoked');
        throw error;
      } finally {
        inflight.delete(token);
      }
    },
    rebind(next) {
      if (disposed) throw failed('disposed');
      if (!next || next.providerGeneration === current.providerGeneration) return current;
      const previous = current;
      current = next;
      cancelGeneration(previous.providerGeneration, 'revoked');
      publish({ type: 'rebind', previous, next });
      return current;
    },
    subscribe(listener) {
      if (subscribers.has(listener)) throw failed('duplicate-subscription');
      subscribers.add(listener);
      return () => { subscribers.delete(listener); };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      subscribers.clear();
      for (const token of inflight) token.reject(failed('disposed'));
      transport.dispose?.();
    },
    observedCalls() { return calls.slice(); },
  };
  return Object.freeze(client);
}

// Typed capability client. A snapshot is a hint. It is not a grant, and a
// negative outcome is decided before any transport call.

const READY = 'ready';

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
  return {
    request(id, send) {
      if (waiters.has(id)) throw failed('duplicate');
      return new Promise((resolve, reject) => {
        waiters.set(id, { resolve, reject, done: false });
        send();
      });
    },
    receive(message) {
      if (!message || typeof message !== 'object' || typeof message.id !== 'string' || !waiters.has(message.id)) return 'late';
      const waiter = waiters.get(message.id);
      if (waiter.done) return 'duplicate';
      waiter.done = true;
      waiters.delete(message.id);
      if (message.ok === true) waiter.resolve(message.value);
      else if (message.ok === false) waiter.reject(failed(message.code || 'failed'));
      else waiter.reject(failed('malformed'));
      return 'accepted';
    },
    dispose() {
      for (const waiter of waiters.values()) {
        if (!waiter.done) waiter.reject(failed('disposed'));
      }
      waiters.clear();
    },
    pending() { return waiters.size; },
  };
}

export function createFrameTransport({ postMessage, targetOrigin, correlation = createCorrelation() }) {
  if (typeof targetOrigin !== 'string' || targetOrigin === '*') throw new TypeError('targetOrigin is required');
  return {
    correlation,
    call(capability, operation, input, { correlationId }) {
      return correlation.request(correlationId, () => {
        postMessage({ type: 'pero:capability', capability, operation, input, correlationId }, targetOrigin);
      });
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
  const subscribers = new Set();
  const inflight = new Set();
  const calls = [];
  function publish(event) {
    for (const subscriber of subscribers) subscriber(event);
  }
  const client = {
    snapshot() { return current; },
    outcome(capability, operation) { return capabilityOutcome(current, capability, operation); },
    handle() {
      const generation = current.providerGeneration;
      return Object.freeze({
        generation,
        call(capability, operation, input) {
          if (current.providerGeneration !== generation) throw failed('revoked');
          return client.call(capability, operation, input);
        },
      });
    },
    async call(capability, operation, input = {}) {
      if (disposed) throw failed('disposed');
      const code = capabilityOutcome(current, capability, operation);
      if (code !== READY) throw failed(code);
      const generation = current.providerGeneration;
      const correlationId = `${generation}:${++sequence}`;
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
        if (current.providerGeneration !== generation) throw failed('revoked');
        return value;
      } catch (error) {
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
      for (const token of inflight) {
        if (token.generation !== next.providerGeneration) token.reject(failed('revoked'));
      }
      publish({ type: 'rebind', previous, next });
      return current;
    },
    subscribe(listener) {
      if (subscribers.has(listener)) throw failed('duplicate-subscription');
      subscribers.add(listener);
      return () => { subscribers.delete(listener); };
    },
    dispose() {
      disposed = true;
      subscribers.clear();
    },
    observedCalls() { return calls.slice(); },
  };
  return Object.freeze(client);
}

/** Selected App read: agent status, rendered without an Electron import. */
export function renderAgentStatus(run) {
  if (!run || typeof run.status !== 'string' || typeof run.id !== 'string') throw failed('malformed');
  return `${run.status} ${run.id}`;
}

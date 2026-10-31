const fail = (code, message, cause) => Object.assign(new Error(message, cause ? { cause } : undefined), { code });
const positive = value => Number.isSafeInteger(value) && value > 0;

/** One bounded, single-flight NDJSON connection. No reconnect or request replay.
 * Platform launch and domain identities/leases are deliberately separate. */
export class NativeServiceChannel {
  #launch; #endpoint; #waiter; #buffer = Buffer.alloc(0);
  #resolveRetired; #resolveClosed;

  constructor({ launch, timeoutMs = 12000, maxRequestBytes = 32768, maxReplyBytes = 131072 }) {
    if (typeof launch !== 'function' || ![timeoutMs, maxRequestBytes, maxReplyBytes].every(positive)) throw new TypeError('Native channel requires a launcher and positive limits');
    this.#launch = launch;
    Object.assign(this, { timeoutMs, maxRequestBytes, maxReplyBytes });
    this.state = 'new';
    this.retired = new Promise(resolve => { this.#resolveRetired = resolve; });
    this.whenClosed = new Promise(resolve => { this.#resolveClosed = resolve; });
  }

  get child() { return this.#endpoint?.child; }
  get pid() { return this.#endpoint?.pid; }

  start() {
    if (this.state !== 'new') throw fail('XPC_CHANNEL_RETIRED', 'Native service channel cannot be started again');
    try {
      this.#endpoint = this.#launch();
      this.state = 'open';
      this.#endpoint.output.on('data', chunk => this.#receive(chunk));
      this.#endpoint.output.once('end', () => this.close(this.#endpoint.error
        ? fail('XPC_LAUNCH_FAILED', 'Native service launch failed', this.#endpoint.error)
        : fail('XPC_DISCONNECTED', 'Native service output ended')));
      this.#endpoint.output.on('error', error => this.close(fail('XPC_IO', 'Native service output failed', error)));
      this.#endpoint.input.on('error', error => this.close(fail('XPC_IO', 'Native service input failed', error)));
      this.#endpoint.diagnostics?.on('error', error => this.close(fail('XPC_IO', 'Native service diagnostics failed', error)));
      this.#endpoint.diagnostics?.resume();
      this.#endpoint.closed.then(exit => {
        this.close(exit.error ? fail('XPC_LAUNCH_FAILED', 'Native service launch failed', exit.error) : fail('XPC_DISCONNECTED', 'Native service XPC disconnected'));
        this.state = 'closed';
        this.#resolveClosed(exit);
      });
    } catch (error) {
      this.close(fail('XPC_LAUNCH_FAILED', 'Native service launch failed', error));
      throw this.failure;
    }
    return this;
  }

  /** Snapshot and bound a request before a queue retains it. */
  encodeRequest(action, args = []) {
    if (typeof action !== 'string' || !action || !Array.isArray(args)) throw fail('XPC_ARGUMENT', 'Expected action string and args array');
    const bytes = Buffer.from(JSON.stringify({ action, args }) + '\n');
    if (bytes.length > this.maxRequestBytes) throw fail('XPC_REQUEST_LIMIT', 'Native service request limit');
    return bytes;
  }

  request(action, args = [], options) {
    try { return this.sendRequest(this.encodeRequest(action, args), options); }
    catch (error) { return Promise.reject(error); }
  }

  sendRequest(bytes, { signal, timeoutMs = this.timeoutMs } = {}) {
    if (this.failure) return Promise.reject(this.failure);
    if (this.state !== 'open') return Promise.reject(fail('XPC_NOT_STARTED', 'Native service channel is not started'));
    if (this.#waiter) return Promise.reject(fail('XPC_BUSY', 'Native service channel already has an active request'));
    if (signal?.aborted) return Promise.reject(fail('ABORT_ERR', 'Native service request cancelled'));
    if (!Buffer.isBuffer(bytes) || bytes.length > this.maxRequestBytes || !positive(timeoutMs)) return Promise.reject(fail('XPC_ARGUMENT', 'Invalid native service request'));
    return new Promise((resolve, reject) => {
      const abort = () => this.close(fail('ABORT_ERR', 'Native service request cancelled'));
      const timer = setTimeout(() => this.close(fail('XPC_TIMEOUT', 'Native service XPC timed out')), timeoutMs);
      this.#waiter = { finish: (error, value) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        this.#waiter = undefined;
        if (error) reject(error); else resolve(value);
      } };
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) { abort(); return; }
      // One bounded write is admitted. Its deadline includes backpressure;
      // another request cannot build an unbounded pipe write queue.
      try { this.#endpoint.input.write(bytes); }
      catch (error) { this.close(fail('XPC_IO', 'Native service write failed', error)); }
    });
  }

  #receive(chunk) {
    if (this.state !== 'open') return;
    if (!this.#waiter) { this.close(fail('XPC_PROTOCOL', 'Unsolicited native service reply')); return; }
    // Check before concatenating, including incomplete frames.
    if (this.#buffer.length + chunk.length > this.maxReplyBytes) { this.close(fail('XPC_REPLY_LIMIT', 'Native service reply limit')); return; }
    this.#buffer = Buffer.concat([this.#buffer, chunk]);
    const end = this.#buffer.indexOf(10);
    if (end < 0) return;
    // Reject a second or partial trailing frame before publishing a result.
    if (end !== this.#buffer.length - 1) { this.close(fail('XPC_PROTOCOL', 'Unexpected trailing native service reply')); return; }
    let reply;
    try { reply = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(this.#buffer.subarray(0, end))); }
    catch (error) { this.close(fail('XPC_PROTOCOL', 'Invalid native service JSON reply', error)); return; }
    this.#buffer = Buffer.alloc(0);
    if (!reply || typeof reply !== 'object' || Array.isArray(reply) ||
        (reply.ok === true ? !Object.hasOwn(reply, 'value') || Object.hasOwn(reply, 'error') :
          reply.ok !== false || Object.hasOwn(reply, 'value') || typeof reply.error?.code !== 'string' || !reply.error.code ||
          (reply.error.message !== undefined && typeof reply.error.message !== 'string'))) {
      this.close(fail('XPC_PROTOCOL', 'Invalid native service reply envelope')); return;
    }
    if (reply.ok) this.#waiter.finish(null, reply.value);
    else this.#waiter.finish(Object.assign(fail(reply.error.code, reply.error.message ?? reply.error.code), { nativeReply: true }));
  }

  /** Retire immediately; process close is separate from domain worker cleanup. */
  close(error = fail('XPC_CHANNEL_CLOSED', 'Native service client closed')) {
    if (this.failure) return this.whenClosed;
    this.failure = error;
    this.state = 'closing';
    this.#buffer = Buffer.alloc(0);
    this.#resolveRetired(error);
    this.#waiter?.finish(error);
    if (this.#endpoint) this.#endpoint.terminate();
    else { this.state = 'closed'; this.#resolveClosed({ launched: false }); }
    return this.whenClosed;
  }
}

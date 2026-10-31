// Connect is a transaction, not a button. It has an identity, a deadline, an
// owner and a cleanup responsibility, and the host — not the window — holds all
// four. Closing a dialog is a UI event: it must never arrive here as a cancel,
// because the redirect listener the attempt owns outlives the window.

import { ATTEMPT_TTL_MS, ATTEMPT_POLL_INTERVAL_MS, TERMINAL_ATTEMPT_STATES } from './model.mjs';

const fail = code => Object.assign(new Error(code), { code });
const CONNECTION_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const random = () => globalThis.crypto.randomUUID();

/** Owns every in-flight authorization transaction for one settings session. */
export class ConnectWorkflow {
  #attempts = new Map(); #now; #newId; #newToken;
  constructor({ now = Date.now, newId = random, newToken = random } = {}) {
    this.#now = now; this.#newId = newId; this.#newToken = newToken;
  }

  /**
   * At most one attempt per connection may be live, so a second Connect click
   * cannot leave an orphan callback listening for a redirect nobody reads.
   * intent decides, once and for all, whether a later cancel may roll back the
   * configuration this attempt created.
   */
  begin(connectionId, { intent = 'first-connect', ttlMs = ATTEMPT_TTL_MS, pollIntervalMs = ATTEMPT_POLL_INTERVAL_MS } = {}) {
    if (!CONNECTION_ID.test(connectionId ?? '')) throw fail('MCP_CONFIG');
    if (!['first-connect', 'reauthorize'].includes(intent)) throw fail('MCP_ARGUMENT');
    const existing = this.#settle(connectionId);
    if (existing && !TERMINAL_ATTEMPT_STATES.has(existing.state)) throw fail('MCP_ATTEMPT_CONFLICT');
    const startedAtMs = this.#now();
    const attempt = {
      attemptId: this.#newId(), connectionId, intent, state: 'pending',
      startedAtMs, expiresAtMs: startedAtMs + ttlMs, pollIntervalMs,
      // A renewal inherits a connection the user already relies on, so only a
      // first connect owns the configuration it created.
      rollbackOnCancel: intent === 'first-connect', code: '',
    };
    this.#attempts.set(connectionId, { attempt, token: this.#newToken() });
    return { ...attempt };
  }

  /**
   * Merges provider-specific detail (currently only a QR payload) onto a live
   * attempt. Kept separate from awaitApproval because the detail can arrive
   * before the transaction is actually waiting on the user (the code must
   * render before "waiting-for-approval" makes sense to show).
   */
  attachDetail(connectionId, attemptId, patch) {
    return this.#transition(connectionId, attemptId, attempt => {
      if (TERMINAL_ATTEMPT_STATES.has(attempt.state)) throw fail('MCP_ATTEMPT_FINISHED');
      Object.assign(attempt, patch);
    });
  }
  /** The consent surface is open; the transaction now waits on the user. */
  awaitApproval(connectionId, attemptId) {
    return this.#transition(connectionId, attemptId, attempt => {
      if (attempt.state !== 'pending') throw fail('MCP_ATTEMPT_FINISHED');
      attempt.state = 'waiting-for-approval';
    });
  }

  observe(connectionId, attemptId) {
    const record = this.#attempts.get(connectionId);
    if (!record || record.attempt.attemptId !== attemptId) throw fail('MCP_NO_ATTEMPT');
    return { ...this.#settle(connectionId) };
  }

  active(connectionId) {
    const attempt = this.#settle(connectionId);
    return attempt && !TERMINAL_ATTEMPT_STATES.has(attempt.state) ? { ...attempt } : null;
  }

  /**
   * Cancels by identity: a stale page holds an older attemptId, which no longer
   * matches, so it cannot end the attempt the user is completing right now.
   */
  cancel(connectionId, attemptId) {
    return this.#transition(connectionId, attemptId, attempt => {
      if (TERMINAL_ATTEMPT_STATES.has(attempt.state)) throw fail('MCP_ATTEMPT_FINISHED');
      attempt.state = 'cancelled';
    });
  }

  succeed(connectionId, attemptId) {
    return this.#transition(connectionId, attemptId, attempt => {
      if (TERMINAL_ATTEMPT_STATES.has(attempt.state)) throw fail('MCP_ATTEMPT_FINISHED');
      attempt.state = 'succeeded';
    });
  }

  fail(connectionId, attemptId, code) {
    return this.#transition(connectionId, attemptId, attempt => {
      if (TERMINAL_ATTEMPT_STATES.has(attempt.state)) throw fail('MCP_ATTEMPT_FINISHED');
      attempt.state = 'failed'; attempt.code = code ?? 'MCP_ERROR';
    });
  }

  /** Drops a finished record. A live attempt is never silently discarded. */
  release(connectionId) {
    const attempt = this.#settle(connectionId);
    if (!attempt || !TERMINAL_ATTEMPT_STATES.has(attempt.state)) return false;
    this.#attempts.delete(connectionId);
    return true;
  }

  /** Cancels everything still running, for host disposal. */
  abandon() {
    for (const [connectionId, { attempt }] of this.#attempts) {
      if (!TERMINAL_ATTEMPT_STATES.has(attempt.state)) attempt.state = 'cancelled';
      this.#attempts.delete(connectionId);
    }
  }

  #settle(connectionId) {
    const record = this.#attempts.get(connectionId);
    if (!record) return null;
    if (!TERMINAL_ATTEMPT_STATES.has(record.attempt.state) && this.#now() >= record.attempt.expiresAtMs) record.attempt.state = 'expired';
    return record.attempt;
  }

  #transition(connectionId, attemptId, apply) {
    const record = this.#attempts.get(connectionId);
    if (!record || record.attempt.attemptId !== attemptId) throw fail('MCP_NO_ATTEMPT');
    this.#settle(connectionId);
    apply(record.attempt);
    return { ...record.attempt };
  }
}

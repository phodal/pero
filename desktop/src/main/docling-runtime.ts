export type DoclingRequest = { operation: 'status' | 'cancel' | 'revoke' } | { operation: 'request'; component: 'software' | 'model' };

/** App input never contains an approval decision, installation ticket or source. */
export function doclingInput(value: unknown): DoclingRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Docling request');
  const raw = value as Record<string, unknown>;
  const keys = Object.keys(raw).sort().join(',');
  if (keys === 'operation' && ['status', 'cancel', 'revoke'].includes(String(raw.operation))) return raw as DoclingRequest;
  if (keys === 'component,operation' && raw.operation === 'request' && ['software', 'model'].includes(String(raw.component))) return raw as DoclingRequest;
  throw new Error('Expected a fixed Docling component request');
}

export function doclingStatus(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Docling status');
  const raw = value as Record<string, unknown>;
  return Object.fromEntries(['state', 'software', 'model', 'component', 'profile', 'message', 'installerSupported', 'softwareApproved', 'modelApproved']
    .filter(key => typeof raw[key] === 'string' || ['component', 'profile'].includes(key) && raw[key] === null || ['installerSupported', 'softwareApproved', 'modelApproved'].includes(key) && typeof raw[key] === 'boolean')
    .map(key => [key, raw[key]]));
}

/** Private main-process ticket lifecycle; the App can request but cannot approve. */
export class DoclingSetup {
  private revocation?: AbortController;
  private pending?: { component: string; controller: AbortController; result: Promise<unknown> };
  constructor(private host: (request: object) => Promise<unknown>, private confirm?: (summary: string, signal: AbortSignal, operation?: 'install' | 'revoke') => Promise<boolean>) {}
  close() { this.pending?.controller.abort(); this.revocation?.abort(); }
  async apply(input: DoclingRequest): Promise<unknown> {
    if (input.operation === 'revoke') {
      if (this.revocation) throw new Error('A disable confirmation is already open');
      this.pending?.controller.abort();
      await this.host({ operation: 'cancel' });
      if (!this.confirm) throw new Error('Host confirmation unavailable');
      const controller = new AbortController(); this.revocation = controller;
      try {
        const allowed = await this.confirm('Disable optional Docling OCR. Downloaded files are retained. Your papers, evidence and manual values are unchanged. Enabling OCR again requires installation approval.', controller.signal, 'revoke');
        return this.host({ operation: allowed && !controller.signal.aborted ? 'revoke' : 'status' });
      } finally { if (this.revocation === controller) this.revocation = undefined; }
    }
    if (this.revocation && input.operation === 'request') throw new Error('Finish the disable confirmation first');
    if (input.operation !== 'request') {
      if (input.operation !== 'status') this.close();
      return this.host(input);
    }
    if (this.pending) {
      if (this.pending.component !== input.component) throw new Error('Finish the current component request first');
      return this.pending.result;
    }
    if (!this.confirm) throw new Error('Host installation approval unavailable. Continue manual selection.');
    const pending = { component: input.component, controller: new AbortController(), result: Promise.resolve<unknown>(undefined) };
    this.pending = pending;
    pending.result = Promise.resolve().then(async () => {
      const prepared = await this.host({ operation: 'prepare', component: input.component }) as Record<string, unknown>;
      if (prepared.state !== 'requires-approval') return prepared;
      if (typeof prepared.ticket !== 'string' || !prepared.ticket || prepared.ticket.length > 256 ||
          prepared.component !== input.component || typeof prepared.summary !== 'string' || !prepared.summary || prepared.summary.length > 16000)
        throw new Error('Invalid Host installation approval');
      const signal = pending.controller.signal;
      if (signal.aborted) return this.host({ operation: 'status' });
      let allowed = false;
      let stop = () => {};
      const cancelled = new Promise<boolean>(resolve => {
        stop = () => resolve(false); signal.addEventListener('abort', stop, { once: true });
      });
      try { allowed = await Promise.race([this.confirm!(prepared.summary, signal), cancelled]); } catch { allowed = false; }
      finally { signal.removeEventListener('abort', stop); }
      if (signal.aborted) return this.host({ operation: 'status' });
      return this.host(allowed ? { operation: 'install', ticket: prepared.ticket } : { operation: 'cancel' });
    }).finally(() => { if (this.pending === pending) this.pending = undefined; });
    return pending.result;
  }
}

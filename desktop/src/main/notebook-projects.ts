/** One explicit project choice, confirmed by the trusted shell. No generic settings access. */
export class NotebookProjectRequests {
  private pending?: { entryId: string; controller: AbortController };
  private request: (input: object) => Promise<any>;
  private confirm?: (summary: string, signal: AbortSignal) => Promise<boolean>;
  constructor(request: (input: object) => Promise<any>, confirm?: (summary: string, signal: AbortSignal) => Promise<boolean>) {
    this.request = request; this.confirm = confirm;
  }
  close() { this.pending?.controller.abort(); }
  async apply(value: unknown, signal?: AbortSignal): Promise<unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Notebook project request');
    const input = value as Record<string, unknown>;
    if (input.operation === 'list' && Object.keys(input).length === 1) return this.request(input);
    if (input.operation === 'cancel' && Object.keys(input).sort().join() === 'entryId,operation' && typeof input.entryId === 'string') {
      if (this.pending?.entryId === input.entryId) this.pending.controller.abort();
      return { state: 'cancel-requested' };
    }
    if (input.operation !== 'set' || Object.keys(input).sort().join() !== 'change,operation' || !input.change ||
        typeof input.change !== 'object' || Array.isArray(input.change)) throw new Error('Project requests do not accept private decisions or settings');
    const change = input.change as Record<string, unknown>;
    if (Object.keys(change).sort().join() !== 'entryId,expectedRevision,linked,projectId,readOnly,revision' ||
        typeof change.entryId !== 'string' || !/^[a-f0-9]{32}$/.test(change.entryId) ||
        typeof change.projectId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(change.projectId) ||
        !Number.isSafeInteger(change.revision) || Number(change.revision) < 1 || Number(change.revision) > 2_147_483_647 ||
        !(change.expectedRevision === null || typeof change.expectedRevision === 'string' && /^[1-9][0-9]{0,19}$/.test(change.expectedRevision)) ||
        typeof change.linked !== 'boolean' || change.readOnly !== false) throw new Error('Choose the current editable saved Notebook and a Host project');
    if (this.pending) throw new Error('Finish or cancel the pending project choice first');
    if (!this.confirm) throw new Error('Trusted project confirmation is unavailable');
    const frozen = structuredClone(change), controller = new AbortController();
    const cancel = () => controller.abort();
    if (signal?.aborted) controller.abort();
    else signal?.addEventListener('abort', cancel, { once: true });
    this.pending = { entryId: change.entryId, controller };
    try {
      const review = await this.request({ operation: 'review', change: frozen });
      if (typeof review.summary !== 'string' || review.summary.length > 16000) throw new Error('Invalid Host project confirmation');
      let allowed = false;
      try { if (!controller.signal.aborted) allowed = await this.confirm(review.summary, controller.signal); }
      catch { allowed = false; }
      if (!allowed || controller.signal.aborted) return { state: 'cancelled' };
      // Revalidation at the owner rejects a newer Notebook head or changed association.
      return await this.request({ operation: 'apply', change: frozen });
    } finally { signal?.removeEventListener('abort', cancel); this.pending = undefined; }
  }
}

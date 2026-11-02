// ACP-style lifecycle over a permission-checked Host carrier. The Host owns
// Sessions, credentials, tools and approvals; this client owns no model runtime.
export function createAppAgent(capability) {
  if (!capability) return null;
  const requestId = () => globalThis.crypto.randomUUID();
  return Object.freeze({
    prepare: input => capability.call('prepare', input),
    start: input => capability.call('start', { ...input, requestId: input.requestId ?? requestId() }),
    // Recover a lost start response without preparing, starting or resuming work.
    lookup: input => capability.call('lookup', input),
    status: input => capability.call('status', input),
    events: input => capability.call('events', input),
    cancel: input => capability.call('cancel', input),
    // Read-only follow of the terminal the Host lent this Run; it can neither open sessions nor send input.
    terminal: input => capability.call('terminal', input),
    retry: input => capability.call('retry', { ...input, requestId: input.requestId ?? requestId() }),
  });
}

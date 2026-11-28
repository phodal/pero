/**
 * Observe one existing Run. A closed consumer is a transport abort.
 * This client does not resend a prompt and does not choose another Host.
 */
export async function observeRun(transport, request) {
  if (!transport || typeof transport.observe !== 'function' || !request?.binding || !request?.request) {
    const error = new Error('missing');
    error.code = 'missing';
    throw error;
  }
  if (request.prompt || request.binding.path || request.fallbackHost) {
    const error = new Error('spoofed');
    error.code = 'spoofed';
    throw error;
  }
  let value;
  try {
    value = await transport.observe(request);
  } catch (error) {
    if (request.request.consumerClosed) {
      return { outcome: 'transport_abort', effect: 'none', status: request.knownStatus ?? 'running', continuation: request.binding.kind === 'acp_session' ? 'unsupported' : 'not_applicable' };
    }
    if (error && typeof error === 'object' && error.code) throw error;
    const lost = new Error('unknown');
    lost.code = 'unknown';
    throw lost;
  }
  if (!value || value.bindingId && value.bindingId !== request.binding.id) {
    const error = new Error('stale_binding');
    error.code = 'stale_binding';
    throw error;
  }
  if (value.ownerHost && value.ownerHost !== request.binding.ownerHost) {
    const error = new Error('stale_binding');
    error.code = 'stale_binding';
    throw error;
  }
  return {
    status: value.status,
    outcome: value.outcome,
    effect: value.effect,
    cursor: value.cursor,
    events: value.events ?? [],
    continuation: value.continuation,
  };
}

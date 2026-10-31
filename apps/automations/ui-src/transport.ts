/** The unchanged Point UI reads REST shapes; Pero's Host owns every operation. */
export function installAutomationTransport() {
  const hostFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    if (typeof input !== 'string' || !input.startsWith('/api/')) return hostFetch(input, init);
    const response = await hostFetch('/host/automation', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: init.signal,
      body: JSON.stringify({ method: init.method ?? 'GET', path: input, body: typeof init.body === 'string' ? JSON.parse(init.body) : null }),
    });
    if (!response.ok) return response;
    const envelope: { status: number; body: unknown } = await response.json();
    return new Response(envelope.status === 204 ? null : JSON.stringify(envelope.body), {
      status: envelope.status, headers: { 'Content-Type': 'application/json' },
    });
  };
  (globalThis as typeof globalThis & { pointGoDesktop: unknown }).pointGoDesktop = {
    async workbench(namespace: string, request: unknown) {
      if (namespace !== 'connectors') throw new Error('This App only exposes the declared Connectors capability');
      const response = await hostFetch('/host/connectors', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request),
      });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error ?? value.code ?? `Connectors HTTP ${response.status}`);
      return value;
    },
  };
}

// Injected only by the Desktop fixture. Hold delivery, never replace the actual
// authenticated backend request, response, parser work or persistence.
export function deferDocumentRefresh() {
  const original = window.fetch;
  let release, ready;
  const held = new Promise(resolve => { release = resolve; });
  const gate = window.paperRefreshGate = {
    arrived: false, delivered: false, error: '', ready: new Promise(resolve => { ready = resolve; }),
    release, restore() { window.fetch = original; release(); },
  };
  window.fetch = async (...args) => {
    const url = new URL(typeof args[0] === 'string' ? args[0] : args[0].url, window.location.href);
    if (url.pathname !== '/api/paper-document') return original.apply(window, args);
    const request = args[0] instanceof Request
      ? new Request(args[0].clone(), args[1]) : new Request(url, args[1]);
    const body = request.method === 'POST' ? await request.clone().json().catch(() => null) : null;
    if (body?.operation !== 'prepare' || body.refresh !== true) return original.apply(window, args);
    try {
      const response = await original.apply(window, args);
      if (!response.ok) throw Error(`Document refresh failed: ${response.status}: ${(await response.clone().text()).slice(0, 1000)}`);
      await response.clone().arrayBuffer();
      gate.arrived = true; ready();
      await held;
      gate.delivered = true;
      return response;
    } catch (error) { gate.error = String(error); ready(); throw error; }
  };
}

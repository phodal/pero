// Request-only macOS transport. Rust verifies the WebKit-supplied frame URL;
// neither this function nor any page message can answer the native dialog.
(() => {
  if (window.top !== window || location.origin !== 'pero-app://paper-agent') return;
  const pending = new Map();
  const post = window.ipc.postMessage.bind(window.ipc);
  const requestId = () => Array.from(crypto.getRandomValues(new Uint32Array(4)), value => value.toString(16).padStart(8, '0')).join('');
  addEventListener('message', event => {
    const message = event.data;
    if (event.source !== window || message?.type !== 'pero:docling:result') return;
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    request.resolve(new Response(message.body, {
      status: message.status,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    }));
  });
  Object.defineProperty(window, '__peroNativeDoclingRequest', {
    value: body => new Promise((resolve, reject) => {
      if (typeof body !== 'string') { reject(new TypeError('Expected a JSON request')); return; }
      const id = requestId();
      pending.set(id, { resolve, reject });
      try { post(JSON.stringify({ type: 'pero:docling:request', id, body })); }
      catch (error) { pending.delete(id); reject(error); }
    }),
  });
  addEventListener('pagehide', () => {
    if (!pending.size) return;
    for (const request of pending.values()) request.reject(new Error('Paper document closed'));
    pending.clear();
    post(JSON.stringify({ type: 'pero:docling:request', id: requestId(), body: '{"operation":"cancel"}' }));
  });
})();

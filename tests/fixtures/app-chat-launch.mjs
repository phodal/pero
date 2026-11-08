// Serialized by Playwright into the actual App frame. Match the App SDK launch
// protocol and its 125-second RPC deadline; this is not a composer-render wait.
export function requestAppChat(_element, { text, parentOrigin }) {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const receive = event => {
      if (event.source !== window.parent || event.origin !== parentOrigin ||
          event.data?.type !== 'pero:app:chat-result' || event.data.id !== id) return;
      clearTimeout(timer);
      window.removeEventListener('message', receive);
      if (event.data.ok === true) resolve(event.data.value);
      else reject(new Error(event.data.error || 'App chat request failed'));
    };
    const timer = setTimeout(() => {
      window.removeEventListener('message', receive);
      reject(new Error('App chat request timed out'));
    }, 125000);
    window.addEventListener('message', receive);
    window.parent.postMessage({ type: 'pero:app:chat', id, text }, parentOrigin);
  });
}

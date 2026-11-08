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

// Observe the real SDK handoff without replacing postMessage or Host commands.
export function observeAppChatLaunch(options, frameOptions) {
  const { parent, origin } = frameOptions ?? options;
  const state = { request: null, results: {} };
  const receive = event => {
    if (event.origin !== origin) return;
    if (parent) {
      if (![...document.querySelectorAll('iframe')].some(frame => {
        if (frame.contentWindow !== event.source) return false;
        const url = new URL(frame.src);
        return `${url.protocol}//${url.host}` === origin;
      })) return;
      if (event.data?.type === 'pero:app:chat' && typeof event.data.id === 'string') state.request = event.data.id;
    } else if (event.source === window.parent && event.data?.type === 'pero:app:chat-result' && typeof event.data.id === 'string') {
      state.results[event.data.id] = event.data;
    }
  };
  window.addEventListener('message', receive);
  window.appChatLaunch = { ...state, results: state.results, getRequest: () => state.request,
    dispose: () => window.removeEventListener('message', receive) };
}

/** Explicit navigation only: no file transfer, import, search or Agent execution. */
export function openPaperApp(): Promise<void> {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const receive = (event: MessageEvent) => {
      if (event.source !== window.parent || event.data?.type !== 'pero:app:navigate-result' || event.data.id !== id) return;
      clearTimeout(timer); window.removeEventListener('message', receive);
      event.data.ok ? resolve() : reject(new Error(event.data.error || 'Paper App is unavailable'));
    };
    const timer = setTimeout(() => { window.removeEventListener('message', receive); reject(new Error('Paper navigation was not acknowledged')); }, 10000);
    window.addEventListener('message', receive);
    window.parent.postMessage({ type: 'pero:app:navigate', id, target: 'paper-agent' }, '*');
  });
}

import { ipcRenderer } from 'electron';

// Runs only in the packaged isolated preload world. No bridge is exposed to page/App scripts.
window.addEventListener('DOMContentLoaded', () => {
  let nonce: string | undefined, answered = false;
  const cancel = document.getElementById('cancel') as HTMLButtonElement;
  const allow = document.getElementById('allow') as HTMLButtonElement;
  const summary = document.getElementById('summary')!;
  const decide = (event: Event, value: boolean) => {
    if (!event.isTrusted || !nonce || answered) return;
    answered = true;
    cancel.disabled = true; allow.disabled = true;
    ipcRenderer.send('pero:reproduction-approval', { kind: 'decision', nonce, allow: value });
  };
  ipcRenderer.once('pero:reproduction-approval-config', (_event, value: { nonce: string; summary: string }) => {
    if (typeof value?.nonce !== 'string' || typeof value?.summary !== 'string') return;
    nonce = value.nonce;
    summary.textContent = value.summary;
    cancel.disabled = false; allow.disabled = false;
    cancel.focus();
  });
  cancel.addEventListener('click', event => decide(event, false));
  allow.addEventListener('click', event => decide(event, true));
  ipcRenderer.send('pero:reproduction-approval', { kind: 'ready' });
});

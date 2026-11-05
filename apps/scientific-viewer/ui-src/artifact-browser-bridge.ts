import type { ArtifactTarget } from '../../../protocol/artifact-browser';

/** This browser surface carries the displayed version explicitly; it never submits a turn. */
export function composeBrowserArtifact(target: ArtifactTarget, text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const receive = (event: MessageEvent) => {
      if (event.source !== window.parent || event.data?.type !== 'pero:app:chat-result' || event.data.id !== id) return;
      clearTimeout(timer); window.removeEventListener('message', receive);
      if (event.data.ok === true) resolve(); else reject(new Error(event.data.error || 'The artifact could not be added to the conversation'));
    };
    const timer = setTimeout(() => { window.removeEventListener('message', receive); reject(new Error('The conversation did not answer. Retry adding the selection.')); }, 125000);
    window.addEventListener('message', receive);
    window.parent.postMessage({ type: 'pero:artifact:compose', id, target, text }, '*');
  });
}

export function selectBrowserArtifact(target: ArtifactTarget): void {
  window.parent.postMessage({ type: 'pero:artifact:select', target }, '*');
}

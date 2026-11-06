import type { HostCallFn, AppHost, ChatLaunchOptions } from './host';
import type { AppChatLaunch } from './app-chat';

/** Correlated requests to the owning Workbench; the frame carries no credentials. */
export function requestAppShell<T>(operation: string, input: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const receive = (event: MessageEvent) => {
      if (event.source !== window.parent || event.data?.type !== 'pero:app:sdk-result' || event.data.id !== id) return;
      clearTimeout(timer); window.removeEventListener('message', receive);
      if (event.data.ok) resolve(event.data.value); else reject(new Error(event.data.error || 'App Host request failed'));
    };
    const timer = setTimeout(() => { window.removeEventListener('message', receive); reject(new Error('App Host request timed out')); }, 125000);
    window.addEventListener('message', receive);
    window.parent.postMessage({ type: 'pero:app:sdk', id, operation, input }, '*');
  });
}
export const subscribeAppEvent: AppHost['subscribe'] = (name, callback) => {
  const receive = (event: MessageEvent) => {
    if (event.source === window.parent && event.data?.type === 'pero:app:event' && event.data.event === name) callback(event.data.value);
  };
  window.addEventListener('message', receive);
  return () => window.removeEventListener('message', receive);
};
export const navigateApp: AppHost['navigate'] = path => requestAppShell<void>('navigate', { path });
/** Opens an existing session through the owning Host; never submits a prompt. */
export const openAppSession = (sessionId: string): Promise<void> => requestAppShell<void>('open-session', { sessionId });
export const notifyApp: AppHost['notify'] = (message, options) => { void requestAppShell('notify', { message, ...options }); };
export const setAppBadge: AppHost['setBadge'] = count => { void requestAppShell('badge', { count }); };
export const callAppHost: HostCallFn = async (capability, operation, input) => {
  const response = await fetch('/host/capability', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ capability, operation, input }) });
  if (!response.ok) throw new Error((await response.text()).slice(0, 1000) || `Host request failed (${response.status})`);
  return response.json();
};
export function launchAppChat(options: AppChatLaunch | ChatLaunchOptions = {}): Promise<{ threadId?: string; references?: string[] }> {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const receive = (event: MessageEvent) => {
      if (event.source !== window.parent || event.data?.type !== 'pero:app:chat-result' || event.data.id !== id) return;
      clearTimeout(timer); window.removeEventListener('message', receive);
      if (event.data.ok) resolve(event.data.value || {}); else reject(new Error(event.data.error || 'App chat request failed'));
    };
    const timer = setTimeout(() => { window.removeEventListener('message', receive); reject(new Error('App chat request timed out')); }, 125000);
    window.addEventListener('message', receive);
    window.parent.postMessage({ type: 'pero:app:chat', id, options }, '*');
  });
}

import init, { run, receive_host_event, snapshot } from './wasm/pero_ui';
import themes from './theme.generated.json';
import './shell.css';
import { normalizeLocale, translate } from '../../locales';
import { mountAppSurfaces, type AppSurface } from './apps';

export interface HostEvent { version: number; kind: string; request_id: string | null; text: string; message_key?: string; thread_id?: string; data?: unknown }
declare global {
  interface Window {
    pero?: { connect(): Promise<HostEvent>; getLocale(): Promise<string>; setLocale(locale: string): Promise<void>; sendProbe(request: { id: string; text: string }): Promise<void>; onEvent(callback: (event: HostEvent) => void): () => void; sessionCommand(command: object): Promise<void>; remoteCommand(command: object): Promise<void>; appsCommand(command: object): Promise<void>; chooseWorkspace(): Promise<void>; chooseContext(): Promise<void> };
    peroSendProbe(json: string): void;
    peroSetLocale(locale: string): void;
    peroSessionCommand(json: string): void;
    peroAppSurface(json: string): void;
    peroDiagnostics: { snapshot: typeof snapshot };
  }
}
const loading = document.getElementById('loading')!;
let locale = normalizeLocale(navigator.language);
const t = (key: Parameters<typeof translate>[1]) => translate(locale, key);
const updateDocument = () => { document.documentElement.lang = locale; document.title = t('window.title'); loading.textContent = t('loading'); };
updateDocument();
try {
  const connection = window.pero ? await window.pero.connect() : null;
  if (window.pero) locale = normalizeLocale(await window.pero.getLocale());
  updateDocument();
  const dark = matchMedia('(prefers-color-scheme: dark)').matches;
  for (const [key, value] of Object.entries(dark ? themes.dark : themes.light)) {
    document.documentElement.style.setProperty(`--pero-${key}`, value);
  }
  await init();
  const apps = mountAppSurfaces(value => window.pero ? window.pero.appsCommand(value) : Promise.reject(new Error(t('error.browser'))));
  window.peroAppSurface = json => apps.surface(JSON.parse(json) as AppSurface);
  window.peroSendProbe = (json) => {
    const request = JSON.parse(json);
    if (!window.pero) {
      queueMicrotask(() => receive_host_event(JSON.stringify({ version: 1, kind: 'error', request_id: request.id, text: '', message_key: 'error.browser' })));
      return;
    }
    window.pero.sendProbe(request).catch(() => receive_host_event(JSON.stringify({ version: 1, kind: 'error', request_id: request.id, text: '', message_key: 'error.connection' })));
  };
  const onEvent = (event: HostEvent) => {
    if (event.kind === 'settings') { locale = normalizeLocale(event.text); updateDocument(); }
    receive_host_event(JSON.stringify(event));
    apps.event(event);
  };
  window.peroSetLocale = (value) => {
    if (window.pero) window.pero.setLocale(value).catch(() => onEvent({ version: 1, kind: 'error', request_id: null, text: '', message_key: 'error.settings' }));
    else queueMicrotask(() => onEvent({ version: 1, kind: 'settings', request_id: null, text: normalizeLocale(value) }));
  };
  window.peroSessionCommand = (json) => {
    const command = JSON.parse(json);
    if (!window.pero) { queueMicrotask(() => onEvent({version:1,kind:'error',request_id:null,text:'',message_key:'error.agent_browser'})); return; }
    const pending = typeof command.action === 'string' && command.action.startsWith('apps_') ? window.pero.appsCommand(command) : typeof command.action === 'string' && command.action.startsWith('remote_') ? window.pero.remoteCommand(command) : command.action === 'choose_workspace' ? window.pero.chooseWorkspace() : command.action === 'choose_context' ? window.pero.chooseContext() : window.pero.sessionCommand(command);
    pending.catch(() => onEvent({version:1,kind:command.thread_id?'session_error':'error',thread_id:command.thread_id,request_id:null,text:t('error.connection')}));
  };
  run(JSON.stringify(themes), dark, locale);
  window.peroDiagnostics = { snapshot };
  // GPUI opens its Web window after asynchronous GPU initialization.
  const deadline = performance.now() + 30000;
  while (!JSON.parse(snapshot()).ready) {
    if (performance.now() > deadline) throw new Error('GPUI initialization timed out');
    await new Promise(requestAnimationFrame);
  }
  if (window.pero) {
    window.pero.onEvent(onEvent);
    if (connection) onEvent(connection);
    await window.pero.sessionCommand({action:'list_agents'});
    await window.pero.remoteCommand({action:'remote_refresh'});
    await window.pero.appsCommand({action:'apps_list'});
  }
  loading.remove();
} catch (error) {
  console.error(error);
  loading.textContent = t('error.loading');
  loading.setAttribute('role', 'alert');
}

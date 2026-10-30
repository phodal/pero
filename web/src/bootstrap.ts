import { loadContentResult, cancelContentResult } from './content-results';
import type { ContentChunk, ConversationReadParameters } from '../../packages/content-source/index';
import init, { run, receive_host_event, snapshot, has_unsaved_documents, paste_image, set_system_theme } from './wasm/pero_ui';
import { appChatLauncher } from './app-chat';
import { previewContext } from './context-preview';
import themes from './theme.generated.json';
import './shell.css';
import { applyAppearance } from '../../packages/app-sdk/src/appearance';
import { normalizeLocale, translate } from '../../locales';
import { mountAppSurfaces, type AppSurface } from './apps';

export interface HostEvent { version: number; kind: string; request_id: string | null; text: string; message_key?: string; thread_id?: string; data?: unknown }
declare global {
  interface Window {
    pero?: { webCommand(command:object):Promise<void>; readContent(request:ConversationReadParameters):Promise<ContentChunk>; connect(): Promise<HostEvent>; getLocale(): Promise<string>; setLocale(locale: string): Promise<void>; sendProbe(request: { id: string; text: string }): Promise<void>; onEvent(callback: (event: HostEvent) => void): () => void; sessionCommand(command: object): Promise<void>; remoteCommand(command: object): Promise<void>; computerCommand(command: object): Promise<unknown>; appsCommand(command: object): Promise<void>; appUseCommand(command: object): Promise<unknown>; chooseWorkspace(): Promise<void>; chooseContext(command?: object): Promise<void> };
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
  window.addEventListener('beforeunload',event=>{if(has_unsaved_documents()){event.preventDefault();event.returnValue='';}});
  const launchAppChat=appChatLauncher({
    open:scope=>receive_host_event(JSON.stringify({version:1,kind:'app_scope',request_id:null,text:'',data:scope})),
    draft:async()=>{const state=JSON.parse(snapshot());return {threadId:state.chats?.[state.activeChat]?.id,scope:state.scope};},
    command:value=>{if(!window.pero)throw new Error(t('error.browser'));return window.pero.appUseCommand(value);},
    deliver:(thread_id,contexts,text,replace)=>receive_host_event(JSON.stringify({version:1,kind:'compose_context',request_id:null,text,data:{thread_id,contexts,replace}})),
  });
  const apps = mountAppSurfaces(value=>window.pero?window.pero.appsCommand(value):Promise.reject(new Error(t('error.browser'))),launchAppChat,({header,text})=>receive_host_event(JSON.stringify({version:1,kind:'document_open',request_id:null,text,data:header})));
  window.peroAppUseRevoke = async(thread,scope) => {await window.pero!.appUseCommand({action:'revoke',thread_id:thread,scope});};
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
    if (event.kind === 'workbench_settings') applyAppearance(JSON.parse(snapshot()).appearance);
    apps.event(event);
  };
  window.peroSetLocale = (value) => {
    if (window.pero) window.pero.setLocale(value).catch(() => onEvent({ version: 1, kind: 'error', request_id: null, text: '', message_key: 'error.settings' }));
    else queueMicrotask(() => onEvent({ version: 1, kind: 'settings', request_id: null, text: normalizeLocale(value) }));
  };
  window.peroSessionCommand = (json) => {
    const command = JSON.parse(json);
    if(typeof command.action==='string'&&command.action.startsWith('web_')) {if(window.pero)void window.pero.webCommand(command).catch(()=>onEvent({version:1,kind:'web_error',request_id:null,text:t('error.connection')}));else onEvent({version:1,kind:'web_error',request_id:null,text:t('error.browser')});return;}
    if(command.action==='cancel_read_result'){cancelContentResult(command.request_id);return;}
    if(command.action==='read_result'){void loadContentResult(command,request=>window.pero?window.pero.readContent(request):Promise.reject(new Error(t('error.browser'))),onEvent);return;}
    if(command.action==='app_context_preview'){previewContext(command.reference,context=>receive_host_event(JSON.stringify({version:1,kind:'compose_context',request_id:null,text:'',data:{thread_id:command.thread_id,contexts:[context]}})));return;}
    if (!window.pero && command.method === 'settings.workbench') {
      // Browser preview keeps appearance in memory; Desktop persists via Host.
      queueMicrotask(() => onEvent({version:1,kind:'workbench_settings',request_id:null,text:'',data:command.preferences}));
      return;
    }
    if (!window.pero) { queueMicrotask(() => onEvent({version:1,kind:'error',request_id:null,text:'',message_key:'error.agent_browser'})); return; }
    const pending = command.action==='app_use_selection' ? window.pero.appUseCommand({action:'select',thread_id:command.thread_id}) : typeof command.action === 'string' && command.action.startsWith('apps_') ? window.pero.appsCommand(command) : typeof command.action === 'string' && command.action.startsWith('computer_') ? window.pero.computerCommand(command) : typeof command.action === 'string' && command.action.startsWith('remote_') ? window.pero.remoteCommand(command) : command.action === 'choose_workspace' ? window.pero.chooseWorkspace() : command.action === 'choose_context' ? window.pero.chooseContext(command.kind ? command : undefined) : window.pero.sessionCommand(command);
    pending.catch(() => onEvent({version:1,kind:command.action === 'search_context' || command.action === 'resolve_context' || command.action === 'choose_context' && command.kind ? 'context_error' : command.thread_id?'session_error':'error',thread_id:command.thread_id,request_id:command.request_id ?? null,text:t('error.connection')}));
  };
  run(JSON.stringify(themes), dark, locale);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', event => {
    set_system_theme(event.matches);
    applyAppearance(JSON.parse(snapshot()).appearance);
  });
  window.peroDiagnostics = { snapshot };
  document.addEventListener('paste', (event: ClipboardEvent) => {
    const before = JSON.parse(snapshot());
    if (!before.composerFocused || !before.chatVisible) return;
    const images = [...(event.clipboardData?.items ?? [])].filter(item=>item.kind === 'file' && item.type.startsWith('image/'));
    if (!images.length) return;
    event.preventDefault();
    for (const item of images) {
      const file = item.getAsFile();
      if (!file) continue;
      if (file.size > 10_000_000) { paste_image('', file.type); continue; }
      const reader = new FileReader();
      reader.addEventListener('load', () => {
        if (JSON.parse(snapshot()).activeChat === before.activeChat) paste_image(String(reader.result).split(',')[1], file.type);
      });
      reader.readAsDataURL(file);
    }
  }, true);
  // GPUI opens its Web window after asynchronous GPU initialization.
  const deadline = performance.now() + 30000;
  while (!JSON.parse(snapshot()).ready) {
    if (performance.now() > deadline) throw new Error('GPUI initialization timed out');
    await new Promise(requestAnimationFrame);
  }
  if (window.pero) {
    window.pero.onEvent(onEvent);
    if (connection) onEvent(connection);
    await window.pero.sessionCommand({method:'settings.workbench.get'});
    await window.pero.sessionCommand({action:'list_agents'});
    // The local workbench is ready even while Cloud refresh/enrollment waits.
    void window.pero.remoteCommand({action:'remote_refresh'}).catch(() => {});
    void window.pero.computerCommand({action:'computer_get'}).catch(() => {});
    void window.pero.sessionCommand({action:'local_worker_init'}).catch(() => onEvent({version:1,kind:'error',request_id:null,text:'',message_key:'error.connection'}));
    await window.pero.appsCommand({action:'apps_list'});
  }
  loading.remove();
} catch (error) {
  console.error(error);
  loading.textContent = t('error.loading');
  loading.setAttribute('role', 'alert');
}

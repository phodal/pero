import init, { run, receive_host_event, snapshot, paste_image, set_system_theme, set_appearance, compose } from './chat-wasm/pero_chat_web';
import themes from './theme.generated.json';
import { normalizeLocale, translate } from '../../locales';
import type { HostEvent } from './bootstrap';
import type { ChatSurfaceContext } from './chat-surface';
import './chat.css';
import { applyAppearance, readAppearance } from '../../packages/app-sdk/src/appearance';

declare global {
  interface Window {
    peroChatDiagnostics: { snapshot: typeof snapshot };
  }
}
const parentOrigin = 'pero://workbench';
let context: ChatSurfaceContext = { dark: false, locale: 'en', active: true };
let initialized = false;
let initialContext: (context: ChatSurfaceContext) => void;
const readyContext = new Promise<ChatSurfaceContext>(resolve => { initialContext = resolve; });
const queued: HostEvent[] = [];
let publishedAppearance = '';
const publishAppearance = () => {
  const appearance = JSON.parse(snapshot()).appearance;
  applyAppearance(appearance);
  const serialized = JSON.stringify(appearance);
  if (serialized === publishedAppearance) return;
  publishedAppearance = serialized;
  window.parent.postMessage({ type: 'pero:chat:appearance', appearance }, parentOrigin);
};
const applyContext = () => {
  document.documentElement.lang = normalizeLocale(context.locale);
  document.documentElement.style.colorScheme = context.dark ? 'dark' : 'light';
  for (const [key, value] of Object.entries(context.dark ? themes.dark : themes.light)) document.documentElement.style.setProperty(`--pero-${key}`, value);
  if (initialized) {
    set_system_theme(context.dark);
    if (context.appearance) {
      applyAppearance(context.appearance);
      set_appearance(JSON.stringify(context.appearance));
    }
    publishAppearance();
    receive_host_event(JSON.stringify({ version: 1, kind: 'settings', request_id: null, text: context.locale }));
    receive_host_event(JSON.stringify({ version: 1, kind: 'chat_visibility', request_id: null, text: '', data: context.active }));
    receive_host_event(JSON.stringify({ version: 1, kind: 'app_scope', request_id: null, text: '', data: context.scope || null }));
  }
};
window.addEventListener('message', event => {
  if (event.source !== window.parent || event.origin !== parentOrigin) return;
  if (event.data?.type === 'pero:chat:context') {
    const appearance = readAppearance(event.data.context?.appearance);
    if (event.data.context?.appearance !== undefined && !appearance) return;
    context = { ...event.data.context, appearance } as ChatSurfaceContext;
    initialContext(context); applyContext();
  } else if (event.data?.type === 'pero:chat:event') {
    if (initialized) {
      receive_host_event(JSON.stringify(event.data.event));
      if (event.data.event.kind === 'workbench_settings') {
        publishAppearance();
      }
    } else queued.push(event.data.event);
  } else if (event.data?.type === 'pero:chat:query-selection' && initialized) {
    const state = JSON.parse(snapshot());
    window.parent.postMessage({type:'pero:chat:selection',id:event.data.id,thread:state.chats?.[state.activeChat]?.id,draft:{threadId:state.chats?.[state.activeChat]?.id,scope:state.scope}},parentOrigin);
  } else if (event.data?.type === 'pero:chat:compose' && initialized && typeof event.data.text === 'string') compose(event.data.text);
});
window.peroSessionCommand = json => window.parent.postMessage({ type: 'pero:chat:command', command: JSON.parse(json) }, parentOrigin);
window.parent.postMessage({ type: 'pero:chat:connect' }, parentOrigin);
try {
  context = await readyContext;
  applyContext();
  await init();
  run(JSON.stringify(themes), context.dark, normalizeLocale(context.locale));
  const deadline = performance.now() + 30000;
  while (!JSON.parse(snapshot()).ready) {
    if (performance.now() > deadline) throw new Error(translate(context.locale, 'error.loading'));
    await new Promise(requestAnimationFrame);
  }
  initialized = true;
  applyContext();
  for (const event of queued.splice(0)) receive_host_event(JSON.stringify(event));
  publishAppearance();
  window.peroChatDiagnostics = { snapshot };
  window.parent.postMessage({ type: 'pero:chat:ready' }, parentOrigin);
  document.getElementById('loading')?.remove();
} catch (error) {
  const loading = document.getElementById('loading')!;
  loading.textContent = `${translate(context.locale, 'error.loading')} ${String(error)}`;
  loading.setAttribute('role', 'alert');
  window.parent.postMessage({ type: 'pero:chat:error' }, parentOrigin);
}
document.addEventListener('paste', (event: ClipboardEvent) => {
  if (!initialized || !JSON.parse(snapshot()).composerFocused) return;
  const images = [...(event.clipboardData?.items || [])].filter(item => item.kind === 'file' && item.type.startsWith('image/'));
  if (!images.length) return;
  event.preventDefault();
  for (const item of images) {
    const file = item.getAsFile();
    if (!file) continue;
    if (file.size > 10_000_000) { paste_image('', file.type); continue; }
    const before = JSON.parse(snapshot()).activeChat;
    const reader = new FileReader();
    reader.onload = () => { if (JSON.parse(snapshot()).activeChat === before) paste_image(String(reader.result).split(',')[1], file.type); };
    reader.readAsDataURL(file);
  }
}, true);

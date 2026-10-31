import type { ContentChunk, ConversationReadParameters } from '../../../packages/content-source/index';
import { appChatLauncher } from '../../../web/src/app-chat';
import { previewContext } from '../../../web/src/context-preview';
import { mountAppSurfaces } from '../../../web/src/apps';
import type { HostEvent } from '../../../web/src/bootstrap';
import type { ProductFields } from '../../../packages/product/product';
import themes from '../../../web/src/theme.generated.json';
import { mountChatSurface, type ChatSurface } from '../../../web/src/chat-surface';
import { translate } from '../../../locales';
import { applyAppearance, type AppearanceSnapshot } from '../../../packages/app-sdk/src/appearance';
import { mountReaderSurface } from '../../../packages/app-sdk/src/reader-surface';
import type { DocumentHeader } from '../../../protocol/generated/host';
let appearance: AppearanceSnapshot | undefined;
type Context = { product: ProductFields; locale: string; dark: boolean; connected: boolean };
const bridge = (window as unknown as { product: {
  readContent(request:ConversationReadParameters):Promise<ContentChunk>;
  connect(): Promise<Context>; open(name?: string): Promise<void>;
  sessionCommand(command: object): Promise<void>;
  appUseCommand(command: object): Promise<unknown>;
  openExternal(url: string): Promise<void>;
  onEvent(receive: (value: HostEvent) => void): void;
  onContext(receive: (value: Context) => void): void;
} }).product;
window.peroAppUseRevoke = async(thread,scope) => {await bridge.appUseCommand({action:'revoke',thread_id:thread,scope});};
let context: Context;
let runtimeConnected = false;
let selected: { app: string; panel?: string };
let chatSlot: {scope:{app:string;panel:string};rect:{x:number;y:number;width:number;height:number}} | null = null;
let chatSlotReady = false;
const report = (error: Error) => surface.event({ kind: 'apps_error', text: error.message } as HostEvent);
const launchAppChat=appChatLauncher({
  open:scope=>{if(!chat||!context.product.chat||selected.app!==scope.app)throw new Error('Chat is not enabled for this App');if(!chatSlot)chatOpen=true;update();},
  draft:async()=>chat?.selectedDraft(),
  command:async value=>{
    const request = value as { action?: string; options?: { capture?: boolean } };
    if (request.action !== 'context' || !request.options?.capture) return bridge.appUseCommand(value);
    capturePending = true; update();
    try {
      // Let the compositor paint the uncovered App before Desktop captures pixels.
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      return await bridge.appUseCommand(value);
    } finally { capturePending = false; update(); }
  },
  deliver:(thread_id,contexts,text,replace)=>chat?.event({version:1,kind:'compose_context',request_id:null,text,data:{thread_id,contexts,replace}}),
});
const surface = mountAppSurfaces(async () => bridge.open(selected.app).catch(report),launchAppChat,openReading,undefined,async slot=>{
  const accepted = !!slot && !!context?.product.chat && !!chat && !reader && selected?.app === slot.scope.app && (selected.panel || 'main') === slot.scope.panel;
  const next = accepted ? slot : null;
  if (JSON.stringify(chatSlot) !== JSON.stringify(next)) { chatSlot = next; chatSlotReady = false; queueMicrotask(update); }
  if (!next) return false;
  // The separate Chat iframe selects its scope asynchronously. Do not expose
  // the previous App's transcript in the slot while that selection settles.
  const deadline = performance.now() + 5000;
  while (JSON.stringify(chatSlot) === JSON.stringify(next) && performance.now() < deadline) {
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    const draft = await chat?.selectedDraft();
    if (JSON.stringify(chatSlot) === JSON.stringify(next) && draft?.threadId && draft.scope?.app === next.scope.app && draft.scope.panel === next.scope.panel) {
      chatSlotReady = true; update();
      // Give the newly sized Chat iframe a chance to paint before the App
      // removes its fallback and the user can interact with the slot.
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      const rendered = await chat?.selectedDraft();
      const ready = JSON.stringify(chatSlot) === JSON.stringify(next) && !reader && !capturePending && !chatPanel.hidden &&
        selected?.app === next.scope.app && (selected.panel || 'main') === next.scope.panel &&
        rendered?.threadId === draft.threadId && rendered.scope?.app === next.scope.app && rendered.scope.panel === next.scope.panel;
      if (!ready && JSON.stringify(chatSlot) === JSON.stringify(next)) { chatSlot = null; chatSlotReady = false; update(); }
      return ready;
    }
  }
  if (JSON.stringify(chatSlot) === JSON.stringify(next)) { chatSlot = null; chatSlotReady = false; update(); }
  return false;
});
const readingPanel=document.createElement('section'); readingPanel.id='product-document'; readingPanel.hidden=true;
const readingHeader=document.createElement('header');
const readingTitle=document.createElement('strong'); readingTitle.id='product-document-title';
const closeReading=document.createElement('button'); closeReading.type='button';
readingHeader.append(readingTitle,closeReading);
const readingBody=document.createElement('div'); readingBody.className='product-document-reader';
readingPanel.setAttribute('aria-labelledby',readingTitle.id);readingPanel.append(readingHeader,readingBody);document.body.append(readingPanel);
let reader:ReturnType<typeof mountReaderSurface>|undefined;
let readingOpener:HTMLElement|undefined;
function openReading(source:{header:DocumentHeader;text:string}) {
  readingOpener=document.activeElement instanceof HTMLElement?document.activeElement:undefined;
  readingTitle.textContent=source.header.source.title;
  if(reader)reader.source(source);
  else reader=mountReaderSurface(readingBody,{source,context:{locale:context.locale,dark:context.dark,appearance},url:'pero://reader/reader.html',link:url=>{void bridge.openExternal(url);}});
  update();
}
closeReading.onclick=()=>{reader?.dispose();reader=undefined;update();readingOpener?.focus();};
const navigation = document.createElement('nav');
navigation.hidden = true;
const selector = document.createElement('select');
navigation.append(selector);
const appTitle = document.createElement('span');
navigation.append(appTitle);
const toggle = document.createElement('button');
toggle.type = 'button'; toggle.id = 'product-chat-toggle';
navigation.append(toggle);
document.body.append(navigation);
const chatPanel = document.createElement('aside');
chatPanel.id = 'product-chat'; chatPanel.hidden = true;
chatPanel.dataset.peroAppChatOverlay = '';
const chatHeader = document.createElement('header');
const chatTitle = document.createElement('strong');
const chatExpand = document.createElement('button'); chatExpand.type = 'button';
const chatClose = document.createElement('button'); chatClose.type = 'button';
const chatBody = document.createElement('div'); chatBody.id = 'product-chat-body';
chatHeader.append(chatTitle, chatExpand, chatClose); chatPanel.append(chatHeader, chatBody);
document.body.append(chatPanel);
let chat: ChatSurface | undefined;
let chatOpen = false;
let chatExpanded = false;
let capturePending = false;
let chatReady = false;
const chatNotices = new Map<string, 'running' | 'permission' | 'auth' | 'error'>();
let selectedThread: string | undefined;
const refreshChatNotice = () => {
  void chat?.selectedDraft().then(draft => {
    if (draft?.scope?.app !== selected.app || draft.scope.panel !== (selected.panel || 'main')) return;
    selectedThread = draft.threadId;
    const notice = selectedThread && chatNotices.get(selectedThread);
    if (chatOpen && !chatSlot && notice && notice !== 'running') chatExpanded = true;
    update();
  });
};
const initializeChat = () => {
  if (!context?.connected || !chatReady) return;
  chat?.event({ version: 1, kind: 'ready', request_id: null, text: '' });
  void Promise.all([
    bridge.sessionCommand({ action: 'list_agents' }),
    bridge.sessionCommand({ method: 'settings.workbench.get' }),
  ]).catch(error => chat?.event({ version: 1, kind: 'error', request_id: null, text: error instanceof Error ? error.message : String(error) }));
};
function update() {
  if (!context || !selected) return;
  const embedded = !!chatSlot && !reader && chatSlot.scope.app === selected.app && chatSlot.scope.panel === (selected.panel || 'main');
  document.title = context.product.name;
  document.documentElement.style.colorScheme = context.dark ? 'dark' : 'light';
  navigation.hidden = context.product.apps.length < 2 && !context.product.chat;
  selector.hidden = context.product.apps.length < 2;
  appTitle.hidden = !selector.hidden;
  appTitle.textContent = context.product.name;
  selector.setAttribute('aria-label', translate(context.locale, 'apps.switch'));
  toggle.hidden = !context.product.chat || embedded || chatOpen;
  const notice = selectedThread && chatNotices.get(selectedThread);
  toggle.textContent = translate(context.locale, chatOpen ? 'chat.close_panel' : 'chat.open_panel') +
    (notice ? ` · ${translate(context.locale, notice === 'permission' ? 'chat.permission' : notice === 'running' ? 'chat.thinking' : notice === 'auth' ? 'chat.signin' : 'roadmap.attention')}` : '');
  toggle.setAttribute('aria-expanded', String(chatOpen));
  toggle.setAttribute('aria-controls', chatPanel.id);
  chatTitle.textContent = translate(context.locale, 'chat.panel_title');
  chatExpand.textContent = translate(context.locale, chatExpanded ? 'chat.hide_messages' : 'chat.show_messages');
  chatExpand.setAttribute('aria-expanded', String(chatExpanded));
  chatClose.textContent = translate(context.locale, 'chat.close_panel');
  for (const [name, value] of Object.entries(context.dark ? themes.dark : themes.light)) document.documentElement.style.setProperty(`--pero-${name}`, value);
  if (appearance) applyAppearance(appearance);
  const top = navigation.hidden ? 0 : navigation.getBoundingClientRect().height;
  const chatWidth = Math.min(480, Math.max(0, innerWidth - 24));
  const chatHeight = Math.min(chatExpanded ? Math.min(560, innerHeight * .7) : 120, Math.max(0, innerHeight - top - 24));
  surface.surface({ visible: !reader, name: selected.app, panel: selected.panel, top,
    dark: appearance?.dark ?? context.dark, appearance, locale: context.locale, width: innerWidth, height: innerHeight - top });
  chatPanel.hidden = !context.product.chat || !(chatOpen || embedded) || capturePending || (embedded && !chatSlotReady);
  chatPanel.classList.toggle('compact', !embedded && !chatExpanded);
  chatHeader.hidden = embedded;
  const bounds = embedded && chatSlot ? chatSlot.rect : {x:innerWidth-chatWidth-12,y:innerHeight-chatHeight-12,width:chatWidth,height:chatHeight};
  chatPanel.style.cssText = `left:${bounds.x}px;top:${bounds.y}px;width:${bounds.width}px;height:${bounds.height}px`;
  chat?.context({ dark: context.dark, appearance, locale: context.locale, active: chatOpen || embedded, scope: { app: selected.app, panel: selected.panel || 'main' } });
  chat?.event({ version: 1, kind: 'chat_compact', request_id: null, text: '', data: !embedded && !chatExpanded });
  readingPanel.hidden=!reader;
  readingPanel.style.cssText=`left:0;top:${top}px;width:${innerWidth}px;height:${innerHeight-top}px`;
  closeReading.textContent=translate(context.locale,'workspace.close_tab');
  reader?.context({dark:context.dark,appearance,locale:context.locale});
}
toggle.onclick = () => { chatOpen = !chatOpen; update(); if (chatOpen) refreshChatNotice(); };
chatExpand.onclick = () => { chatExpanded = !chatExpanded; update(); };
chatClose.onclick = () => { chatOpen = false; update(); toggle.focus(); };
selector.onchange = () => {
  reader?.dispose();reader=undefined;
  selected = { app: selector.value };
  selectedThread = undefined;
  update();
  refreshChatNotice();
  void bridge.open(selected.app).catch(report);
};
bridge.onEvent(event => {
  if (event.kind === 'ready') { runtimeConnected = true; if (context) context.connected = true; initializeChat(); }
  if (event.kind === 'disconnected') { runtimeConnected = false; if (context) context.connected = false; }
  chat?.event(event);
  if (event.thread_id && ['turn_started', 'permission', 'session_auth_required', 'session_auth_error', 'session_authenticated', 'session_ready', 'session_error', 'turn_finished', 'session_closed'].includes(event.kind)) {
    if (event.kind === 'turn_started') chatNotices.set(event.thread_id, 'running');
    if (event.kind === 'permission') chatNotices.set(event.thread_id, 'permission');
    if (event.kind === 'session_auth_required' || event.kind === 'session_auth_error') chatNotices.set(event.thread_id, 'auth');
    if (event.kind === 'session_error') chatNotices.set(event.thread_id, 'error');
    if (['turn_finished', 'session_closed', 'session_ready', 'session_authenticated'].includes(event.kind)) chatNotices.delete(event.thread_id);
    refreshChatNotice();
  }
  if (event.kind === 'apps_catalog') {
    const catalog = event.data as { name: string; displayName: string }[];
    for (const option of selector.options) option.textContent = catalog.find(app => app.name === option.value)?.displayName || option.value;
  }
  if (event.kind === 'apps_opened') {
    const value = event.data as { name: string; panel: string };
    // A late response to another selection can be retained without changing the current App.
    if (value.name === selected.app) { selected.panel = value.panel; update(); }
  }
  surface.event(event);
});
bridge.onContext(value => { context = value; appearance = undefined; update(); });
window.addEventListener('resize', update);
bridge.connect().then(value => {
  context = value; selected = value.product.entry!;
  context.connected ||= runtimeConnected;
  if (value.product.chat) chat = mountChatSurface(chatBody, {
    readContent: request=>bridge.readContent(request),
    context: { dark: value.dark, locale: value.locale, active: chatOpen, scope: { app: selected.app, panel: selected.panel || 'main' } },
    command:command=>{
      const intent=command as {action?:string;thread_id?:string};
      if(intent.action==='app_location'){const address=command as {app:string;panel:string;location:string};if(context.product.apps.includes(address.app)){selected={app:address.app,panel:address.panel};update();surface.openLocation(address.app,address.panel,address.location);return bridge.open(address.app);}return Promise.resolve();}
      if(intent.action==='chat_expand') { if(chatOpen && !chatSlot) { chatExpanded = true; update(); } return Promise.resolve(); }
      if(intent.action==='prompt' && chatOpen && !chatSlot) { chatExpanded = true; update(); }
      if(intent.action==='app_use_selection')return bridge.appUseCommand({action:'select',thread_id:intent.thread_id}).then(()=>{});
      if(intent.action==='app_context_preview'){
        const preview=command as {reference:Parameters<typeof previewContext>[0];thread_id:string};
        previewContext(preview.reference,context=>chat?.event({version:1,kind:'compose_context',request_id:null,text:'',data:{thread_id:preview.thread_id,contexts:[context]}}));
        return Promise.resolve();
      }
      return bridge.sessionCommand(command);
    },
    appearance: value => { appearance = value; update(); },
    ready: () => { chatReady = true; initializeChat(); },
  });
  for (const name of value.product.apps) selector.add(new Option(name, name));
  selector.value = selected.app;
  update();
  return bridge.open(selected.app);
}).catch(report);

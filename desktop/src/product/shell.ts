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
let appearance: AppearanceSnapshot | undefined;
type Context = { product: ProductFields; locale: string; dark: boolean; connected: boolean };
const bridge = (window as unknown as { product: {
  readContent(request:ConversationReadParameters):Promise<ContentChunk>;
  connect(): Promise<Context>; open(name?: string): Promise<void>;
  sessionCommand(command: object): Promise<void>;
  appUseCommand(command: object): Promise<unknown>;
  onEvent(receive: (value: HostEvent) => void): void;
  onContext(receive: (value: Context) => void): void;
} }).product;
window.peroAppUseRevoke = async(thread,scope) => {await bridge.appUseCommand({action:'revoke',thread_id:thread,scope});};
let context: Context;
let runtimeConnected = false;
let selected: { app: string; panel?: string };
const report = (error: Error) => surface.event({ kind: 'apps_error', text: error.message } as HostEvent);
const launchAppChat=appChatLauncher({
  open:scope=>{if(!chat||!context.product.chat||selected.app!==scope.app)throw new Error('Chat is not enabled for this App');chatOpen=true;update();},
  draft:async()=>chat?.selectedDraft(),
  command:value=>bridge.appUseCommand(value),
  deliver:(thread_id,contexts,text,replace)=>chat?.event({version:1,kind:'compose_context',request_id:null,text,data:{thread_id,contexts,replace}}),
});
const surface = mountAppSurfaces(async () => bridge.open(selected.app).catch(report),launchAppChat);
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
document.body.append(chatPanel);
let chat: ChatSurface | undefined;
window.peroAppUseThread = () => chat?.selectedThread() || Promise.resolve(undefined);
let chatOpen = true;
let chatReady = false;
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
  document.title = context.product.name;
  document.documentElement.style.colorScheme = context.dark ? 'dark' : 'light';
  navigation.hidden = context.product.apps.length < 2 && !context.product.chat;
  selector.hidden = context.product.apps.length < 2;
  appTitle.hidden = !selector.hidden;
  appTitle.textContent = context.product.name;
  selector.setAttribute('aria-label', translate(context.locale, 'apps.switch'));
  toggle.hidden = !context.product.chat;
  toggle.textContent = translate(context.locale, chatOpen ? 'chat.close_panel' : 'chat.open_panel');
  toggle.setAttribute('aria-expanded', String(chatOpen));
  toggle.setAttribute('aria-controls', chatPanel.id);
  for (const [name, value] of Object.entries(context.dark ? themes.dark : themes.light)) document.documentElement.style.setProperty(`--pero-${name}`, value);
  if (appearance) applyAppearance(appearance);
  const top = navigation.hidden ? 0 : navigation.getBoundingClientRect().height;
  const narrow = innerWidth < 1000;
  const chatWidth = context.product.chat && chatOpen ? narrow ? innerWidth : Math.round(Math.max(360, innerWidth * .36)) : 0;
  surface.surface({ visible: !(narrow && chatWidth), name: selected.app, panel: selected.panel, top,
    dark: appearance?.dark ?? context.dark, appearance, locale: context.locale, width: innerWidth - chatWidth, height: innerHeight - top });
  chatPanel.hidden = !context.product.chat || !chatOpen;
  chatPanel.style.cssText = `left:${innerWidth - chatWidth}px;top:${top}px;width:${chatWidth}px;height:${innerHeight - top}px`;
  chat?.context({ dark: context.dark, appearance, locale: context.locale, active: chatOpen, scope: { app: selected.app, panel: selected.panel || 'main' } });
}
toggle.onclick = () => { chatOpen = !chatOpen; update(); };
selector.onchange = () => {
  selected = { app: selector.value };
  update();
  void bridge.open(selected.app).catch(report);
};
bridge.onEvent(event => {
  if (event.kind === 'ready') { runtimeConnected = true; if (context) context.connected = true; initializeChat(); }
  if (event.kind === 'disconnected') { runtimeConnected = false; if (context) context.connected = false; }
  chat?.event(event);
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
  if (value.product.chat) chat = mountChatSurface(chatPanel, {
    readContent: request=>bridge.readContent(request),
    context: { dark: value.dark, locale: value.locale, active: chatOpen, scope: { app: selected.app, panel: selected.panel || 'main' } },
    command:command=>{
      const intent=command as {action?:string;thread_id?:string};
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

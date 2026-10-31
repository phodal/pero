import { mountAppPreparation } from './app-preparation';
import { translate, normalizeLocale } from '../../locales';
import type { HostEvent } from './bootstrap';
import themes from './theme.generated.json';
import { applyAppearance, type AppearanceSnapshot } from '../../packages/app-sdk/src/appearance';
import { mountAppUseFrames } from './app-use';
import { AppDocuments } from '../../packages/content-source/app-document';
import type { IconThemePackage } from '../../packages/icons/theme';
import type { DocumentHeader } from '../../protocol/generated/host';

export type AppSurface = { visible: boolean; name?: string; panel?: string; left?: number; top?: number; width?: number; height?: number; dark: boolean; locale: string; appearance?: AppearanceSnapshot; pane?:number; focused?:boolean; open?:{name:string;panel:string}[] };
export type AppSurfaceSlot=Omit<AppSurface,'dark'|'locale'|'appearance'|'open'>;
export type AppSurfaceBatch = {surfaces:AppSurfaceSlot[];dark:boolean;locale:string;appearance?:AppearanceSnapshot;open?:{name:string;panel:string}[]};
type Mount = {region:HTMLElement;status:HTMLDivElement;useStatus:HTMLDivElement;surface:AppSurface;error:string;presenceExpiry?:ReturnType<typeof setTimeout>};
type Frame = { documents:AppDocuments; element: HTMLIFrameElement; name: string; panel: string; ready: boolean; failed: boolean; timer: ReturnType<typeof setTimeout>; dispose(): void };
type AppUsePresence = { scope: { app: string; panel: string }; title?: string; standing: string[]; tasks: { id: string; actions: string[]; expiresAt: number }[] };
export type AppChatSlot = { scope: { app: string; panel: string }; rect: { x: number; y: number; width: number; height: number } };
type SlotRequest = { frame: Frame; id: string; rect: AppChatSlot['rect'] };

/** Retains App documents across navigation; GPUI owns selection and layout. */
export function mountAppSurfaces(command: (value: object) => Promise<void>, onChat?: (context: { name: string; panel: string; text?: string;options?:unknown }) => void|Promise<unknown>, onDocument?:(value:ReturnType<AppDocuments['admit']>)=>void,onFocus?:(pane:number)=>void,onChatSlot?:(slot:AppChatSlot|null)=>boolean|Promise<boolean>) {
  const frames = new Map<string, Frame>();
  const appUse = mountAppUseFrames();
  const presence = new Map<string, AppUsePresence & { thread: string }>();
  const mounts=new Map<string,Mount>();
  let iconTheme:IconThemePackage|null=null;
  const region = document.createElement('section');
  region.id = 'pero-app-surface';
  region.setAttribute('aria-label', 'App');
  region.hidden = true;
  document.body.append(region);
  let surface: AppSurface = { visible: false, dark: false, locale: 'en' };
  const preparation = mountAppPreparation(command, () => normalizeLocale(surface.locale) === 'zh-CN');
  let chatOverlay: {x:number;y:number;width:number;height:number}|null = null;
  let chatOverlaySuspended = false;
  const slotRequests = new Map<Frame, SlotRequest>();
  let presentedSlot: SlotRequest | undefined;
  let presentedKey = '';
  let slotGeneration = 0;
  const key = (name?: string, panel?: string) => `${name}:${panel}`;
  const respondSlot = (request: SlotRequest, active: boolean) => {
    const url = new URL(request.frame.element.src);
    request.frame.element.contentWindow?.postMessage({type:'pero:app:chat-slot-result',id:request.id,active},`${url.protocol}//${url.host}`);
  };
  const reconcileSlot = () => {
    let candidate: { request: SlotRequest; value: AppChatSlot } | undefined;
    for (const request of slotRequests.values()) {
      const {frame,rect} = request;
      const slot = mounts.get(key(frame.name,frame.panel));
      if (!frame.element.isConnected || !frame.ready || !slot?.surface.visible) continue;
      const box=frame.element.getBoundingClientRect();
      const x=box.left+rect.x, y=box.top+rect.y;
      if (rect.x < 0 || rect.y < 0 || rect.width < 320 || rect.height < 240 ||
          rect.x+rect.width > box.width || rect.y+rect.height > box.height ||
          x < 0 || y < 0 || x+rect.width > innerWidth || y+rect.height > innerHeight) continue;
      candidate={request,value:{scope:{app:frame.name,panel:frame.panel},rect:{x,y,width:rect.width,height:rect.height}}};
      break;
    }
    const nextKey = candidate ? JSON.stringify([candidate.request.id,candidate.value]) : '';
    if (nextKey === presentedKey) return;
    if (presentedSlot) respondSlot(presentedSlot,false);
    presentedSlot=candidate?.request; presentedKey=nextKey;
    const generation=++slotGeneration;
    const current=candidate;
    void Promise.resolve(onChatSlot?.(current?.value ?? null) ?? false).then(accepted=>{
      if (generation !== slotGeneration || !current) return;
      respondSlot(current.request,accepted);
    },()=>{if(generation===slotGeneration && current)respondSlot(current.request,false);});
  };
  const mount=(name:string,panel:string)=>{
    const identity=key(name,panel);let slot=mounts.get(identity);if(slot)return slot;
    const element=document.createElement('section');element.className='app-panel-surface';element.setAttribute('aria-label',name);
    const status=document.createElement('div');status.className='app-panel-status';status.setAttribute('role','status');
    const useStatus=document.createElement('div');useStatus.hidden=true;useStatus.setAttribute('aria-label','App Use');
    useStatus.style.cssText='position:absolute;bottom:0;left:0;right:0;display:none;flex-wrap:wrap;gap:6px 12px;padding:5px 10px;box-sizing:border-box;border-top:1px solid var(--pero-border);background:var(--pero-surface);color:var(--pero-text);font:12px system-ui';
    element.append(status,useStatus);region.append(element);
    slot={region:element,status,useStatus,surface:{...surface,name,panel,visible:false},error:''};mounts.set(identity,slot);return slot;
  };
  const active = (slot:Mount) => frames.get(key(slot.surface.name,slot.surface.panel));
  const context = (frame:Frame) => {
    const value=mounts.get(key(frame.name,frame.panel))?.surface||surface;
    frame.element.contentWindow?.postMessage({type:'pero:app:context',context:{appearance:value.appearance,dark:value.dark,locale:normalizeLocale(value.locale),active:value.visible}},'*');
  };
  const renderPresence = (slot:Mount) => {
    const {surface,useStatus}=slot;
    clearTimeout(slot.presenceExpiry);
    const now = Date.now();
    let nextExpiry = Infinity;
    const chinese = normalizeLocale(surface.locale) === 'zh-CN';
    const reading = new Set(['observe', 'capture', 'verify', 'geometry', 'annotation', 'semantic']);
    useStatus.replaceChildren();
    if(onChat && active(slot)?.ready){
      const capture=document.createElement('button');capture.type='button';capture.textContent=chinese?'截图到对话':'Capture to chat';
      capture.style.cssText='font:inherit;border:1px solid var(--pero-border);border-radius:3px;padding:2px 7px;color:var(--pero-text);background:var(--pero-surface);cursor:pointer';
      capture.onclick=()=>{capture.disabled=true;const frame=active(slot);if(!frame)return;void Promise.resolve(onChat({name:frame.name,panel:frame.panel,options:{capture:true}})).then(()=>{capture.disabled=false;},error=>{capture.disabled=false;const message=document.createElement('span');message.setAttribute('role','alert');message.textContent=error instanceof Error?error.message:String(error);useStatus.append(message);});};
      useStatus.append(capture);
    }
    for (const value of presence.values()) {
      if (value.scope.app !== surface.name || value.scope.panel !== surface.panel) continue;
      const tasks = value.tasks.filter(task => task.expiresAt > now);
      if (!tasks.length && !value.standing.length) continue;
      for (const task of tasks) nextExpiry = Math.min(nextExpiry, task.expiresAt);
      const row = document.createElement('span');
      row.style.cssText = 'display:inline-flex;align-items:center;gap:8px';
      const label = document.createElement('span');
      const operating = tasks.some(task => task.actions.some(action => !reading.has(action)));
      const state = tasks.length ? operating ? chinese ? '正在操作' : 'operating' : chinese ? '正在读取' : 'reading' : chinese ? '允许读取' : 'reading allowed';
      label.textContent = `${value.title || 'Agent'} · ${state}${tasks.length > 1 ? ` (${tasks.length})` : ''}`;
      label.setAttribute('role', 'status');
      const revoke = document.createElement('button');
      revoke.type = 'button'; revoke.textContent = chinese ? '撤销此应用' : 'Revoke App';
      revoke.disabled = !window.peroAppUseRevoke;
      revoke.setAttribute('aria-label', `${chinese ? '撤销' : 'Revoke'} ${value.title || 'Agent'} App Use`);
      revoke.style.cssText = 'font:inherit;border:1px solid var(--pero-border);border-radius:3px;padding:2px 7px;color:var(--pero-text);background:var(--pero-surface);cursor:pointer';
      revoke.onclick = () => {
        if (!window.peroAppUseRevoke) return;
        revoke.disabled = true;
        void window.peroAppUseRevoke(value.thread,value.scope).catch(error => { label.textContent = error instanceof Error ? error.message : String(error); revoke.disabled = false; });
      };
      row.append(label, revoke); useStatus.append(row);
    }
    useStatus.hidden = !useStatus.childElementCount;
    useStatus.style.display = useStatus.hidden ? 'none' : 'flex';
    const height = useStatus.hidden ? 0 : useStatus.getBoundingClientRect().height;
    const frame=active(slot);if(frame)frame.element.style.height=height?`calc(100% - ${height}px)`:'100%';
    if(Number.isFinite(nextExpiry))slot.presenceExpiry=setTimeout(()=>renderPresence(slot),Math.max(1,nextExpiry-now));
  };
  const renderStatus = (slot:Mount) => {
    const {surface,status}=slot;
    const frame = active(slot);
    const message = slot.error || (frame?.failed ? translate(normalizeLocale(surface.locale), 'apps.panel_timeout') : '');
    status.replaceChildren();
    status.hidden = !!frame?.ready && !message;
    if (status.hidden) return;
    const text = document.createElement('span');
    text.textContent = message || translate(normalizeLocale(surface.locale), 'apps.loading_panel');
    status.append(text);
    if (message) {
      const retry = document.createElement('button');
      retry.textContent = translate(normalizeLocale(surface.locale), 'apps.refresh');
      retry.onclick = () => {
        if (!surface.name) return;
        if (frame) { clearTimeout(frame.timer); frame.dispose(); frame.element.remove(); frames.delete(key(frame.name, frame.panel)); slotRequests.delete(frame); reconcileSlot(); }
        slot.error = ''; renderStatus(slot);
        void command({ action: 'apps_open', name: surface.name, panel: surface.panel });
      };
      status.append(retry);
    }
  };
  const update=()=>{
    const visible=[...mounts.values()].filter(slot=>slot.surface.visible);
    region.hidden=!visible.length;
    const left=visible.length?Math.min(...visible.map(slot=>slot.surface.left||0)):0,top=visible.length?Math.min(...visible.map(slot=>slot.surface.top||0)):0;
    const right=Math.max(...visible.map(slot=>(slot.surface.left||0)+(slot.surface.width||0))),bottom=Math.max(...visible.map(slot=>(slot.surface.top||0)+(slot.surface.height||0)));
    region.style.cssText=visible.length?`left:${left}px;top:${top}px;width:${right-left}px;height:${bottom-top}px;pointer-events:none;overflow:visible;background:transparent`:'';
    for(const [name,value] of Object.entries(surface.dark?themes.dark:themes.light))region.style.setProperty(`--pero-${name}`,value);
    if(surface.appearance)applyAppearance(surface.appearance,region);
    for(const slot of mounts.values()) {
      const value=slot.surface;slot.region.hidden=!value.visible;
      slot.region.style.cssText=`position:absolute;left:${(value.left||0)-left}px;top:${(value.top||0)-top}px;width:${value.width||0}px;height:${value.height||0}px;overflow:hidden;pointer-events:auto;color-scheme:${value.dark?'dark':'light'};background:var(--pero-surface)`;
      const frame = active(slot);
      const x = value.left || 0, y = value.top || 0, w = value.width || 0, h = value.height || 0;
      const overlay = chatOverlaySuspended ? null : chatOverlay;
      const x1 = Math.max(0, (overlay?.x ?? 0) - x), y1 = Math.max(0, (overlay?.y ?? 0) - y);
      const x2 = Math.min(w, (overlay?.x ?? 0) + (overlay?.width ?? 0) - x), y2 = Math.min(h, (overlay?.y ?? 0) + (overlay?.height ?? 0) - y);
      const covered = !!overlay && value.visible && x2 > x1 && y2 > y1;
      if (frame) frame.element.dataset.peroChatCovered = String(covered);
      if (covered) slot.region.style.clipPath = `polygon(0 0,100% 0,100% 100%,0 100%,0 ${y1}px,${x1}px ${y1}px,${x1}px ${y2}px,${x2}px ${y2}px,${x2}px ${y1}px,0 ${y1}px)`;
      renderStatus(slot);renderPresence(slot);
    }
    for(const frame of frames.values()) {
      frame.element.hidden=!mounts.get(key(frame.name,frame.panel))?.surface.visible;
      context(frame);
    }
    reconcileSlot();
  };
  const focus=()=>{
    const frame=[...frames.values()].find(frame=>frame.element===document.activeElement);
    const value=frame&&mounts.get(key(frame.name,frame.panel))?.surface;
    if(value?.visible&&value.pane!==undefined&&!value.focused)onFocus?.(value.pane);
  };
  window.addEventListener('blur',()=>queueMicrotask(focus));
  window.addEventListener('focus',focus);
  window.addEventListener('message', event => {
    const frame = [...frames.values()].find(frame => frame.element.contentWindow === event.source);
    if (!frame) return;
    if(event.data?.type==='pero:app:chat-slot') {
      const url=new URL(frame.element.src), origin=`${url.protocol}//${url.host}`;
      const {id,rect}=event.data;
      if(event.origin!==origin || typeof id!=='string' || !id || id.length>128) return;
      const previous=slotRequests.get(frame);
      if(previous && previous.id!==id) respondSlot(previous,false);
      if(rect===null) {
        if(previous?.id===id) slotRequests.delete(frame);
        frame.element.contentWindow?.postMessage({type:'pero:app:chat-slot-result',id,active:false},origin);
      } else if(rect && [rect.x,rect.y,rect.width,rect.height].every((value:unknown)=>typeof value==='number' && Number.isFinite(value))) {
        slotRequests.set(frame,{frame,id,rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height}});
      } else return;
      reconcileSlot();
      if(rect!==null && presentedSlot?.frame!==frame) respondSlot({frame,id,rect},false);
      return;
    }
    if(event.data?.type==='pero:app:document' && typeof event.data.id==='string') {
      const url=new URL(frame.element.src);
      const origin=`${url.protocol}//${url.host}`;
      if(event.origin!==origin || !onDocument)return;
      try {
        onDocument(frame.documents.admit(event.data.document));
        frame.element.contentWindow?.postMessage({type:'pero:app:document-result',id:event.data.id,ok:true},origin);
      } catch(error) {
        frame.element.contentWindow?.postMessage({type:'pero:app:document-result',id:event.data.id,ok:false,error:error instanceof Error?error.message:String(error)},origin);
      }
      return;
    }
    if (event.data?.type === 'pero:app:chat') {
      if (event.data.text !== undefined && (typeof event.data.text !== 'string' || event.data.text.length > 64000)) return;
      const request=event.data;
      void Promise.resolve(onChat?.({name:frame.name,panel:frame.panel,text:request.text,options:request.options})).then(value=>{if(request.id)frame.element.contentWindow?.postMessage({type:'pero:app:chat-result',id:request.id,ok:true,value},'*');},error=>{if(request.id)frame.element.contentWindow?.postMessage({type:'pero:app:chat-result',id:request.id,ok:false,error:error instanceof Error?error.message:String(error)},'*');});
      return;
    }
    if (event.data?.type !== 'pero:app:ready') return;
    clearTimeout(frame.timer); frame.ready = true;
    frame.element.contentWindow?.postMessage({type:'pero:app:icon-theme',theme:iconTheme},'*');
    const slot=mounts.get(key(frame.name,frame.panel));if(slot?.surface.visible&&slot.surface.pane!==undefined&&slot.surface.focused)frame.element.contentWindow?.focus();
    context(frame);update();
  });
  return {
    overlayMatches(rect: AppChatSlot['rect']) {
      if (chatOverlaySuspended || !chatOverlay) return false;
      // GPUI reports the painted area inside the slot border, not its outer box.
      return Math.abs(chatOverlay.x-rect.x)<=2 && Math.abs(chatOverlay.y-rect.y)<=2 &&
        Math.abs(chatOverlay.x+chatOverlay.width-rect.x-rect.width)<=2 &&
        Math.abs(chatOverlay.y+chatOverlay.height-rect.y-rect.height)<=2;
    },
    overlay(value: {x:number;y:number;width:number;height:number}|null) {
      if (JSON.stringify(chatOverlay) === JSON.stringify(value)) return;
      chatOverlay=value; update();
    },
    suspendChatOverlay(value: boolean) { chatOverlaySuspended=value; update(); },
    surface(value: AppSurface|AppSurfaceBatch) {
      surface={visible:false,dark:value.dark,locale:value.locale,appearance:value.appearance};
      const previous=new Map([...mounts].map(([id,slot])=>[id,slot.surface]));
      for(const slot of mounts.values())slot.surface={...slot.surface,...surface};
      const values='surfaces' in value?value.surfaces:[value];
      for(const item of values)if(item.name&&item.panel) {
        const slot=mount(item.name,item.panel);const before=previous.get(key(item.name,item.panel));
        slot.surface={...surface,...item};
        if(item.pane!==undefined&&item.focused&&(!before?.focused||!before?.visible)&&item.visible)active(slot)?.element.contentWindow?.focus();
      }
      if(value.open)for(const [identity,slot] of mounts) {
        if(value.open.some(item=>key(item.name,item.panel)===identity))continue;
        const frame=frames.get(identity);if(frame){clearTimeout(frame.timer);frame.dispose();frame.element.remove();frames.delete(identity);slotRequests.delete(frame);}
        clearTimeout(slot.presenceExpiry);slot.region.remove();mounts.delete(identity);
      }
      update();
    },
    event(event: HostEvent) {
      preparation.event(event);
      if (event.kind === 'apps_preparation') {
        const value = event.data as { name: string; phase: string };
        if (value.phase === 'ready') for (const slot of mounts.values()) {
          if (slot.surface.name === value.name && slot.error && slot.surface.visible) {
            slot.error = ''; renderStatus(slot);
            void command({ action: 'apps_open', name: value.name, panel: slot.surface.panel });
          }
        }
      }
      if(event.kind==='icon_themes'||event.kind==='icon_themes_error'){iconTheme=(event.data as {theme:IconThemePackage|null}).theme;for(const frame of frames.values())frame.element.contentWindow?.postMessage({type:'pero:app:icon-theme',theme:iconTheme},'*');}
      if(event.kind==='app_written'){for(const frame of frames.values())if(frame.name===(event.data as {app:string}).app)frame.element.contentWindow?.postMessage({type:'pero:app:data-changed'},'*');}
      if (event.kind === 'apps_opened') {
        const value = event.data as { name: string; panel: string; url: string };
        const identity = key(value.name, value.panel);
        const slot=mount(value.name,value.panel);
        if (!frames.has(identity)) {
          const element = document.createElement('iframe');
          element.title = value.name;
          element.allow = 'clipboard-write';
          element.sandbox.add('allow-scripts', 'allow-same-origin', 'allow-downloads', 'allow-popups');
          const frame: Frame = { documents:new AppDocuments(value.name,value.panel),element, name: value.name, panel: value.panel, ready: false, failed: false, dispose: () => {}, timer: setTimeout(() => {
            frame.failed = true;
            renderStatus(slot);
          }, 15000) };
          frames.set(identity, frame);
          element.src = value.url;
          frame.dispose = appUse.register(element, frame.name, frame.panel, () => frame.ready && slot.surface.visible);
          slot.region.prepend(element);
        }
        slot.error = ''; update();
      } else if (event.kind === 'apps_error') {
        const slot=[...mounts.values()].find(slot=>slot.surface.visible&&slot.surface.focused)||[...mounts.values()].find(slot=>slot.surface.visible);if(slot){slot.error=event.text;renderStatus(slot);}
      } else if (event.kind === 'apps_catalog') {
        const catalog = event.data as { name: string; enabled: boolean }[];
        for (const [identity, frame] of frames) {
          if (!catalog.some(app => app.name === frame.name && app.enabled)) {
            clearTimeout(frame.timer); frame.dispose(); frame.element.remove(); frames.delete(identity); slotRequests.delete(frame);
          }
        }
        update();
      } else if (event.kind === 'app_use_presence' && event.thread_id) {
        const value = event.data as AppUsePresence;
        presence.set(JSON.stringify([event.thread_id, value.scope.app, value.scope.panel]), { ...value, thread: event.thread_id }); for(const slot of mounts.values())renderPresence(slot);
      } else if (event.kind === 'disconnected') {
        for (const frame of frames.values()) { clearTimeout(frame.timer); frame.dispose(); frame.element.remove(); }
        frames.clear(); slotRequests.clear(); reconcileSlot();
        presence.clear(); for(const slot of mounts.values())renderPresence(slot);
        for(const slot of mounts.values())if(slot.surface.visible){slot.error=translate(normalizeLocale(surface.locale),'error.connection');renderStatus(slot);}
      }
    },
  };
}

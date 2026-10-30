import { translate, normalizeLocale } from '../../locales';
import type { HostEvent } from './bootstrap';
import themes from './theme.generated.json';
import { applyAppearance, type AppearanceSnapshot } from '../../packages/app-sdk/src/appearance';
import { mountAppUseFrames } from './app-use';
import { AppDocuments } from '../../packages/content-source/app-document';
import type { DocumentHeader } from '../../protocol/generated/host';

export type AppSurface = { visible: boolean; name?: string; panel?: string; left?: number; top?: number; width?: number; height?: number; dark: boolean; locale: string; appearance?: AppearanceSnapshot };
type Frame = { documents:AppDocuments; element: HTMLIFrameElement; name: string; panel: string; ready: boolean; failed: boolean; timer: ReturnType<typeof setTimeout>; dispose(): void };
type AppUsePresence = { scope: { app: string; panel: string }; title?: string; standing: string[]; tasks: { id: string; actions: string[]; expiresAt: number }[] };

/** Retains App documents across navigation; GPUI owns selection and layout. */
export function mountAppSurfaces(command: (value: object) => Promise<void>, onChat?: (context: { name: string; panel: string; text?: string;options?:unknown }) => void|Promise<unknown>, onDocument?:(value:{header:DocumentHeader;text:string})=>void) {
  const frames = new Map<string, Frame>();
  const appUse = mountAppUseFrames();
  const presence = new Map<string, AppUsePresence & { thread: string }>();
  let presenceExpiry: ReturnType<typeof setTimeout> | undefined;
  const region = document.createElement('section');
  region.id = 'pero-app-surface';
  region.setAttribute('aria-label', 'App');
  region.hidden = true;
  const status = document.createElement('div');
  status.className = 'app-panel-status';
  status.setAttribute('role', 'status');
  region.append(status);
  const useStatus = document.createElement('div');
  useStatus.hidden = true;
  useStatus.setAttribute('aria-label', 'App Use');
  useStatus.style.cssText = 'position:absolute;bottom:0;left:0;right:0;display:none;flex-wrap:wrap;gap:6px 12px;padding:5px 10px;box-sizing:border-box;border-top:1px solid var(--pero-border);background:var(--pero-surface);color:var(--pero-text);font:12px system-ui';
  region.append(useStatus);
  document.body.append(region);
  let surface: AppSurface = { visible: false, dark: false, locale: 'en' };
  let error = '';
  const key = (name?: string, panel?: string) => `${name}:${panel}`;
  const active = () => frames.get(key(surface.name, surface.panel));
  const context = (frame: Frame) => frame.element.contentWindow?.postMessage({ type: 'pero:app:context', context: {
    appearance: surface.appearance, dark: surface.dark, locale: normalizeLocale(surface.locale), active: surface.visible && frame === active(),
  } }, '*');
  const renderPresence = () => {
    clearTimeout(presenceExpiry);
    const now = Date.now();
    let nextExpiry = Infinity;
    const chinese = normalizeLocale(surface.locale) === 'zh-CN';
    const reading = new Set(['observe', 'capture', 'verify', 'geometry', 'annotation', 'semantic']);
    useStatus.replaceChildren();
    if(onChat && active()?.ready){
      const capture=document.createElement('button');capture.type='button';capture.textContent=chinese?'截图到对话':'Capture to chat';
      capture.style.cssText='font:inherit;border:1px solid var(--pero-border);border-radius:3px;padding:2px 7px;color:var(--pero-text);background:var(--pero-surface);cursor:pointer';
      capture.onclick=()=>{capture.disabled=true;const frame=active();if(!frame)return;void Promise.resolve(onChat({name:frame.name,panel:frame.panel,options:{capture:true}})).then(()=>{capture.disabled=false;},error=>{capture.disabled=false;const message=document.createElement('span');message.setAttribute('role','alert');message.textContent=error instanceof Error?error.message:String(error);useStatus.append(message);});};
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
    for (const frame of frames.values()) frame.element.style.height = height ? `calc(100% - ${height}px)` : '100%';
    if (Number.isFinite(nextExpiry)) presenceExpiry = setTimeout(renderPresence, Math.max(1, nextExpiry - now));
  };
  const renderStatus = () => {
    const frame = active();
    const message = error || (frame?.failed ? translate(normalizeLocale(surface.locale), 'apps.panel_timeout') : '');
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
        if (frame) { clearTimeout(frame.timer); frame.dispose(); frame.element.remove(); frames.delete(key(frame.name, frame.panel)); }
        error = ''; renderStatus();
        void command({ action: 'apps_open', name: surface.name, panel: surface.panel });
      };
      status.append(retry);
    }
  };
  const update = () => {
    region.hidden = !surface.visible;
    region.style.cssText = `left:${surface.left || 0}px;top:${surface.top || 0}px;width:${surface.width || 0}px;height:${surface.height || 0}px;color-scheme:${surface.dark ? 'dark' : 'light'}`;
    for (const [name, value] of Object.entries(surface.dark ? themes.dark : themes.light)) region.style.setProperty(`--pero-${name}`, value);
    if (surface.appearance) applyAppearance(surface.appearance, region);
    for (const frame of frames.values()) {
      frame.element.hidden = !surface.visible || frame !== active();
      context(frame);
    }
    renderStatus();
    renderPresence();
  };
  window.addEventListener('message', event => {
    const frame = [...frames.values()].find(frame => frame.element.contentWindow === event.source);
    if (!frame) return;
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
    context(frame); renderStatus();renderPresence();
  });
  return {
    surface(value: AppSurface) {
      if (key(surface.name, surface.panel) !== key(value.name, value.panel)) error = '';
      surface = value;
      update();
    },
    event(event: HostEvent) {
      if(event.kind==='app_written'){for(const frame of frames.values())if(frame.name===(event.data as {app:string}).app)frame.element.contentWindow?.postMessage({type:'pero:app:data-changed'},'*');}
      if (event.kind === 'apps_opened') {
        const value = event.data as { name: string; panel: string; url: string };
        const identity = key(value.name, value.panel);
        if (!frames.has(identity)) {
          const element = document.createElement('iframe');
          element.title = value.name;
          element.allow = 'clipboard-write';
          element.sandbox.add('allow-scripts', 'allow-same-origin', 'allow-downloads', 'allow-popups');
          const frame: Frame = { documents:new AppDocuments(value.name,value.panel),element, name: value.name, panel: value.panel, ready: false, failed: false, dispose: () => {}, timer: setTimeout(() => {
            frame.failed = true;
            if (frame === active()) renderStatus();
          }, 15000) };
          frames.set(identity, frame);
          element.src = value.url;
          frame.dispose = appUse.register(element, frame.name, frame.panel, () => frame.ready && surface.visible && frame === active());
          region.prepend(element);
        }
        error = ''; update();
      } else if (event.kind === 'apps_error' && surface.visible) {
        error = event.text; renderStatus();
      } else if (event.kind === 'apps_catalog') {
        const catalog = event.data as { name: string; enabled: boolean }[];
        for (const [identity, frame] of frames) {
          if (!catalog.some(app => app.name === frame.name && app.enabled)) {
            clearTimeout(frame.timer); frame.dispose(); frame.element.remove(); frames.delete(identity);
          }
        }
        update();
      } else if (event.kind === 'app_use_presence' && event.thread_id) {
        const value = event.data as AppUsePresence;
        presence.set(JSON.stringify([event.thread_id, value.scope.app, value.scope.panel]), { ...value, thread: event.thread_id }); renderPresence();
      } else if (event.kind === 'disconnected') {
        for (const frame of frames.values()) { clearTimeout(frame.timer); frame.dispose(); frame.element.remove(); }
        frames.clear();
        presence.clear(); renderPresence();
        if (surface.visible) { error = translate(normalizeLocale(surface.locale), 'error.connection'); renderStatus(); }
      }
    },
  };
}

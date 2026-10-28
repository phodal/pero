import { translate, normalizeLocale } from '../../locales';
import type { HostEvent } from './bootstrap';
import themes from './theme.generated.json';

export type AppSurface = { visible: boolean; name?: string; panel?: string; left?: number; top?: number; width?: number; height?: number; dark: boolean; locale: string };
type Frame = { element: HTMLIFrameElement; name: string; panel: string; ready: boolean; failed: boolean; timer: ReturnType<typeof setTimeout> };

/** Retains App documents across navigation; GPUI owns selection and layout. */
export function mountAppSurfaces(command: (value: object) => Promise<void>) {
  const frames = new Map<string, Frame>();
  const region = document.createElement('section');
  region.id = 'pero-app-surface';
  region.setAttribute('aria-label', 'App');
  region.hidden = true;
  const status = document.createElement('div');
  status.className = 'app-panel-status';
  status.setAttribute('role', 'status');
  region.append(status);
  document.body.append(region);
  let surface: AppSurface = { visible: false, dark: false, locale: 'en' };
  let error = '';
  const key = (name?: string, panel?: string) => `${name}:${panel}`;
  const active = () => frames.get(key(surface.name, surface.panel));
  const context = (frame: Frame) => frame.element.contentWindow?.postMessage({ type: 'pero:app:context', context: {
    dark: surface.dark, locale: normalizeLocale(surface.locale), active: surface.visible && frame === active(),
  } }, '*');
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
        if (frame) { clearTimeout(frame.timer); frame.element.remove(); frames.delete(key(frame.name, frame.panel)); }
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
    for (const frame of frames.values()) {
      frame.element.hidden = !surface.visible || frame !== active();
      context(frame);
    }
    renderStatus();
  };
  window.addEventListener('message', event => {
    if (event.data?.type !== 'pero:app:ready') return;
    const frame = [...frames.values()].find(frame => frame.element.contentWindow === event.source);
    if (!frame) return;
    clearTimeout(frame.timer); frame.ready = true;
    context(frame); renderStatus();
  });
  return {
    surface(value: AppSurface) {
      if (key(surface.name, surface.panel) !== key(value.name, value.panel)) error = '';
      surface = value;
      update();
    },
    event(event: HostEvent) {
      if (event.kind === 'apps_opened') {
        const value = event.data as { name: string; panel: string; url: string };
        const identity = key(value.name, value.panel);
        if (!frames.has(identity)) {
          const element = document.createElement('iframe');
          element.title = value.name;
          element.sandbox.add('allow-scripts', 'allow-same-origin', 'allow-downloads', 'allow-popups');
          const frame: Frame = { element, name: value.name, panel: value.panel, ready: false, failed: false, timer: setTimeout(() => {
            frame.failed = true;
            if (frame === active()) renderStatus();
          }, 15000) };
          frames.set(identity, frame);
          element.src = value.url;
          region.prepend(element);
        }
        error = ''; update();
      } else if (event.kind === 'apps_error' && surface.visible) {
        error = event.text; renderStatus();
      } else if (event.kind === 'apps_catalog') {
        const catalog = event.data as { name: string; enabled: boolean }[];
        for (const [identity, frame] of frames) {
          if (!catalog.some(app => app.name === frame.name && app.enabled)) {
            clearTimeout(frame.timer); frame.element.remove(); frames.delete(identity);
          }
        }
        update();
      } else if (event.kind === 'disconnected') {
        for (const frame of frames.values()) { clearTimeout(frame.timer); frame.element.remove(); }
        frames.clear();
        if (surface.visible) { error = translate(normalizeLocale(surface.locale), 'error.connection'); renderStatus(); }
      }
    },
  };
}

export type AppUseScope = { app: string; panel: string };
export type AppUseRequest = {
  action: 'inventory' | 'status' | 'geometry' | 'annotation' | 'observe' | 'semantic' | 'invoke' | 'verify' | 'dom.click' | 'dom.fill';
  instance?: string;
  surfaceId?: string;
  target?: string;
  [key: string]: unknown;
};
export type AppUseReply = { ok: true; value: unknown } | { ok: false; error: { code: string; message: string } };
type Rect = { x: number; y: number; width: number; height: number };
type Surface = { element: HTMLIFrameElement; scope: AppUseScope; origin: string; instance: string; active(): boolean; humanInput: number };
type Pending = { surface: Surface; resolve(reply: AppUseReply): void; timer: ReturnType<typeof setTimeout> };

declare global {
  interface Window {
    peroAppUse(input: { scope?: AppUseScope; request: AppUseRequest }): Promise<AppUseReply>;
    peroAppUseRevoke?: (thread: string,scope?:AppUseScope) => Promise<void>;
    peroAppUseThread?: () => string | undefined | Promise<string | undefined>;
  }
}

const fail = (code: string, message: string): AppUseReply => ({ ok: false, error: { code, message } });

/** Only parent-owned frames are addressable. App documents never choose their identity. */
export function mountAppUseFrames() {
  const surfaces = new Set<Surface>();
  const pending = new Map<string, Pending>();
  const describe = (surface: Surface) => {
    const box = surface.element.getBoundingClientRect();
    const x = Math.max(0, Math.ceil(box.x)), y = Math.max(0, Math.ceil(box.y));
    const rect = { x, y, width: Math.max(0, Math.floor(Math.min(innerWidth, box.right)) - x), height: Math.max(0, Math.floor(Math.min(innerHeight, box.bottom)) - y) };
    const style = getComputedStyle(surface.element);
    const visible = surface.element.isConnected && !surface.element.hidden && rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility === 'visible';
    const active = surface.active();
    const uncovered = visible && document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2) === surface.element;
    return { surfaceId: `${surface.scope.app}:${surface.scope.panel}`, ...surface.scope, instance: surface.instance,
      visible, active, capturable: active && visible && uncovered, operable: active && visible && uncovered && performance.now() - surface.humanInput >= 1000, rect };
  };
  const invalidate = (surface: Surface) => {
    for (const [id, request] of pending) {
      if (request.surface !== surface) continue;
      clearTimeout(request.timer); pending.delete(id);
      request.resolve(fail('APP_SURFACE_REPLACED', 'The App document changed. Observe the current panel before continuing.'));
    }
  };
  window.addEventListener('message', event => {
    const surface = [...surfaces].find(surface => event.source === surface.element.contentWindow && event.origin === surface.origin);
    if (!surface) return;
    if (event.data?.type === 'pero:app-use:human-input') {
      surface.humanInput = performance.now();
      return;
    }
    if (event.data?.type !== 'pero:app-use:result' || typeof event.data.id !== 'string') return;
    const request = pending.get(event.data.id);
    if (!request || request.surface !== surface) return;
    clearTimeout(request.timer); pending.delete(event.data.id);
    if (event.data.ok === true) request.resolve({ ok: true, value: event.data.value });
    else if (event.data.ok === false && typeof event.data.error?.code === 'string' && typeof event.data.error?.message === 'string') {
      request.resolve({ ok: false, error: { code: event.data.error.code, message: event.data.error.message } });
    } else request.resolve(fail('APP_USE_PROTOCOL', 'The App returned an invalid App Use reply.'));
  });
  const call = async (scope: AppUseScope | undefined, request: AppUseRequest): Promise<AppUseReply> => {
    const matches = [...surfaces].filter(surface => (!scope || surface.scope.app === scope.app && surface.scope.panel === scope.panel)
      && (!request.surfaceId || request.surfaceId === `${surface.scope.app}:${surface.scope.panel}`));
    if (request.action === 'inventory') return { ok: true, value: { surfaces: matches.map(describe) } };
    if (!scope && !request.surfaceId) return fail('APP_SURFACE_REQUIRED', 'Choose a surfaceId from the App Use inventory.');
    const surface = matches[0];
    if (!surface?.element.isConnected) return fail('APP_SURFACE_UNAVAILABLE', 'Open the App panel before using App Use.');
    if (request.instance && request.instance !== surface.instance) return fail('APP_SURFACE_REPLACED', 'The App document changed. Observe the current panel before continuing.');
    const status = describe(surface);
    if (request.action === 'status' || request.action === 'geometry' && !request.target) return { ok: true, value: status };
    if (request.action === 'invoke' || request.action === 'dom.click' || request.action === 'dom.fill') {
      if (!status.active || !status.visible) return fail('APP_SURFACE_HIDDEN', 'Show this App panel before operating it.');
      if (performance.now() - surface.humanInput < 1000) return fail('APP_USER_ACTIVE', 'The user is operating this App. Wait for them to finish before continuing.');
      if (!status.operable) return fail('APP_SURFACE_COVERED', 'This App panel is covered. Show it before operating it.');
    }
    const instance = surface.instance;
    const reply = await new Promise<AppUseReply>(resolve => {
      const id = crypto.randomUUID();
      const timer = setTimeout(() => {
        pending.delete(id);
        resolve(fail('APP_USE_TIMEOUT', 'The App did not answer within 15 seconds. Observe its current state before retrying.'));
      }, 15000);
      pending.set(id, { surface, resolve, timer });
      surface.element.contentWindow!.postMessage({ type: 'pero:app-use:request', id, request }, surface.origin);
    });
    if (surface.instance !== instance || !surfaces.has(surface)) return fail('APP_SURFACE_REPLACED', 'The App document changed. Observe the current panel before continuing.');
    if (reply.ok && (request.action === 'geometry' || request.action === 'annotation')) {
      const value = reply.value as { rect?: Rect };
      const local = value?.rect;
      if (!local || ![local.x, local.y, local.width, local.height].every(Number.isFinite) || local.x < 0 || local.y < 0 || local.width <= 0 || local.height <= 0) return fail('APP_GEOMETRY_INVALID', 'The App returned invalid capture geometry.');
      // App-supplied geometry can only narrow the parent-owned frame's capture area.
      const box = surface.element.getBoundingClientRect();
      const x = Math.ceil(Math.max(0, box.x, box.x + local.x)), y = Math.ceil(Math.max(0, box.y, box.y + local.y));
      const width = Math.floor(Math.min(innerWidth, box.right, box.x + local.x + local.width)) - x;
      const height = Math.floor(Math.min(innerHeight, box.bottom, box.y + local.y + local.height)) - y;
      if (width <= 0 || height <= 0) return fail('APP_OBJECT_NOT_RENDERED', 'The App target is outside its visible frame.');
      return { ok: true, value: { ...value, rect: { x, y, width, height }, instance } };
    }
    return reply;
  };
  window.peroAppUse = input => call(input.scope, input.request);
  return {
    call,
    register(element: HTMLIFrameElement, app: string, panel: string, active: () => boolean) {
      const url = new URL(element.src);
      const surface: Surface = { element, scope: { app, panel }, origin: `${url.protocol}//${url.host}`, instance: crypto.randomUUID(), active, humanInput: -Infinity };
      const loaded = () => { invalidate(surface); surface.instance = crypto.randomUUID(); surface.humanInput = -Infinity; };
      surfaces.add(surface); element.addEventListener('load', loaded);
      return () => { invalidate(surface); surfaces.delete(surface); element.removeEventListener('load', loaded); };
    },
  };
}

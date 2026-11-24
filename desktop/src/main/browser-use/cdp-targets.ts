import { webOrigin } from '../../../../packages/chrome-extension/src/protocol.ts';
import { ChromiumCdp } from './cdp.ts';
import { CdpTargetEvents } from './cdp-target-events.ts';
import type { BrowserDiagnosticApproval } from './diagnostics.ts';
import { cdpTargetEventRequest } from './cdp-events.ts';
import type { CdpTargetEventMethod, CdpTargetRequest } from './request.ts';

type ChildInfo = { targetId: string; type: string; url: string };
type Attachment = { sessionId: string; url: string; parent?: string };
type ChildDocument = { id: string; loaderId: string; url: string };
type Child = { targetId: string; document: ChildDocument; origin: string };
type Discovered = { path: readonly Child[]; cdp?: ChromiumCdp };
type RouteStep = { child: Child; attachment: Attachment; attachedUrl: string };
export type SessionCdpSend = (method: string, params?: Record<string, unknown>, sessionId?: string) => Promise<unknown>;
export type SessionCdpSubscribe = (receive: (method: string, params: Record<string, unknown>, parent?: string) => void) => () => void;

export function cdpTargetOrigins(request: CdpTargetRequest, origin: string) {
  return request.action === 'cdpListTargets' || cdpTargetEventRequest(request)
    ? [...new Set([origin, ...(request.fromOrigins ?? [])])] : [request.target.origin];
}

export async function approveCdpTargets(request: CdpTargetRequest, origin: string, thread: string,
  signal: AbortSignal, approve: BrowserDiagnosticApproval) {
  let active = signal;
  for (const source of cdpTargetOrigins(request, origin)) active = await approve(thread, source, active);
  active.throwIfAborted();
  return active;
}

/** Flat Chromium child sessions shared by commands and a live capture. */
class ChildSessions {
  readonly children = new Map<string, Attachment>();
  private changed?: () => void;
  private readonly enabled = new Set<string | undefined>();
  private readonly unsubscribe: () => void;

  constructor(readonly send: SessionCdpSend, readonly subscribe: SessionCdpSubscribe,
    onChange: Parameters<SessionCdpSubscribe>[0], onTarget: (method: CdpTargetEventMethod, attachment: Attachment) => void) {
    this.unsubscribe = subscribe((method, params, parent) => {
      if (method === 'Target.attachedToTarget') {
        const { targetInfo, sessionId } = params as { targetInfo: ChildInfo; sessionId: string };
        if (targetInfo.type === 'iframe') {
          const child = { sessionId, url: targetInfo.url, parent };
          this.children.set(targetInfo.targetId, child);
          onTarget(method, child);
        }
      } else if (method === 'Target.targetInfoChanged') {
        const { targetInfo } = params as { targetInfo: ChildInfo };
        const child = this.children.get(targetInfo.targetId);
        if (child) {
          child.url = targetInfo.url;
          onTarget(method, child);
        }
      } else if (method === 'Target.detachedFromTarget') {
        for (const [id, child] of this.children) if (child.sessionId === params.sessionId) {
          this.children.delete(id);
          this.enabled.delete(child.sessionId);
          onTarget(method, child);
        }
      } else if (method !== 'Page.frameNavigated' && method !== 'Page.navigatedWithinDocument') return;
      this.changed?.();
      onChange(method, params, parent);
    });
  }

  async document(targetId: string, attachment: Attachment, origin: string, check: () => void) {
    check();
    if (this.children.get(targetId) !== attachment || webOrigin(attachment.url) !== origin)
      throw new Error('The CDP child target is stale. List targets again.');
    const { frameTree } = await this.send('Page.getFrameTree', undefined, attachment.sessionId) as {
      frameTree: { frame: ChildDocument };
    };
    check();
    const frame = frameTree.frame;
    if (this.children.get(targetId) !== attachment || webOrigin(frame.url) !== origin || webOrigin(attachment.url) !== origin)
      throw new Error('The CDP child target changed origin. List targets again.');
    return frame;
  }

  async attach(parent: string | undefined, check: () => void, signal: AbortSignal) {
    check();
    if (this.enabled.has(parent)) return;
    this.enabled.add(parent);
    await this.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true,
      filter: [{ type: 'iframe', exclude: false }] }, parent);
    const pending = () => [...this.children.values()].some(child => child.parent === parent && child.url === '');
    if (pending() && !signal.aborted) await new Promise<void>(resolve => {
      const finish = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', finish);
        this.changed = undefined;
        resolve();
      };
      const timer = setTimeout(finish, 1000);
      this.changed = () => { if (!pending()) finish(); };
      signal.addEventListener('abort', finish, { once: true });
    });
    check();
  }

  async close() {
    this.unsubscribe();
    for (const parent of [...this.enabled].reverse())
      await this.send('Target.setAutoAttach', { autoAttach: false, waitForDebuggerOnStart: false, flatten: true }, parent).catch(() => {});
  }
}

/** Keeps public target identifiers bound to one discovered child document. */
export class ChromiumCdpTargets {
  private document?: string;
  private targets = new Map<string, Discovered>();
  private sessions?: ChildSessions;
  private closing?: Promise<void>;
  private busy = false;
  private live?: { id: string; target: string; cdp: ChromiumCdp; route: readonly RouteStep[] };
  private detached?: { id: string; target: string; cdp: ChromiumCdp };
  private events?: CdpTargetEvents;

  stopCapture(id?: string) {
    if (id && this.events?.id === id) this.events.stop();
    if (this.detached && (!id || this.detached.id === id)) {
      void this.detached.cdp.stopCapture(id);
      this.detached = undefined;
    }
    if (!id || this.live?.id === id) return this.live?.cdp.stopCapture(id);
  }

  invalidate() {
    this.document = undefined;
    this.targets.clear();
    this.events?.stop();
    void this.stopCapture();
    void this.release();
  }

  private release() {
    if (this.busy || this.live || this.events || !this.sessions) return this.closing;
    const sessions = this.sessions;
    this.sessions = undefined;
    return this.closing = sessions.close().finally(() => { this.closing = undefined; });
  }

  async call(request: CdpTargetRequest, document: string, origin: string, send: SessionCdpSend,
    subscribe: SessionCdpSubscribe, check: () => void, signal: AbortSignal, captureId?: string) {
    if (this.document !== document) {
      this.invalidate();
      await this.stopCapture();
      this.document = document;
    }
    this.busy = true;
    try {
      await this.closing;
      check();
      const events = cdpTargetEventRequest(request) ? request : undefined;
      const target = request.action === 'cdpListTargets' ? undefined : request.target;
      const discovered = target && this.targets.get(target.id);
      if (target && discovered?.path.at(-1)?.origin !== target.origin)
        throw new Error('The CDP child target is stale. List targets again.');
      if (target && request.action !== 'cdpListTargets' && this.detached?.target === target.id) {
        if (request.action === 'cdpReadEvents') {
          const result = this.detached.cdp.readDetachedEvents(request);
          if (result) return { ...result, target };
        } else if (request.command.method === 'Network.disable') {
          this.stopCapture(this.detached.id);
          return { kind: 'cdpResult', method: request.command.method, result: {}, target };
        }
        throw new Error('The CDP child target is detached. List targets again.');
      }
      const sessions = this.sessions ??= new ChildSessions(send, subscribe, (method, params, session) => {
        const active = this.live;
        if (!active || this.detached?.id === active.id) return;
        if (method === 'Target.detachedFromTarget' && active.route.some(step => step.attachment.sessionId === params.sessionId)
            && active.cdp.detachCapture()) {
          this.detached = { id: active.id, target: active.target, cdp: active.cdp };
          return;
        }
        if (active.route.some(({ child, attachment, attachedUrl }) => {
          if (sessions.children.get(child.targetId) !== attachment || attachment.url !== attachedUrl) return true;
          if (session !== attachment.sessionId) return false;
          if (method === 'Page.frameNavigated') {
            const frame = params.frame as ChildDocument;
            return frame.id === child.document.id && (frame.loaderId !== child.document.loaderId || frame.url !== child.document.url);
          }
          return method === 'Page.navigatedWithinDocument' && params.frameId === child.document.id;
        })) void this.stopCapture();
      }, (method, attachment) => this.events?.observe(method, attachment));
      if (events) {
        const origins = cdpTargetOrigins(events, origin);
        if (events.after) {
          if (!this.events) throw new Error('The CDP target event stream ended. Read events again without a cursor.');
          return await this.events.read(events, origins);
        }
        this.events?.stop();
        const stream = this.events = new CdpTargetEvents(captureId ?? crypto.randomUUID(), origins, signal, () => {
          this.events = undefined;
          void this.release();
        });
        for (const attachment of sessions.children.values()) stream.observe('Target.attachedToTarget', attachment);
        try {
          await sessions.attach(undefined, check, signal);
          return await stream.read(events, origins);
        } catch (error) {
          stream.stop();
          throw error;
        }
      }
      await sessions.attach(undefined, check, signal);
      if (request.action === 'cdpListTargets') {
        await this.stopCapture();
        const origins = cdpTargetOrigins(request, origin);
        const next = new Map<string, Discovered>();
        const targets: { id: string; type: 'iframe'; origin: string; url: string; parentId?: string }[] = [];
        let truncated = false;
        const discover = async (path: readonly Child[], parent?: string, parentId?: string) => {
          for (const [targetId, attachment] of [...sessions.children]) {
            if (attachment.parent !== parent) continue;
            const source = webOrigin(attachment.url);
            if (!source || !origins.includes(source)) continue;
            if (targets.length >= 24) { truncated = true; return; }
            const frame = await sessions.document(targetId, attachment, source, check);
            const id = crypto.randomUUID();
            const branch = [...path, { targetId, origin: source, document: frame }];
            next.set(id, { path: branch });
            targets.push({ id, type: 'iframe', origin: source, url: (source + new URL(frame.url).pathname).slice(0, 1024),
              ...(parentId && { parentId }) });
            if (branch.length < (request.depth ?? 1)) {
              await sessions.attach(attachment.sessionId, check, signal);
              await discover(branch, attachment.sessionId, id);
            }
          }
        };
        await discover([]);
        this.targets = next;
        return { kind: 'cdpTargets', targets, truncated };
      }
      if (!target || !discovered) throw new Error('The CDP child target is unavailable.');
      const verify = async ({ targetId, origin: source, document: before }: Child, attachment: Attachment) => {
        const frame = await sessions.document(targetId, attachment, source, check);
        if (frame.id !== before.id || frame.loaderId !== before.loaderId || frame.url !== before.url)
          throw new Error('The CDP child document changed. List targets again.');
      };
      const route: RouteStep[] = [];
      let parent: string | undefined;
      for (const [index, child] of discovered.path.entries()) {
        const attachment = sessions.children.get(child.targetId);
        if (!attachment || attachment.parent !== parent) throw new Error('The CDP child target is stale. List targets again.');
        await verify(child, attachment);
        route.push({ child, attachment, attachedUrl: attachment.url });
        parent = attachment.sessionId;
        if (index < discovered.path.length - 1) await sessions.attach(parent, check, signal);
      }
      const { child, attachment } = route.at(-1)!;
      const cdp = discovered.cdp ??= new ChromiumCdp();
      const startsCapture = request.action === 'cdpSend' && request.command.method === 'Network.enable';
      const id = startsCapture ? captureId ?? crypto.randomUUID() : undefined;
      if (id) {
        await this.stopCapture();
        for (const step of route) await sessions.send('Page.enable', undefined, step.attachment.sessionId);
        for (const step of route) await verify(step.child, step.attachment);
        this.live = { id, target: target.id, cdp, route };
      }
      try {
        const result = await cdp.call(request, child.document.loaderId, child.origin,
          (method, params) => sessions.send(method, params, attachment.sessionId), listener => sessions.subscribe((method, params, session) => {
            if (session === attachment.sessionId) listener(method, params);
          }), check, signal, id, () => this.captureEnded(id));
        for (const step of route) await verify(step.child, step.attachment);
        return { ...result, target };
      } catch (error) {
        if (id) { await this.stopCapture(id); this.captureEnded(id); }
        throw error;
      }
    } finally {
      this.busy = false;
      await this.release();
    }
  }

  private captureEnded(id?: string) {
    if (id && this.live?.id === id) this.live = undefined;
    void this.release();
  }
}

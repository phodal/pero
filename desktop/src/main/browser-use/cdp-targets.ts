import { webOrigin } from '../../../../packages/chrome-extension/src/protocol.ts';
import { ChromiumCdp } from './cdp.ts';
import type { BrowserDiagnosticApproval } from './diagnostics.ts';
import type { CdpTargetRequest } from './request.ts';

type ChildInfo = { targetId: string; type: string; url: string };
type Attachment = { sessionId: string; url: string; parent?: string };
type ChildDocument = { id: string; loaderId: string; url: string };
type Child = { targetId: string; document: ChildDocument; origin: string };
type Discovered = { path: readonly Child[]; cdp?: ChromiumCdp };
type RouteStep = { child: Child; attachment: Attachment; attachedUrl: string };
export type SessionCdpSend = (method: string, params?: Record<string, unknown>, sessionId?: string) => Promise<unknown>;
export type SessionCdpSubscribe = (receive: (method: string, params: Record<string, unknown>, parent?: string) => void) => () => void;

export function cdpTargetOrigins(request: CdpTargetRequest, origin: string) {
  return request.action === 'cdpListTargets' ? [...new Set([origin, ...(request.fromOrigins ?? [])])] : [request.target.origin];
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
    onChange: Parameters<SessionCdpSubscribe>[0]) {
    this.unsubscribe = subscribe((method, params, parent) => {
      if (method === 'Target.attachedToTarget') {
        const { targetInfo, sessionId } = params as { targetInfo: ChildInfo; sessionId: string };
        if (targetInfo.type === 'iframe') this.children.set(targetInfo.targetId, { sessionId, url: targetInfo.url, parent });
      } else if (method === 'Target.targetInfoChanged') {
        const { targetInfo } = params as { targetInfo: ChildInfo };
        const child = this.children.get(targetInfo.targetId);
        if (child) child.url = targetInfo.url;
      } else if (method === 'Target.detachedFromTarget') {
        for (const [id, child] of this.children) if (child.sessionId === params.sessionId) this.children.delete(id);
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
  private live?: { id: string; cdp: ChromiumCdp; route: readonly RouteStep[] };

  stopCapture(id?: string) {
    if (!id || this.live?.id === id) return this.live?.cdp.stopCapture(id);
  }

  invalidate() {
    this.document = undefined;
    this.targets.clear();
    void this.stopCapture();
    void this.release();
  }

  private release() {
    if (this.busy || this.live || !this.sessions) return this.closing;
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
      const discovered = request.action === 'cdpListTargets' ? undefined : this.targets.get(request.target.id);
      if (request.action !== 'cdpListTargets' && discovered?.path.at(-1)?.origin !== request.target.origin)
        throw new Error('The CDP child target is stale. List targets again.');
      const sessions = this.sessions ??= new ChildSessions(send, subscribe, (method, params, session) => {
        if (this.live?.route.some(({ child, attachment, attachedUrl }) => {
          if (sessions.children.get(child.targetId) !== attachment || attachment.url !== attachedUrl) return true;
          if (session !== attachment.sessionId) return false;
          if (method === 'Page.frameNavigated') {
            const frame = params.frame as ChildDocument;
            return frame.id === child.document.id && (frame.loaderId !== child.document.loaderId || frame.url !== child.document.url);
          }
          return method === 'Page.navigatedWithinDocument' && params.frameId === child.document.id;
        })) void this.stopCapture();
      });
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
      if (!discovered) throw new Error('The CDP child target is unavailable.');
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
        this.live = { id, cdp, route };
      }
      try {
        const result = await cdp.call(request, child.document.loaderId, child.origin,
          (method, params) => sessions.send(method, params, attachment.sessionId), listener => sessions.subscribe((method, params, session) => {
            if (session === attachment.sessionId) listener(method, params);
          }), check, signal, id, () => this.captureEnded(id));
        for (const step of route) await verify(step.child, step.attachment);
        return { ...result, target: request.target };
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
